import { SearchRequestError } from './searchFailure'

export type InvalidHttpResponse = {
  ok: false
  kind: 'invalid-response'
  status: number
  error: { message: string }
}
export type HttpResult =
  | { ok: true; status: number; body: unknown; retryAfter: string | null }
  | InvalidHttpResponse
export type HttpRequestOptions = { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }
export type HttpClient = (path: string, options?: HttpRequestOptions) => Promise<HttpResult>

function cancelled(cause: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (cause instanceof Error && cause.name === 'AbortError')
}
function abortError(): DOMException {
  return new DOMException('Request cancelled', 'AbortError')
}

// Services supply /api paths; the base URL excludes /api. Empty configuration uses the dev proxy.
// Explicit baseUrl (including '') overrides the Vite build-time environment value.
// HTTP error responses are read normally: the service validates their v1 error envelopes.
export function createHttpClient(config: { baseUrl?: string; fetch?: typeof fetch } = {}): HttpClient {
  const baseUrl = (config.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  return async (path, options = {}) => {
    if (options.signal?.aborted) throw abortError()
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    let response: Response
    try {
      response = await (config.fetch ?? globalThis.fetch)(`${baseUrl}/${path.replace(/^\/+/, '')}`, {
        method: options.method ?? 'GET',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body,
        signal: options.signal,
      })
    } catch (cause) {
      if (cancelled(cause, options.signal)) throw abortError()
      throw new SearchRequestError('network')
    }
    let text: string
    try {
      text = await response.text()
    } catch (cause) {
      if (cancelled(cause, options.signal)) throw abortError()
      throw new SearchRequestError('response-read')
    }
    // Covers transports/test doubles that resolve after cancellation instead of rejecting.
    if (options.signal?.aborted) throw abortError()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch {
      return { ok: false, kind: 'invalid-response', status: response.status, error: { message: '서버 응답이 올바른 JSON 형식이 아닙니다.' } }
    }
    return { ok: true, status: response.status, body: parsed, retryAfter: response.headers.get('Retry-After') }
  }
}
