/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchesSchema } from './validateV1'

// Capability guard only: adding a keyword requires runtime implementation and behavior tests.
const validationKeywords = new Set([
  '$ref', 'type', 'const', 'enum', 'allOf', 'anyOf', 'oneOf', 'properties', 'required',
  'additionalProperties', 'items', 'minimum', 'maximum', 'minLength', 'minItems', 'maxItems', 'pattern', 'format',
])
const annotations = new Set(['description', 'examples', 'default'])
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const official: unknown = JSON.parse(readFileSync(new URL('../../../backend/api-server/contracts/openapi.json', import.meta.url), 'utf8'))
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function at(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}
function primitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}
function inspect(schema: unknown, path: string, document: unknown, issues: string[], visited = new Set<string>()) {
  const fail = (key: string, detail: string) => issues.push(`${at(path, key)}: ${key} ${detail}`)
  if (!record(schema)) { issues.push(`${path}: schema must be an object; boolean/tuple schemas are unsupported`); return }
  for (const key of Object.keys(schema)) if (!validationKeywords.has(key) && !annotations.has(key)) fail(key, 'is unsupported')
  if ('type' in schema) {
    const values = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!values.length || values.some(v => typeof v !== 'string' || !types.has(v))) fail('type', 'contains an unsupported type')
  }
  const hasType = (type: string) => schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type))
  for (const key of ['minLength', 'pattern', 'format']) {
    if (key in schema && !hasType('string')) fail(key, 'requires explicit string type in this runtime')
  }
  for (const key of ['minimum', 'maximum']) {
    if (key in schema && !hasType('number') && !hasType('integer')) fail(key, 'requires explicit numeric type in this runtime')
    if (key in schema && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) fail(key, 'must be finite')
  }
  for (const key of ['items', 'minItems', 'maxItems']) {
    if (key in schema && !hasType('array')) fail(key, 'requires explicit array type in this runtime')
  }
  for (const key of ['minLength', 'minItems', 'maxItems']) {
    if (key in schema && (typeof schema[key] !== 'number' || !Number.isInteger(schema[key]) || schema[key] < 0)) fail(key, 'must be a nonnegative integer')
  }
  if ('format' in schema && schema.format !== 'date-time') fail('format', `value ${JSON.stringify(schema.format)} is unsupported`)
  if ('pattern' in schema) {
    if (typeof schema.pattern !== 'string') fail('pattern', 'must be a string')
    else { try { new RegExp(schema.pattern) } catch { fail('pattern', 'is an unsupported regular expression') } }
  }
  if ('const' in schema && !primitive(schema.const)) fail('const', 'object/array deep equality is unsupported')
  if ('enum' in schema && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some(v => !primitive(v)))) fail('enum', 'requires primitive values')
  if ('required' in schema && (!Array.isArray(schema.required) || schema.required.some(v => typeof v !== 'string'))) fail('required', 'must be an array of field names')
  if ('properties' in schema) {
    if (!record(schema.properties)) fail('properties', 'must map field names to schemas')
    else for (const [key, child] of Object.entries(schema.properties)) inspect(child, at(at(path, 'properties'), key), document, issues, visited)
  }
  if ('additionalProperties' in schema) {
    if (!hasType('object') && !('properties' in schema) && !('required' in schema)) fail('additionalProperties', 'requires object validation context')
    if (typeof schema.additionalProperties !== 'boolean') inspect(schema.additionalProperties, at(path, 'additionalProperties'), document, issues, visited)
  }
  if ('items' in schema) inspect(schema.items, at(path, 'items'), document, issues, visited)
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (!(key in schema)) continue
    const children = schema[key]
    if (!Array.isArray(children) || !children.length) fail(key, 'must be a nonempty schema array')
    else children.forEach((child, index) => inspect(child, `${at(path, key)}[${index}]`, document, issues, visited))
  }
  if ('$ref' in schema) {
    const ref = schema.$ref
    if (typeof ref !== 'string' || !ref.startsWith('#/')) fail('$ref', `form ${JSON.stringify(ref)} is unsupported; only local JSON pointers are supported`)
    else {
      let target: unknown = document
      for (const segment of ref.slice(2).split('/')) {
        const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
        target = record(target) && Object.hasOwn(target, key) ? target[key] : undefined
      }
      if (!record(target)) fail('$ref', `target ${ref} is missing or is not an object schema`)
      else if (!visited.has(ref)) {
        visited.add(ref)
        inspect(target, `${at(path, '$ref')} -> ${ref}`, document, issues, visited)
      }
    }
  }
}
function schemaIssues(schema: unknown, document: unknown = {}): string[] {
  const issues: string[] = []
  inspect(schema, 'schema', document, issues)
  return issues
}
function openApiIssues(document: unknown) {
  const issues: string[] = []
  let roots = 0
  function walk(value: unknown, path: string) {
    if (Array.isArray(value)) { value.forEach((child, i) => walk(child, `${path}[${i}]`)); return }
    if (!record(value)) return
    for (const [key, child] of Object.entries(value)) {
      // OAS examples/default contain payloads, not schemas.
      if (annotations.has(key) || key === 'example') continue
      const childPath = at(path, key)
      if (key === 'schema') { roots++; inspect(child, childPath, document, issues) }
      else if (path === 'openapi.components' && key === 'schemas' && record(child)) {
        for (const [name, entry] of Object.entries(child)) { roots++; inspect(entry, at(childPath, name), document, issues) }
      } else walk(child, childPath)
    }
  }
  walk(document, 'openapi')
  return { issues, roots }
}
describe('official OpenAPI capability guard', () => {
  it('checks the backend original component and inline request/response/parameter/header schemas', () => {
    const { issues, roots } = openApiIssues(official)
    expect(roots).toBeGreaterThan(0)
    expect(issues, issues.join('\n')).toEqual([])
  })
  it.each([
    [{ type: 'string', maxLength: 2 }, 'schema.maxLength'],
    [{ type: 'array', items: { type: 'string' }, uniqueItems: true }, 'schema.uniqueItems'],
    [{ type: 'object', properties: { token: { type: 'string', format: 'uuid' } } }, 'schema.properties.token.format'],
    [{ type: 'array', items: { type: 'object', properties: { text: { type: 'string', maxLength: 2 } } } }, 'schema.items.properties.text.maxLength'],
    [{ anyOf: [{ type: 'string' }, { type: 'array', uniqueItems: true }] }, 'schema.anyOf[1].uniqueItems'],
    [{ type: 'object', additionalProperties: { type: 'string', maxLength: 2 } }, 'schema.additionalProperties.maxLength'],
  ])('detects unsupported nested features with their paths', (schema, fragment) => {
    expect(schemaIssues(schema).join('\n')).toContain(fragment)
  })
  it('reports an actual inline OpenAPI schema location', () => {
    const doc = { paths: { '/api/example': { get: { responses: { '200': { content: { 'application/json': { schema: { type: 'string', maxLength: 2 } } } } } } } } }
    expect(openApiIssues(doc).issues.join('\n')).toContain('openapi.paths["/api/example"].get.responses["200"].content["application/json"].schema.maxLength')
  })
  it('ignores field names and example/default payload keys', () => {
    expect(schemaIssues({ type: 'object', properties: { maxLength: { type: 'string' }, uniqueItems: { type: 'boolean' } },
      examples: [{ format: 'uuid', maxLength: 2, schema: { unknown: true } }], default: { uniqueItems: true }, description: 'data' })).toEqual([])
    expect(openApiIssues({ components: { examples: { test: { value: { schema: { maxLength: 3 } } } } } }).issues).toEqual([])
  })
  it.each([
    false, true, { type: 'invalid' }, { type: [] }, { type: 'array', items: [{ type: 'string' }] },
    { const: { deep: true } }, { enum: [{ deep: true }] }, { type: 'string', format: 'uuid' },
    { minLength: 2 }, { items: { type: 'string' } }, { additionalProperties: false },
    { type: 'string', pattern: '[' }, { anyOf: [] }, { required: [1] },
  ])('rejects shapes the current runtime cannot enforce', schema => {
    expect(schemaIssues(schema).length).toBeGreaterThan(0)
  })
  it.each(['https://example.com/schema.json', 'other.json#/A', '#anchor', '#/missing'])('rejects unsupported or unresolved ref %s', $ref => {
    const errors = schemaIssues({ $ref }).join('\n')
    expect(errors).toContain('schema.$ref')
    expect(errors).toContain($ref)
  })
  it('follows escaped local refs and inspects target keywords', () => {
    const document = { components: { schemas: { 'A/B~': { type: 'string', maxLength: 2 } } } }
    expect(schemaIssues({ $ref: '#/components/schemas/A~1B~0' }, document).join('\n')).toContain('maxLength')
    expect(schemaIssues({ $ref: '#/components/schemas/A' }, { components: { schemas: { A: { type: 'string' } } } })).toEqual([])
  })
})
const keywordBehaviors = [
  ['$ref', { $ref: '#/components/schemas/BlockNumber' }, '1', 1],
  ['type', { type: 'string' }, 'x', 1], ['const', { const: true }, true, false], ['enum', { enum: ['x'] }, 'x', 'y'],
  ['allOf', { allOf: [{ type: 'string' }, { type: 'string', minLength: 2 }] }, 'ab', 'a'],
  ['anyOf', { anyOf: [{ type: 'string' }, { type: 'null' }] }, null, 1],
  ['oneOf', { oneOf: [{ type: 'string' }, { enum: ['x'] }] }, 'y', 'x'],
  ['properties', { type: 'object', properties: { field: { type: 'string' } } }, { field: 'x' }, { field: 1 }],
  ['required', { type: 'object', required: ['field'] }, { field: null }, {}],
  ['additionalProperties', { type: 'object', properties: { field: { type: 'string' } }, additionalProperties: false }, { field: 'x' }, { field: 'x', extra: 1 }],
  ['items', { type: 'array', items: { type: 'string' } }, ['x'], [1]],
  ['minimum', { type: 'integer', minimum: 2 }, 2, 1], ['maximum', { type: 'integer', maximum: 2 }, 2, 3],
  ['minLength', { type: 'string', minLength: 2 }, 'ab', 'a'],
  ['minItems', { type: 'array', minItems: 1 }, [1], []], ['maxItems', { type: 'array', maxItems: 1 }, [1], [1, 2]],
  ['pattern', { type: 'string', pattern: '^x$' }, 'x', 'y'],
  ['format', { type: 'string', format: 'date-time' }, '2026-10-26T12:00:04Z', '2026-02-30T12:00:04Z'],
] as const
describe('capability declarations match runtime behavior', () => {
  it('requires behavior tests for every validation keyword', () => {
    expect(keywordBehaviors.map(([key]) => key).sort()).toEqual([...validationKeywords].sort())
  })
  it.each(keywordBehaviors)('enforces %s with positive/negative examples', (_key, schema, pass, fail) => {
    const supported = schema as Parameters<typeof matchesSchema>[1]
    expect(matchesSchema(pass, supported)).toBe(true)
    expect(matchesSchema(fail, supported)).toBe(false)
  })
})
