import { describe, expect, it, vi } from 'vitest'
import list from '../../mocks/v1/samples/datasets-list.json'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import unavailable from '../../mocks/v1/samples/error-unavailable.json'
import notFound from '../../mocks/v1/samples/error-not-found.json'
import rateLimited from '../../mocks/v1/samples/error-rate-limited.json'
import { createDatasetApi } from './datasets'
import { createHttpClient } from './httpClient'

const key = { datasetId: 'flow-demo', datasetVersion: 'v1' }
function setup(body: unknown, status = 200, headers = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }))
  return { fetcher, api: createDatasetApi(createHttpClient({ baseUrl: 'http://localhost:8080', fetch: fetcher })) }
}
describe('dataset listing', () => {
  it('gets and validates the official list, retaining every status and nullable finality', async () => {
    const { fetcher, api } = setup(list)
    expect(await api.listDatasets()).toEqual({ ok: true, envelope: list })
    expect(list.data.every(d => d.finalizedBlock === null)).toBe(true)
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:8080/api/datasets')
  })
  it('accepts an empty list', async () => {
    const body = { ...list, data: [] }
    expect(await setup(body).api.listDatasets()).toEqual({ ok: true, envelope: body })
  })
  it.each([null, {}, { ...list, data: {} }, { ...list, error: unavailable.error }])('rejects invalid list envelopes', async body => {
    expect(await setup(body).api.listDatasets()).toMatchObject({ kind: 'invalid-response' })
  })
  it('retains the same dataset ID with different versions as separate entries', async () => {
    const body = { ...list, data: [detail.data, { ...detail.data, datasetVersion: 'v2' }] }
    const result = await setup(body).api.listDatasets()
    expect(result.ok && result.envelope.data.map(d => d.datasetVersion)).toEqual(['v1', 'v2'])
  })
})
describe('dataset details', () => {
  it('requests the selected ID/version and returns the full envelope for the Adapter', async () => {
    const { fetcher, api } = setup(detail)
    expect(await api.getDataset(key)).toEqual({ ok: true, envelope: detail })
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:8080/api/datasets/flow-demo?datasetVersion=v1')
  })
  it('encodes the path and query without changing the selected strings', async () => {
    const selected = { datasetId: 'demo /?#한', datasetVersion: 'v2 &x=y' }
    const body = structuredClone(detail)
    Object.assign(body.data, selected)
    Object.assign(body.meta, selected)
    const { fetcher, api } = setup(body)
    expect((await api.getDataset(selected)).ok).toBe(true)
    expect(fetcher.mock.calls[0][0]).toBe(`http://localhost:8080/api/datasets/${encodeURIComponent(selected.datasetId)}?${new URLSearchParams({ datasetVersion: selected.datasetVersion })}`)
  })
  it.each(['READY', 'COLLECTING', 'FAILED', 'INVALIDATED'] as const)('allows information lookup in %s status', async status => {
    const body = structuredClone(detail)
    body.data.status = status
    if (status !== 'READY') Object.assign(body.data, { collectedAt: null })
    expect(await setup(body).api.getDataset(key)).toEqual({ ok: true, envelope: body })
  })
  it.each(['datasetId', 'datasetVersion'] as const)('rejects a response for a different %s', async field => {
    const body = structuredClone(detail)
    body.data[field] = 'other'
    expect(await setup(body).api.getDataset(key)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['datasetId', 'datasetVersion', 'sourceMode'] as const)('rejects inconsistent meta.%s', async field => {
    const body = structuredClone(detail)
    Object.assign(body.meta, { [field]: field === 'sourceMode' ? 'SNAPSHOT' : 'other' })
    expect(await setup(body).api.getDataset(key)).toMatchObject({ kind: 'invalid-response' })
  })
  it('rejects missing nullable fields and incorrect scalar values', async () => {
    const missing = structuredClone(detail)
    delete (missing.data as Partial<typeof missing.data>).finalizedBlock
    expect(await setup(missing).api.getDataset(key)).toMatchObject({ kind: 'invalid-response' })
    const wrong = structuredClone(detail)
    Object.assign(wrong.data, { collectedAt: 123 })
    expect(await setup(wrong).api.getDataset(key)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each([{ datasetId: '', datasetVersion: 'v1' }, { datasetId: 'flow-demo', datasetVersion: '' }])('requires both ID and version before calling the server', async selected => {
    const { api, fetcher } = setup(detail)
    await expect(api.getDataset(selected)).rejects.toBeInstanceOf(RangeError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
describe('dataset HTTP failures and cancellation', () => {
  it('preserves a 404 API error', async () => {
    expect(await setup(notFound, 404).api.getDataset(key)).toEqual({ ok: false, kind: 'api', status: 404, error: notFound.error, retryAfter: null })
  })
  it('preserves a 429 Retry-After header without automatically retrying', async () => {
    const { api, fetcher } = setup(rateLimited, 429, { 'Retry-After': '30' })
    expect(await api.listDatasets()).toEqual({ ok: false, kind: 'api', status: 429, error: rateLimited.error, retryAfter: '30' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves a valid 503 API error, distinct from a network failure', async () => {
    expect(await setup(unavailable, 503).api.listDatasets()).toMatchObject({ kind: 'api', status: 503, error: { retryable: true } })
  })
  it('does not treat malformed or undocumented responses as valid API errors', async () => {
    expect(await setup({ error: unavailable.error }, 503).api.listDatasets()).toMatchObject({ kind: 'invalid-response' })
    expect(await setup(unavailable, 500).api.listDatasets()).toMatchObject({ kind: 'invalid-response', status: 500 })
  })
  it('keeps invalid JSON distinct from transport failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{'))
    expect(await createDatasetApi(createHttpClient({ fetch: fetcher })).listDatasets()).toMatchObject({ kind: 'invalid-response' })
  })
  it('propagates signal cancellation without converting it into an API error', async () => {
    const controller = new AbortController()
    controller.abort()
    const { api, fetcher } = setup(detail)
    await expect(api.getDataset(key, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(api.listDatasets({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('propagates network failure with its transport stage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    await expect(createDatasetApi(createHttpClient({ fetch: fetcher })).listDatasets()).rejects.toMatchObject({ stage: 'network' })
  })
})
