import { describe, expect, it, vi } from 'vitest'
import { createDatasetSession, canSearch, datasetKeyValue } from './datasetSession'
import { createDatasetApi } from '../api/datasets'
import type { DatasetResponse } from '../api/datasets'
import { createLiveTraceApi } from '../api/liveTrace'
import type { LiveTraceResponse } from '../api/liveTrace'
import type { Dataset, SuccessEnvelope } from '../api/v1Types'
import { adaptSelectedTraceResponse } from '../adapters/traceAdapter'
import { SearchRequestError } from '../api/searchFailure'
import { matchesResponse } from '../api/validateV1'
import listJson from '../../mocks/v1/samples/datasets-list.json'
import detailJson from '../../mocks/v1/samples/dataset-detail.json'
import traceJson from '../../mocks/v1/samples/trace-success.json'
if (!matchesResponse(listJson, 'GET', '/api/datasets', 200)) throw new Error('Invalid official list sample')
const list = listJson as unknown as SuccessEnvelope<Dataset[]>
const baseDetail = detailJson as SuccessEnvelope<Dataset>
const flow = list.data.find(row => row.datasetId === 'flow-demo')!
const patterns = list.data.find(row => row.datasetId === 'patterns-demo')!
const key = (d: Dataset) => ({ datasetId: d.datasetId, datasetVersion: d.datasetVersion })
const detailFor = (d: Dataset): SuccessEnvelope<Dataset> => ({
  data: structuredClone(d), error: null, meta: { ...baseDetail.meta, ...key(d), sourceMode: d.sourceMode, coverage: { startBlock: d.startBlock, endBlock: d.endBlock, startTime: d.startTime, endTime: d.endTime } },
})
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const normal = adaptSelectedTraceResponse(traceJson, detailFor(flow), key(flow))
const apiError = { ok: false, kind: 'api', status: 503, error: { code: 'UNAVAILABLE', message: '실패', retryable: true }, retryAfter: null } as const
function setup(rows = list.data) {
  const datasets = {
    listDatasets: vi.fn<ReturnType<typeof createDatasetApi>['listDatasets']>().mockResolvedValue({ ok: true, envelope: { ...list, data: rows } }),
    getDataset: vi.fn<ReturnType<typeof createDatasetApi>['getDataset']>().mockImplementation(async selection => ({ ok: true, envelope: detailFor(rows.find(row => datasetKeyValue(row) === datasetKeyValue(selection))!) })),
  }
  const trace = { searchTrace: vi.fn<ReturnType<typeof createLiveTraceApi>['searchTrace']>().mockResolvedValue(normal) }
  return { session: createDatasetSession({ datasets, trace }), datasets, trace }
}
describe('dataset selection state', () => {
  it('loads the first READY dataset and waits for its detail before enabling search', async () => {
    const { session, datasets } = setup()
    const detail = deferred<DatasetResponse<Dataset>>()
    datasets.getDataset.mockReturnValueOnce(detail.promise)
    const pending = session.loadDatasets()
    expect(session.getSnapshot().listStatus).toBe('loading')
    await vi.waitFor(() => expect(datasets.getDataset).toHaveBeenCalledTimes(1))
    expect(session.getSnapshot().selection).toEqual(key(flow))
    expect(session.getSnapshot().detailStatus).toBe('loading')
    expect(canSearch(session.getSnapshot())).toBe(false)
    detail.resolve({ ok: true, envelope: detailFor(flow) }); await pending
    expect(canSearch(session.getSnapshot())).toBe(true)
  })
  it.each(['COLLECTING', 'FAILED', 'INVALIDATED'] as const)('lets users view %s while blocking trace', async status => {
    const row = { ...flow, status, collectedAt: null }
    const { session, trace } = setup([row])
    await session.loadDatasets(); await session.search('address')
    expect(session.getSnapshot().detail?.data.status).toBe(status)
    expect(canSearch(session.getSnapshot())).toBe(false)
    expect(trace.searchTrace).not.toHaveBeenCalled()
  })
  it('distinguishes versions of one ID and clears results/selection immediately on version change', async () => {
    const v2 = { ...flow, datasetVersion: 'v2' }
    const { session, datasets } = setup([flow, v2])
    await session.loadDatasets(); await session.search(traceJson.meta.conditions.address)
    session.selectTransfer(traceJson.data.transfers[0].id)
    const detail = deferred<DatasetResponse<Dataset>>()
    datasets.getDataset.mockReturnValueOnce(detail.promise)
    const pending = session.selectDataset(key(v2))
    expect(session.getSnapshot()).toMatchObject({ selection: key(v2), response: null, selectedTransferId: null, detail: null, detailStatus: 'loading', isSearching: false })
    expect(canSearch(session.getSnapshot())).toBe(false)
    detail.resolve({ ok: true, envelope: detailFor(v2) }); await pending
    expect(session.getSnapshot().detail?.data.datasetVersion).toBe('v2')
  })
  it('handles an empty list without requesting a detail', async () => {
    const { session, datasets } = setup([])
    await session.loadDatasets()
    expect(session.getSnapshot()).toMatchObject({ listStatus: 'ready', datasets: [], selection: null })
    expect(datasets.getDataset).not.toHaveBeenCalled()
  })
  it('handles list API errors and supports retry', async () => {
    const { session, datasets } = setup()
    datasets.listDatasets.mockResolvedValueOnce(apiError)
    await session.loadDatasets()
    expect(session.getSnapshot()).toMatchObject({ listStatus: 'error', listError: apiError })
    await session.loadDatasets()
    expect(canSearch(session.getSnapshot())).toBe(true)
    expect(session.getSnapshot().listError).toBeNull()
  })
  it('handles detail failures and does not search with stale details', async () => {
    const { session, datasets, trace } = setup()
    datasets.getDataset.mockRejectedValueOnce(new SearchRequestError('network'))
    await session.loadDatasets(); await session.search('x')
    expect(session.getSnapshot().detailError).toMatchObject({ kind: 'request-failed', stage: 'network' })
    expect(trace.searchTrace).not.toHaveBeenCalled()
    await session.selectDataset(key(flow))
    expect(canSearch(session.getSnapshot())).toBe(true)
  })
  it('ignores old detail success and failure after another dataset is selected', async () => {
    for (const outcome of ['success', 'error']) {
      const { session, datasets } = setup()
      await session.loadDatasets()
      const old = deferred<DatasetResponse<Dataset>>()
      datasets.getDataset.mockReturnValueOnce(old.promise)
      const pending = session.selectDataset(key(flow))
      const oldSignal = datasets.getDataset.mock.calls.at(-1)![1]!.signal!
      await session.selectDataset(key(patterns))
      expect(oldSignal.aborted).toBe(true)
      if (outcome === 'success') old.resolve({ ok: true, envelope: detailFor(flow) })
      else old.reject(new SearchRequestError('response-read'))
      await pending
      expect(session.getSnapshot()).toMatchObject({ selection: key(patterns), detailStatus: 'ready', detailError: null })
      expect(session.getSnapshot().detail?.data.datasetId).toBe('patterns-demo')
    }
  })
  it('ignores stale list responses and supports StrictMode cancel/restart', async () => {
    const { session, datasets } = setup()
    const old = deferred<DatasetResponse<Dataset[]>>()
    datasets.listDatasets.mockReturnValueOnce(old.promise)
    const pending = session.loadDatasets()
    const signal = datasets.listDatasets.mock.calls[0][0]!.signal!
    session.cancelPending(); await session.loadDatasets()
    expect(signal.aborted).toBe(true)
    old.resolve({ ok: true, envelope: { ...list, data: [] } }); await pending
    expect(session.getSnapshot().selection).toEqual(key(flow))
    expect(canSearch(session.getSnapshot())).toBe(true)
  })
  it('uses stable snapshots and unsubscribes listeners', async () => {
    const { session } = setup()
    expect(session.getSnapshot()).toBe(session.getSnapshot())
    const listener = vi.fn(), unsubscribe = session.subscribe(listener)
    await session.loadDatasets()
    expect(listener).toHaveBeenCalled()
    unsubscribe(); listener.mockClear(); session.setConditions({ direction: 'incoming', maxDepth: 3 })
    expect(listener).not.toHaveBeenCalled()
  })
})
describe('live trace request state and races', () => {
  it('uses selected data and preserves the shared transfer ID and applied conditions', async () => {
    const { session, trace } = setup()
    await session.loadDatasets(); await session.search('  '+traceJson.meta.conditions.address+' ')
    expect(trace.searchTrace).toHaveBeenCalledWith(expect.objectContaining({ selection: key(flow), dataset: detailFor(flow), request: { ...key(flow), address: traceJson.meta.conditions.address, direction: 'outgoing', maxDepth: 2 } }))
    session.selectTransfer(traceJson.data.transfers[0].id)
    expect(session.getSnapshot().selectedTransferId).toBe(traceJson.data.transfers[0].id)
    session.selectTransfer('missing')
    expect(session.getSnapshot().selectedTransferId).toBe(traceJson.data.transfers[0].id)
  })
  it.each(['direction', 'depth', 'dataset'] as const)('invalidates trace immediately on %s change, preserving condition-only results', async change => {
    const { session, trace } = setup()
    await session.loadDatasets(); await session.search('x')
    const shown = session.getSnapshot().response
    if (change !== 'dataset') {
      session.setConditions(change === 'direction' ? { direction: 'incoming', maxDepth: 2 } : { direction: 'outgoing', maxDepth: 3 })
      expect(session.getSnapshot().response).toBe(shown)
    }
    const old = deferred<LiveTraceResponse>(); trace.searchTrace.mockReturnValueOnce(old.promise)
    const pending = session.search('x')
    const signal = trace.searchTrace.mock.calls.at(-1)![0].signal!
    if (change === 'dataset') await session.selectDataset(key(patterns))
    else session.setConditions({ direction: 'outgoing', maxDepth: 1 })
    expect(signal.aborted).toBe(true)
    expect(session.getSnapshot()).toMatchObject({ isSearching: false, response: null, selectedTransferId: null })
    old.resolve(normal); await pending
    expect(session.getSnapshot()).toMatchObject({ isSearching: false, response: null })
  })
  it.each(['resolve', 'reject'] as const)('does not let an old %s/finally overwrite a newer pending search', async outcome => {
    const { session, trace } = setup(); await session.loadDatasets()
    const old = deferred<LiveTraceResponse>(), latest = deferred<LiveTraceResponse>()
    trace.searchTrace.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const oldPending = session.search('old')
    await session.selectDataset(key(patterns))
    const latestPending = session.search('new')
    if (outcome === 'resolve') old.resolve(normal)
    else old.reject(new SearchRequestError('network'))
    await oldPending
    expect(session.getSnapshot()).toMatchObject({ isSearching: true, response: null })
    latest.resolve(apiError); await latestPending
    expect(session.getSnapshot()).toMatchObject({ isSearching: false, response: apiError })
  })
  it('ignores an old rejection after condition change even without a new search', async () => {
    const { session, trace } = setup(); await session.loadDatasets()
    const old = deferred<LiveTraceResponse>(); trace.searchTrace.mockReturnValueOnce(old.promise)
    const pending = session.search('x'); session.setConditions({ direction: 'incoming', maxDepth: 3 })
    old.reject(new SearchRequestError('network')); await pending
    expect(session.getSnapshot()).toMatchObject({ response: null, isSearching: false })
  })
  it('keeps API, format and transport failures distinct', async () => {
    const { session, trace } = setup(); await session.loadDatasets()
    trace.searchTrace.mockResolvedValueOnce(apiError)
    await session.search('x'); expect(session.getSnapshot().response).toEqual(apiError)
    trace.searchTrace.mockResolvedValueOnce({ ok: false, kind: 'invalid-response', error: { message: 'bad JSON' } })
    await session.search('x'); expect(session.getSnapshot().response).toMatchObject({ kind: 'invalid-response' })
    trace.searchTrace.mockRejectedValueOnce(new SearchRequestError('response-read'))
    await session.search('x'); expect(session.getSnapshot().response).toMatchObject({ kind: 'request-failed', stage: 'response-read' })
  })
  it('blocks further trace after the server reports a changed dataset status', async () => {
    const { session, trace } = setup(); await session.loadDatasets()
    trace.searchTrace.mockResolvedValueOnce({ ok: false, kind: 'api', status: 409, error: { code: 'DATASET_INVALIDATED', message: '무효화', retryable: false } })
    await session.search('x')
    expect(canSearch(session.getSnapshot())).toBe(false)
    await session.search('x'); expect(trace.searchTrace).toHaveBeenCalledTimes(1)
    await session.selectDataset(key(flow)); expect(canSearch(session.getSnapshot())).toBe(true)
  })
  it('aborts pending operations on cleanup without displaying late results', async () => {
    const { session, trace } = setup(); await session.loadDatasets()
    const pendingResult = deferred<LiveTraceResponse>(); trace.searchTrace.mockReturnValueOnce(pendingResult.promise)
    const pending = session.search('x'); session.cancelPending()
    expect(trace.searchTrace.mock.calls[0][0].signal?.aborted).toBe(true)
    pendingResult.resolve(normal); await pending
    expect(session.getSnapshot()).toMatchObject({ response: null, isSearching: false })
  })
})

