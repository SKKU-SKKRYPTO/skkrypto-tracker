import { describe, expect, it, vi } from 'vitest'
import { createHttpClient } from './httpClient'
import { createLiveTraceApi, buildLiveTraceRequest } from './liveTrace'
import type { AnalysisRequest, Dataset, SuccessEnvelope } from './v1Types'
import dataset from '../../mocks/v1/samples/dataset-detail.json'
import success from '../../mocks/v1/samples/trace-success.json'
import empty from '../../mocks/v1/samples/trace-ready-empty.json'
import partial from '../../mocks/v1/samples/trace-candidate-limit.json'
import invalidInput from '../../mocks/v1/samples/error-bad-input.json'
import unavailable from '../../mocks/v1/samples/error-unavailable.json'
const selection = { datasetId: 'flow-demo', datasetVersion: 'v1' }
const detail = dataset as SuccessEnvelope<Dataset>
const request = buildLiveTraceRequest(selection, success.meta.conditions.address, { direction: 'outgoing', maxDepth: 2 })
function setup(body: unknown, status = 200, headers = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }))
  return { fetcher, api: createLiveTraceApi(createHttpClient({ fetch: fetcher })) }
}
describe('live trace service', () => {
  it('builds the selected dataset/version and preserves all user direction/depth choices', () => {
    for (const direction of ['incoming', 'outgoing'] as const) for (const maxDepth of [1, 2, 3] as const) {
      expect(buildLiveTraceRequest({ datasetId: 'patterns-demo', datasetVersion: 'v9' }, ' 0xABC ', { direction, maxDepth })).toEqual({ datasetId: 'patterns-demo', datasetVersion: 'v9', address: '0xabc', direction, maxDepth })
    }
  })
  it('POSTs to relative /api/trace with the real HTTP transport and selected Adapter', async () => {
    const { api, fetcher } = setup(success)
    const controller = new AbortController()
    const response = await api.searchTrace({ selection, dataset: detail, request, signal: controller.signal })
    expect(response.ok && response.result.transfers).toEqual(success.data.transfers)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/trace', expect.objectContaining({ method: 'POST', body: JSON.stringify(request), signal: controller.signal }))
  })
  it.each([success, empty, partial])('preserves normal/empty/partial responses', async body => {
    const conditions = body.meta.conditions
    const req: AnalysisRequest = { ...selection, address: conditions.address, direction: 'outgoing', maxDepth: conditions.maxDepth, ...(body === partial ? { limits: { maxCandidates: 4 } } : {}) }
    const result = await setup(body).api.searchTrace({ selection, dataset: detail, request: req })
    expect(result.ok && result.result.limits).toEqual(body.meta.limits)
    expect(result.ok && result.result.nodes).toEqual(body.data.nodes)
  })
  it.each([[400, invalidInput], [503, unavailable]] as const)('preserves the v1 HTTP %s error envelope', async (status, body) => {
    expect(await setup(body, status, { 'Retry-After': '5' }).api.searchTrace({ selection, dataset: detail, request })).toEqual({ ok: false, kind: 'api', status, error: body.error, retryAfter: '5' })
  })
  it('rejects a response from another selected version and reports onInvalid once', async () => {
    const diagnostics: unknown[] = []
    expect(await setup(success).api.searchTrace({ selection: { ...selection, datasetVersion: 'v2' }, dataset: detail, request, onInvalid: d => diagnostics.push(d) })).toMatchObject({ kind: 'invalid-response' })
    expect(diagnostics).toEqual([{ code: 'DATASET_MISMATCH', path: 'dataset.data.datasetVersion' }])
  })
  it('keeps malformed JSON separate and isolates the diagnostic observer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>proxy error</html>'))
    let count = 0
    const result = await createLiveTraceApi(createHttpClient({ fetch: fetcher })).searchTrace({ selection, dataset: detail, request, onInvalid: d => { count++; expect(d.code).toBe('JSON_PARSE'); throw Error('observer') } })
    expect(result).toMatchObject({ kind: 'invalid-response' })
    expect(count).toBe(1)
  })
  it('diagnoses invalid schema responses rather than accepting their data', async () => {
    const diagnostics: unknown[] = []
    expect(await setup({ ...success, data: null }).api.searchTrace({ selection, dataset: detail, request, onInvalid: d => diagnostics.push(d) })).toMatchObject({ kind: 'invalid-response' })
    expect(diagnostics).toEqual([{ code: 'RESPONSE_SCHEMA', path: 'response' }])
  })
  it('retains network and body-read failure stages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    await expect(createLiveTraceApi(createHttpClient({ fetch: fetcher })).searchTrace({ selection, dataset: detail, request })).rejects.toMatchObject({ stage: 'network' })
    const response = new Response('{}')
    vi.spyOn(response, 'text').mockRejectedValue(new Error('closed'))
    fetcher.mockResolvedValue(response)
    await expect(createLiveTraceApi(createHttpClient({ fetch: fetcher })).searchTrace({ selection, dataset: detail, request })).rejects.toMatchObject({ stage: 'response-read' })
  })
  it('does not fetch an already-cancelled search', async () => {
    const { api, fetcher } = setup(success)
    const controller = new AbortController(); controller.abort()
    await expect(api.searchTrace({ selection, dataset: detail, request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
