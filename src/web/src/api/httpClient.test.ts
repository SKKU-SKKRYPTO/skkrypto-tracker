import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpClient } from './httpClient'
import { SearchRequestError } from './searchFailure'

afterEach(() => vi.unstubAllGlobals())
const jsonResponse = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers })
describe('common HTTP transport', () => {
  it('makes a relative GET with JSON Accept and no body/Content-Type', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    const result = await createHttpClient({ baseUrl: '', fetch: fetcher })('/api/datasets')
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/datasets', {
      method: 'GET', headers: { Accept: 'application/json' }, body: undefined, signal: undefined,
    })
    expect(result).toEqual({ ok: true, status: 200, body: { data: [] }, retryAfter: null })
  })
  it('uses the configured base URL and supports future JSON POST requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: {} }))
    const body = { datasetId: 'flow-demo', datasetVersion: 'v2', maxDepth: 3 }
    await createHttpClient({ baseUrl: 'http://localhost:8080/', fetch: fetcher })('/api/trace', { method: 'POST', body })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://localhost:8080/api/trace', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: undefined,
    })
    expect(body.maxDepth).toBe(3)
  })
  it.each([400, 404, 409, 429, 503])('preserves HTTP %s JSON rather than throwing a network error', async status => {
    const payload = { data: null, error: { code: 'example' } }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload, status, { 'Retry-After': '12' }))
    expect(await createHttpClient({ fetch: fetcher })('/api/datasets')).toEqual({ ok: true, status, body: payload, retryAfter: '12' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['{', '', '<html>proxy error</html>'])('returns a format failure for invalid JSON %s', async text => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(text, { status: 502 }))
    expect(await createHttpClient({ fetch: fetcher })('/api/datasets')).toMatchObject({ ok: false, kind: 'invalid-response', status: 502 })
  })
  it('classifies fetch rejection as network failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private details'))
    const result = createHttpClient({ fetch: fetcher })('/api/datasets')
    await expect(result).rejects.toBeInstanceOf(SearchRequestError)
    await expect(result).rejects.toMatchObject({ stage: 'network' })
  })
  it('classifies body-read rejection separately from invalid JSON', async () => {
    const response = jsonResponse({})
    vi.spyOn(response, 'text').mockRejectedValue(new Error('connection closed'))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
    await expect(createHttpClient({ fetch: fetcher })('/api/datasets')).rejects.toMatchObject({ stage: 'response-read' })
  })
  it('passes the AbortSignal through to fetch', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}))
    await createHttpClient({ fetch: fetcher })('/api/datasets', { signal: controller.signal })
    expect(fetcher.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
  it('does not fetch if already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn<typeof fetch>()
    await expect(createHttpClient({ fetch: fetcher })('/api/datasets', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps fetch aborts distinct from network failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    await expect(createHttpClient({ fetch: fetcher })('/api/datasets')).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('keeps body-read cancellation distinct from read failures', async () => {
    const controller = new AbortController()
    const response = jsonResponse({})
    vi.spyOn(response, 'text').mockImplementation(async () => { controller.abort(); throw new Error('closed') })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
    await expect(createHttpClient({ fetch: fetcher })('/api/datasets', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('discards responses that resolve after cancellation', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return jsonResponse({}) })
    await expect(createHttpClient({ fetch: fetcher })('/api/datasets', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('uses native fetch by default but does not call it at construction time', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetcher)
    const http = createHttpClient()
    expect(fetcher).not.toHaveBeenCalled()
    await http('/api/datasets')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
