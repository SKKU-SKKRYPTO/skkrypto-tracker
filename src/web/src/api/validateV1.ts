import spec from '../../mocks/v1/openapi.json'

type Schema = {
  $ref?: string; type?: string | string[]; const?: unknown; enum?: unknown[]
  anyOf?: Schema[]; oneOf?: Schema[]; allOf?: Schema[]
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema
  items?: Schema; minimum?: number; maximum?: number; minLength?: number
  minItems?: number; maxItems?: number; pattern?: string; format?: string
}

function resolveReference(ref: string): Schema {
  if (!ref.startsWith('#/')) throw new Error('Only local contract references are supported')
  let value: unknown = spec
  for (const segment of ref.slice(2).split('/')) {
    value = (value as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  if (!value || typeof value !== 'object') throw new Error(`Unknown contract reference: ${ref}`)
  return value as Schema
}

// Validator for the keywords used by this checked-in v1 contract, not a general JSON Schema engine.
export function matchesSchema(value: unknown, schema: Schema): boolean {
  if (schema.$ref === '#/components/schemas/Amount' && !isUint256(value)) return false
  if (schema.$ref && !matchesSchema(value, resolveReference(schema.$ref))) return false
  if (schema.allOf && !schema.allOf.every(part => matchesSchema(value, part))) return false
  if (schema.anyOf && !schema.anyOf.some(part => matchesSchema(value, part))) return false
  if (schema.oneOf && schema.oneOf.filter(part => matchesSchema(value, part)).length !== 1) return false
  if ('const' in schema && value !== schema.const) return false
  if (schema.enum && !schema.enum.includes(value)) return false
  if (Array.isArray(schema.type)) return schema.type.some(type => matchesSchema(value, { ...schema, type }))
  if (schema.type === 'null') return value === null
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false
    if (schema.minLength !== undefined && value.length < schema.minLength) return false
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false
    if (schema.format === 'date-time' && !isDateTime(value)) return false
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
    if (schema.type === 'integer' && !Number.isInteger(value)) return false
    if (schema.minimum !== undefined && value < schema.minimum) return false
    if (schema.maximum !== undefined && value > schema.maximum) return false
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false
    if (schema.minItems !== undefined && value.length < schema.minItems) return false
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false
    if (schema.items && !value.every(item => matchesSchema(item, schema.items!))) return false
  }
  if (schema.type === 'object' || schema.properties || schema.required) {
    if (!isRecord(value)) return false
    if (schema.required?.some(key => !Object.hasOwn(value, key))) return false
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key]
      if (property && !matchesSchema(item, property)) return false
      if (!property && schema.additionalProperties === false) return false
      if (!property && typeof schema.additionalProperties === 'object' && !matchesSchema(item, schema.additionalProperties)) return false
    }
  }
  return true
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function matchesV1(value: unknown, name: keyof typeof spec.components.schemas): boolean {
  return matchesSchema(value, { $ref: '#/components/schemas/' + name })
}

// The operation's response schema includes the success envelope and resolves shared errors.
export function matchesResponse(value: unknown, method: string, path: string, status: number): boolean {
  const operation = (spec.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>)[path]?.[method.toLowerCase()]
  let response = operation?.responses[String(status)] as { $ref?: string; content?: Record<string, { schema: Schema }> } | undefined
  if (response?.$ref) response = resolveReference(response.$ref) as typeof response
  const schema = response?.content?.['application/json']?.schema
  return !!schema && matchesSchema(value, schema)
}

// Amount's uint256 bound is specified in the official schema description.
const UINT256_MAX = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
function isUint256(value: unknown): boolean {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) &&
    (value.length < UINT256_MAX.length || (value.length === UINT256_MAX.length && value <= UINT256_MAX))
}

function isDateTime(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!parts) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHour, offsetMinute] = parts
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(hourText) < 24 && Number(minuteText) < 60 && Number(secondText) < 60 &&
    (zone === 'Z' || (Number(offsetHour) < 24 && Number(offsetMinute) < 60)) && Number.isFinite(Date.parse(value))
}
