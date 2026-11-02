import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPathsRequest, createPathsApi } from './paths'
import { createHttpClient } from './httpClient'
import type { Dataset, SuccessEnvelope } from './v1Types'
import detailJson from '../../mocks/v1/samples/dataset-detail.json'
import success from '../../mocks/v1/samples/paths-success.json'
import limited from '../../mocks/v1/samples/paths-path-limit.json'
import timed from '../../mocks/v1/samples/paths-time-budget.json'
import unavailable from '../../mocks/v1/samples/error-unavailable.json'
import badInput from '../../mocks/v1/samples/error-bad-input.json'
const selection = { datasetId: 'flow-demo', datasetVersion: 'v1' }
const dataset = detailJson as SuccessEnvelope<Dataset>
const request = buildPathsRequest(selection, success.meta.conditions.address, success.meta.conditions.targetAddress, { direction: 'outgoing', maxDepth: 3 })
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Paths HTTP service', () => {
  it('builds selected IDs and normalized endpoints while retaining every direction/depth choice', () => {
    for (const direction of ['incoming', 'outgoing'] as const) for (const maxDepth of [1, 2, 3] as const) {
      expect(buildPathsRequest({ datasetId: 'other', datasetVersion: 'v9' }, ' 0xABC ', ' 0xDEF ', { direction, maxDepth })).toEqual({ datasetId: 'other', datasetVersion: 'v9', address: '0xabc', targetAddress: '0xdef', direction, maxDepth })
    }
  })
  it('retains optional official filters/limits/start transfer without sharing mutable request values', () => {
    const options = { limits: { maxPaths: 1 }, filter: { minAmountRaw: '9007199254740993' }, startTransferId: 'fx:flow-demo-v1:e1' }
    const built = buildPathsRequest(selection, request.address, request.targetAddress, { direction: 'outgoing', maxDepth: 3 }, options)
    expect(built).toMatchObject(options)
    built.limits!.maxPaths = 2
    expect(options.limits.maxPaths).toBe(1)
  })
  it.each([undefined, '', 'https://api.example.test/'])('uses relative/proxy or environment URLs (%s) without changing the API path', async base => {
    vi.stubEnv('VITE_API_BASE_URL', base)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(success))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const result = await createPathsApi().searchPaths({ selection, dataset, request, signal: controller.signal })
    expect(result).toEqual({ ok: true, result: success })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${(base ?? '').replace(/\/+$/, '')}/api/paths`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal,
    })
  })
  it.each([limited, timed])('keeps partial results as successful responses', async body => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(body))
    const req = { ...request, limits: { maxPaths: body.meta.conditions.limits.maxPaths } }
    expect(await createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher })).searchPaths({ selection, dataset, request: req })).toEqual({ ok: true, result: body })
  })
  it('returns an empty Paths response successfully without fabricating evidence', async () => {
    const body = structuredClone(success)
    body.data.paths = []; body.data.transfers = []; body.data.nodes = []
    body.data.summary = { uniqueTransferCount: 0, uniqueAmountRaw: '0' }
    body.data.limits.found = 0; body.meta.limits.found = 0
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(body))
    expect(await createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher })).searchPaths({ selection, dataset, request })).toEqual({ ok: true, result: body })
  })
  it.each([[400, badInput], [503, unavailable]] as const)('preserves HTTP %s v1 errors and Retry-After', async (status, body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(body, status, { 'Retry-After': '10' }))
    expect(await createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher })).searchPaths({ selection, dataset, request })).toEqual({ ok: false, kind: 'api', status, error: body.error, retryAfter: '10' })
  })
  it('distinguishes malformed JSON and isolates diagnostic callbacks', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>proxy error</html>', { status: 502 }))
    const onInvalid = vi.fn(() => { throw Error('observer') })
    const result = await createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher })).searchPaths({ selection, dataset, request, onInvalid })
    expect(result).toMatchObject({ kind: 'invalid-response', status: 502 })
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith({ code: 'JSON_PARSE', path: 'response' })
  })
  it('diagnoses invalid schema and undocumented HTTP statuses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...success, data: null })).mockResolvedValueOnce(json(unavailable, 500))
    const api = createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher })), onInvalid = vi.fn()
    for (let i = 0; i < 2; i++) expect(await api.searchPaths({ selection, dataset, request, onInvalid })).toMatchObject({ kind: 'invalid-response' })
    expect(onInvalid.mock.calls).toEqual([[{ code: 'RESPONSE_SCHEMA', path: 'response' }], [{ code: 'RESPONSE_SCHEMA', path: 'response' }]])
  })
  it('keeps network and body-read failure stages distinct', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const api = createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher }))
    await expect(api.searchPaths({ selection, dataset, request })).rejects.toMatchObject({ stage: 'network' })
    const response = json(success); vi.spyOn(response, 'text').mockRejectedValue(new Error('closed'))
    fetcher.mockResolvedValue(response)
    await expect(api.searchPaths({ selection, dataset, request })).rejects.toMatchObject({ stage: 'response-read' })
  })
  it('does not send an already-cancelled request', async () => {
    const fetcher = vi.fn<typeof fetch>(), controller = new AbortController(); controller.abort()
    const api = createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher }))
    await expect(api.searchPaths({ selection, dataset, request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects a transport that resolves after cancellation', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return json(success) })
    const api = createPathsApi(createHttpClient({ baseUrl: '', fetch: fetcher }))
    await expect(api.searchPaths({ selection, dataset, request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
