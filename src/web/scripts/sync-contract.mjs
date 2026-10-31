// Copies the authoritative contract without changing backend files.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const web = fileURLToPath(new URL('..', import.meta.url))
const source = resolve(web, '../backend/api-server/contracts')
const target = resolve(web, 'mocks/v1')
mkdirSync(resolve(target, 'samples'), { recursive: true })
for (const file of ['openapi.json', 'sample-requests.json']) copyFileSync(resolve(source, file), resolve(target, file))
for (const file of readdirSync(resolve(source, 'samples')).filter(name => name.endsWith('.json'))) {
  copyFileSync(resolve(source, 'samples', file), resolve(target, 'samples', file))
}
const spec = JSON.parse(readFileSync(resolve(source, 'openapi.json'), 'utf8'))
function typeOf(schema) {
  if (schema.$ref) return schema.$ref.split('/').at(-1) === 'Error' ? 'V1Error' : schema.$ref.split('/').at(-1)
  if ('const' in schema) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(' | ')
  if (schema.oneOf || schema.anyOf) return (schema.oneOf || schema.anyOf).map(typeOf).map(t => `(${t})`).join(' | ')
  if (schema.allOf) {
    const inherited = Object.assign({}, ...schema.allOf.map(part => part.$ref ? spec.components.schemas[part.$ref.split('/').at(-1)].properties : part.properties))
    return schema.allOf.map(part => part.required && !part.properties && !part.$ref
      ? typeOf({ ...part, type: 'object', properties: Object.fromEntries(part.required.map(key => [key, inherited[key]])) })
      : typeOf(part)).map(t => '(' + t + ')').join(' & ')
  }
  if (Array.isArray(schema.type)) return schema.type.map(type => typeOf({ ...schema, type })).join(' | ')
  if (schema.type === 'array') return `Array<${typeOf(schema.items)}>`
  if (schema.type === 'object' || schema.properties || schema.required) {
    const fields = Object.entries(schema.properties || {}).map(([name, property]) => `${name}${schema.required?.includes(name) ? '' : '?'}: ${typeOf(property)}`)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') fields.push(`[key: string]: ${typeOf(schema.additionalProperties)}`)
    return `{ ${fields.join('; ')} }`
  }
  return { string: 'string', integer: 'number', number: 'number', boolean: 'boolean', null: 'null' }[schema.type] || 'unknown'
}
const types = Object.entries(spec.components.schemas).map(([name, schema]) => `export type ${name === 'Error' ? 'V1Error' : name} = ${typeOf(schema)}`).join('\n\n')
writeFileSync(resolve(web, 'src/api/v1Types.ts'), '// Generated from mocks/v1/openapi.json by scripts/sync-contract.mjs.\n// API types preserve official field names; UI types live in src/types.ts.\n' + types + '\n\nexport type SuccessEnvelope<T> = { data: T; meta: Meta; error: null }\nexport type TraceEnvelope = SuccessEnvelope<AnalysisResult> | ErrorEnvelope\n')