// Additional races: the stale detail must not end a newer detail's loading state.
describe('detail loading races and server state changes', () => {
  it('keeps the newer detail loading when an older detail resolves', async () => {
    const { session, datasets } = setup()
    await session.loadDatasets()
    const old = deferred<DatasetResponse<Dataset>>(), latest = deferred<DatasetResponse<Dataset>>()
    datasets.getDataset.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const oldPending = session.selectDataset(key(flow))
    const latestPending = session.selectDataset(key(patterns))
    old.resolve({ ok: true, envelope: detailFor(flow) }); await oldPending
    expect(session.getSnapshot()).toMatchObject({ selection: key(patterns), detailStatus: 'loading', detail: null })
    latest.resolve({ ok: true, envelope: detailFor(patterns) }); await latestPending
    expect(session.getSnapshot().detail?.data.datasetId).toBe('patterns-demo')
  })
  it('blocks search when the list said READY but the newer detail says COLLECTING', async () => {
    const { session, datasets, trace } = setup()
    datasets.getDataset.mockResolvedValueOnce({ ok: true, envelope: detailFor({ ...flow, status: 'COLLECTING', collectedAt: null }) })
    await session.loadDatasets(); await session.search('x')
    expect(session.getSnapshot().detail?.data.status).toBe('COLLECTING')
    expect(canSearch(session.getSnapshot())).toBe(false)
    expect(trace.searchTrace).not.toHaveBeenCalled()
  })
})
