import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpClient } from './httpClient'
import { createDatasetApi } from './datasets'
import { buildLiveTraceRequest, createLiveTraceApi } from './liveTrace'
import type { Dataset, SuccessEnvelope } from './v1Types'
import list from '../../mocks/v1/samples/datasets-list.json'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import success from '../../mocks/v1/samples/trace-success.json'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const json = (body: unknown) => new Response(JSON.stringify(body))

describe('API base URL environment configuration', () => {
  it.each([undefined, '', '   '])('keeps relative /api requests for an unset or empty value (%s)', async value => {
    vi.stubEnv('VITE_API_BASE_URL', value)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    await createHttpClient({ fetch: fetcher })('/api/datasets')
    expect(fetcher.mock.calls[0][0]).toBe('/api/datasets')
  })

  it.each(['https://api.example.test', 'https://api.example.test/', ' https://api.example.test/// '])('joins an environment base URL and /api once (%s)', async base => {
    vi.stubEnv('VITE_API_BASE_URL', base)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    await createHttpClient({ fetch: fetcher })('/api/datasets')
    expect(fetcher.mock.calls[0][0]).toBe('https://api.example.test/api/datasets')
  })

  it.each(['/api/trace', 'api/trace', '//api/trace'])('normalizes the request path separator (%s)', async path => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    await createHttpClient({ fetch: fetcher })(path)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.example.test/api/trace')
  })

  it.each(['', 'https://override.example.test/'])('preserves explicit baseUrl overrides (%s)', async baseUrl => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    await createHttpClient({ baseUrl, fetch: fetcher })('/api/datasets')
    expect(fetcher.mock.calls[0][0]).toBe(`${baseUrl.replace(/\/+$/, '')}/api/datasets`)
  })

  it.each(['', 'https://api.example.test/'])('uses default service clients for list, detail and adapted Trace (%s)', async base => {
    vi.stubEnv('VITE_API_BASE_URL', base)
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(list))
      .mockResolvedValueOnce(json(detail))
      .mockResolvedValueOnce(json(success))
    vi.stubGlobal('fetch', fetcher)
    const datasets = createDatasetApi()
    const selection = { datasetId: 'flow-demo', datasetVersion: 'v1' }
    expect(await datasets.listDatasets()).toEqual({ ok: true, envelope: list })
    expect(await datasets.getDataset(selection)).toEqual({ ok: true, envelope: detail })
    const request = buildLiveTraceRequest(selection, success.meta.conditions.address, { direction: 'outgoing', maxDepth: 2 })
    const result = await createLiveTraceApi().searchTrace({ selection, dataset: detail as SuccessEnvelope<Dataset>, request })
    expect(result.ok && result.result.transfers).toEqual(success.data.transfers)
    const prefix = base.replace(/\/+$/, '')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${prefix}/api/datasets`, `${prefix}/api/datasets/flow-demo?datasetVersion=v1`, `${prefix}/api/trace`,
    ])
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify(request) })
  })
})
