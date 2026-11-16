import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { load } from 'js-yaml'

/**
 * A small reader of `api/openapi.yaml` for contract tests: it resolves `$ref`
 * and checks a value against a schema. It knows only the keywords the
 * contract uses (type, enum, required, properties, additionalProperties,
 * items, minItems/maxItems/uniqueItems, minimum/maximum/exclusiveMaximum,
 * minLength/maxLength, pattern, oneOf); a keyword it does not know fails the
 * test instead of being skipped, so the contract cannot outgrow the checker
 * unnoticed. `format` is not checked.
 */
type Json = Record<string, unknown>

export interface OpenApi {
  paths: Record<string, Record<string, Json>>
  components: Record<string, Record<string, Json>>
}

const KNOWN = new Set([
  '$ref',
  'type',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'oneOf',
  'discriminator',
  'format',
  'description',
])

let cached: OpenApi | null = null

/** Read from `../api/openapi.yaml`: the tests run from `frontend/`. */
export function openApi(): OpenApi {
  cached ??= load(readFileSync(resolvePath(process.cwd(), '..', 'api', 'openapi.yaml'), 'utf8')) as OpenApi
  return cached
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Follows `#/a/b/c` inside the document. */
export function resolve(ref: string): Json {
  let node: unknown = openApi()
  for (const part of ref.replace(/^#\//, '').split('/')) {
    node = isObject(node) ? node[part] : undefined
  }
  if (!isObject(node)) throw new Error(`unresolved reference ${ref}`)
  return node
}

export const schema = (name: string): Json => resolve(`#/components/schemas/${name}`)

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isObject(value)
    default:
      throw new Error(`unsupported type ${type}`)
  }
}

/** The problems of `value` against `node`; empty means it conforms. */
export function check(node: Json, value: unknown, at = '$'): string[] {
  if (typeof node.$ref === 'string') return check(resolve(node.$ref), value, at)
  const unknownKeyword = Object.keys(node).find((key) => !KNOWN.has(key))
  if (unknownKeyword) throw new Error(`checker does not support "${unknownKeyword}" at ${at}`)

  if (Array.isArray(node.oneOf)) {
    const matches = (node.oneOf as Json[]).filter((option) => check(option, value, at).length === 0)
    return matches.length === 1 ? [] : [`${at}: matches ${String(matches.length)} of ${String(node.oneOf.length)} alternatives`]
  }

  const problems: string[] = []
  if (typeof node.type === 'string' && !typeMatches(node.type, value)) return [`${at}: expected ${node.type}`]
  // OpenAPI 3.1 type list, e.g. `[boolean, 'null']`: the value must fit at least one.
  if (Array.isArray(node.type) && !node.type.some((type) => typeof type === 'string' && typeMatches(type, value))) {
    return [`${at}: expected one of ${node.type.join(' | ')}`]
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) problems.push(`${at}: ${JSON.stringify(value)} is not in the enum`)

  if (typeof value === 'string') {
    if (typeof node.minLength === 'number' && value.length < node.minLength) problems.push(`${at}: shorter than ${String(node.minLength)}`)
    if (typeof node.maxLength === 'number' && value.length > node.maxLength) problems.push(`${at}: longer than ${String(node.maxLength)}`)
    if (typeof node.pattern === 'string' && !new RegExp(node.pattern).test(value)) problems.push(`${at}: does not match ${node.pattern}`)
  }

  if (typeof value === 'number') {
    if (typeof node.minimum === 'number' && value < node.minimum) problems.push(`${at}: below ${String(node.minimum)}`)
    if (typeof node.maximum === 'number' && value > node.maximum) problems.push(`${at}: above ${String(node.maximum)}`)
    if (typeof node.exclusiveMaximum === 'number' && value >= node.exclusiveMaximum) problems.push(`${at}: not below ${String(node.exclusiveMaximum)}`)
  }

  if (Array.isArray(value)) {
    if (typeof node.minItems === 'number' && value.length < node.minItems) problems.push(`${at}: fewer than ${String(node.minItems)} items`)
    if (typeof node.maxItems === 'number' && value.length > node.maxItems) problems.push(`${at}: more than ${String(node.maxItems)} items`)
    if (node.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) problems.push(`${at}: items repeat`)
    if (isObject(node.items)) value.forEach((item, index) => problems.push(...check(node.items as Json, item, `${at}[${String(index)}]`)))
  }

  if (isObject(value)) {
    const properties = isObject(node.properties) ? (node.properties as Record<string, Json>) : {}
    for (const key of Array.isArray(node.required) ? (node.required as string[]) : []) {
      if (!(key in value)) problems.push(`${at}: "${key}" is missing`)
    }
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key]
      if (property) problems.push(...check(property, item, `${at}.${key}`))
      else if (node.additionalProperties === false) problems.push(`${at}: "${key}" is not in the contract`)
    }
  }
  return problems
}

/** The response object of an operation, `$ref` resolved. */
export function response(path: string, method: string, status: string): Json {
  const operation = openApi().paths[path]?.[method]
  const node = isObject(operation?.responses) ? (operation.responses as Record<string, Json>)[status] : undefined
  if (!node) throw new Error(`${method.toUpperCase()} ${path} has no ${status} in the contract`)
  return typeof node.$ref === 'string' ? resolve(node.$ref) : node
}

/** The body schema of `application/json` or `application/problem+json`, or null when the response has none. */
export function responseBody(path: string, method: string, status: string): Json | null {
  const content = response(path, method, status).content
  if (!isObject(content)) return null
  const media = Object.values(content)[0]
  return isObject(media) && isObject(media.schema) ? media.schema : null
}

/** Names of the headers the contract marks as always present in a response. */
export function requiredHeaders(path: string, method: string, status: string): string[] {
  const headers = response(path, method, status).headers
  if (!isObject(headers)) return []
  return Object.entries(headers as Record<string, Json>)
    .filter(([, header]) => (typeof header.$ref === 'string' ? resolve(header.$ref) : header).required === true)
    .map(([name]) => name)
}

/** The status codes an operation declares. */
export function declaredStatuses(path: string, method: string): string[] {
  const responses = openApi().paths[path]?.[method]?.responses
  return isObject(responses) ? Object.keys(responses) : []
}
