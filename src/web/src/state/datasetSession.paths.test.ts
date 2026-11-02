import { describe, expect, it, vi } from 'vitest'
import { canSearch, createDatasetSession } from './datasetSession'
import { createPathsApi } from '../api/paths'
import { createDatasetApi } from '../api/datasets'
import { createLiveTraceApi } from '../api/liveTrace'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PathsResponse } from '../adapters/pathsAdapter'
import { adaptSelectedTraceResponse } from '../adapters/traceAdapter'
import { SearchRequestError } from '../api/searchFailure'
import type { Dataset, SuccessEnvelope } from '../api/v1Types'
import detailJson from '../../mocks/v1/samples/dataset-detail.json'
import pathSample from '../../mocks/v1/samples/paths-success.json'
import traceSample from '../../mocks/v1/samples/trace-success.json'

const selection = { datasetId: 'flow-demo', datasetVersion: 'v1' }
const detail = detailJson as SuccessEnvelope<Dataset>
const conditions = { address: pathSample.meta.conditions.address, targetAddress: pathSample.meta.conditions.targetAddress, direction: 'outgoing' as const, maxDepth: 3 as const }
const normal = adaptPathsResponse(pathSample, detail, selection)
const traceNormal = adaptSelectedTraceResponse(traceSample, detail, selection)
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const datasets = {
    listDatasets: vi.fn<ReturnType<typeof createDatasetApi>['listDatasets']>().mockResolvedValue({ ok: true, envelope: { ...detail, data: [detail.data] } }),
    getDataset: vi.fn<ReturnType<typeof createDatasetApi>['getDataset']>().mockImplementation(async key => ({ ok: true, envelope: { ...detail, data: { ...detail.data, ...key } } })),
  }
  const paths = { searchPaths: vi.fn<ReturnType<typeof createPathsApi>['searchPaths']>().mockResolvedValue(normal) }
  const trace = { searchTrace: vi.fn<ReturnType<typeof createLiveTraceApi>['searchTrace']>().mockResolvedValue(traceNormal) }
  const onInvalidPath = vi.fn()
  const session = createDatasetSession({ datasets, paths, trace, onInvalidPath })
  return { session, paths, trace, datasets, onInvalidPath }
}
async function ready() {
  const f = setup(); await f.session.loadDatasets()
  f.session.setMode('paths'); f.session.setPathConditions(conditions)
  return f
}

describe('Path mode state and requests', () => {
  it('defaults to Trace and isolates mode conditions/results when switching back', async () => {
    const { session, trace, paths } = setup()
    expect(session.getSnapshot().mode).toBe('trace')
    await session.loadDatasets(); await session.search(traceSample.meta.conditions.address)
    session.selectTransfer(traceSample.data.transfers[0].id)
    session.setConditions({ direction: 'incoming', maxDepth: 1 })
    session.setMode('paths'); session.setPathConditions(conditions)
    expect(session.getSnapshot()).toMatchObject({ response: null, selectedTransferId: null, pathResponse: null })
    await session.searchPaths()
    expect(session.getSnapshot().pathResponse).toEqual(normal)
    await session.search('ignored')
    expect(trace.searchTrace).toHaveBeenCalledTimes(1)
    session.setMode('trace')
    expect(session.getSnapshot()).toMatchObject({ conditions: { direction: 'incoming', maxDepth: 1 }, pathConditions: conditions, pathResponse: null })
    await session.searchPaths(); expect(paths.searchPaths).toHaveBeenCalledTimes(1)
    await session.search(traceSample.meta.conditions.address)
    expect(session.getSnapshot().response).toEqual(traceNormal)
  })
  it('uses the selected dataset and the phase-one request builder with diagnostics and cancellation', async () => {
    const { session, paths, onInvalidPath } = await ready()
    session.setPathConditions({ ...conditions, address: ` ${conditions.address} ` })
    await session.searchPaths()
    expect(paths.searchPaths).toHaveBeenCalledExactlyOnceWith({ selection, dataset: { ...detail, data: { ...detail.data, ...selection } },
      request: { ...selection, ...conditions }, signal: expect.any(AbortSignal), onInvalid: onInvalidPath })
    expect(session.getSnapshot()).toMatchObject({ pathResponse: normal, isSearching: false, response: null })
  })
  it.each([
    ['', conditions.targetAddress, '시작 주소'], ['0x123', conditions.targetAddress, '시작 주소'],
    [conditions.address, 'not-an-address', '대상 주소'], [conditions.address, conditions.address, '서로 달라야'],
    [`0x${'a'.repeat(40)}`, `0x${'A'.repeat(40)}`, '서로 달라야'],
  ])('validates endpoints before sending (%s / %s)', async (address, targetAddress, message) => {
    const { session, paths } = await ready()
    session.setPathConditions({ ...conditions, address, targetAddress }); await session.searchPaths()
    expect(paths.searchPaths).not.toHaveBeenCalled()
    expect(session.getSnapshot().pathValidationError).toContain(message)
    expect(session.getSnapshot()).toMatchObject({ pathResponse: null, isSearching: false })
    session.setPathConditions(conditions); expect(session.getSnapshot().pathValidationError).toBeNull()
  })
  it('does not search before detail is loaded', async () => {
    const { session, paths } = setup()
    session.setMode('paths'); session.setPathConditions(conditions); await session.searchPaths()
    expect(paths.searchPaths).not.toHaveBeenCalled()
  })
  it.each(['COLLECTING', 'FAILED', 'INVALIDATED'] as const)('blocks Path search for %s datasets', async status => {
    const { session, datasets, paths } = setup()
    datasets.getDataset.mockResolvedValueOnce({ ok: true, envelope: { ...detail, data: { ...detail.data, status } } })
    await session.loadDatasets(); session.setMode('paths'); session.setPathConditions(conditions); await session.searchPaths()
    expect(canSearch(session.getSnapshot())).toBe(false)
    expect(paths.searchPaths).not.toHaveBeenCalled()
  })
  it.each(['address', 'targetAddress', 'direction', 'maxDepth', 'dataset', 'version', 'mode', 'cancel', 'cleanup'] as const)('immediately invalidates a pending Path on %s change', async change => {
    const { session, paths } = await ready()
    const old = deferred<PathsResponse>(); paths.searchPaths.mockReturnValueOnce(old.promise)
    const pending = session.searchPaths(), signal = paths.searchPaths.mock.calls[0][0].signal!
    expect(session.getSnapshot().isSearching).toBe(true)
    if (change === 'dataset' || change === 'version') await session.selectDataset({ datasetId: change === 'dataset' ? 'other' : 'flow-demo', datasetVersion: change === 'version' ? 'v2' : 'v1' })
    else if (change === 'mode') session.setMode('trace')
    else if (change === 'cancel') session.cancelSearch()
    else if (change === 'cleanup') session.cancelPending()
    else session.setPathConditions({ ...conditions, [change]: change === 'maxDepth' ? 2 : change === 'direction' ? 'incoming' : `0x${'a'.repeat(40)}` })
    expect(signal.aborted).toBe(true)
    expect(session.getSnapshot()).toMatchObject({ pathResponse: null, isSearching: false })
    old.resolve(normal); await pending
    expect(session.getSnapshot()).toMatchObject({ pathResponse: null, isSearching: false })
  })
  it('clears already displayed Path results on input and dataset changes', async () => {
    const { session } = await ready(); await session.searchPaths()
    expect(session.getSnapshot().pathResponse).toEqual(normal)
    session.setPathConditions({ ...conditions, maxDepth: 2 })
    expect(session.getSnapshot().pathResponse).toBeNull()
    await session.searchPaths(); await session.selectDataset({ ...selection, datasetVersion: 'v2' })
    expect(session.getSnapshot()).toMatchObject({ pathResponse: null, response: null, selectedTransferId: null })
  })
  it.each(['resolve', 'reject'] as const)('prevents stale %s/catch/finally from ending a newer Path request', async outcome => {
    const { session, paths } = await ready()
    const old = deferred<PathsResponse>(), latest = deferred<PathsResponse>()
    paths.searchPaths.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const first = session.searchPaths(); session.setPathConditions({ ...conditions, maxDepth: 2 })
    const second = session.searchPaths()
    if (outcome === 'resolve') old.resolve(normal); else old.reject(new SearchRequestError('network'))
    await first
    expect(session.getSnapshot()).toMatchObject({ pathResponse: null, isSearching: true })
    latest.resolve(normal); await second
    expect(session.getSnapshot()).toMatchObject({ pathResponse: normal, isSearching: false })
  })
  it('does not let an old Path finally or response affect a newer Trace', async () => {
    const { session, paths, trace } = await ready()
    const old = deferred<PathsResponse>(), latest = deferred<typeof traceNormal>()
    paths.searchPaths.mockReturnValueOnce(old.promise); trace.searchTrace.mockReturnValueOnce(latest.promise)
    const first = session.searchPaths(); session.setMode('trace'); const second = session.search(traceSample.meta.conditions.address)
    old.resolve(normal); await first
    expect(session.getSnapshot()).toMatchObject({ mode: 'trace', isSearching: true, response: null, pathResponse: null })
    latest.resolve(traceNormal); await second
    expect(session.getSnapshot().response).toEqual(traceNormal)
  })
  it('does not let an old Trace affect a newer Path', async () => {
    const { session, paths, trace } = setup(); await session.loadDatasets()
    const old = deferred<typeof traceNormal>(), latest = deferred<PathsResponse>()
    trace.searchTrace.mockReturnValueOnce(old.promise); paths.searchPaths.mockReturnValueOnce(latest.promise)
    const first = session.search(traceSample.meta.conditions.address)
    session.setMode('paths'); session.setPathConditions(conditions); const second = session.searchPaths()
    old.reject(new SearchRequestError('response-read')); await first
    expect(session.getSnapshot()).toMatchObject({ mode: 'paths', isSearching: true, response: null, pathResponse: null })
    latest.resolve(normal); await second
    expect(session.getSnapshot().pathResponse).toEqual(normal)
  })
  it.each(['network', 'response-read'] as const)('clears old results and reports %s failures', async stage => {
    const { session, paths } = await ready(); await session.searchPaths()
    paths.searchPaths.mockRejectedValueOnce(new SearchRequestError(stage)); await session.searchPaths()
    expect(session.getSnapshot()).toMatchObject({ pathResponse: { ok: false, kind: 'request-failed', stage }, isSearching: false })
  })
  it('preserves format/API failures and blocks stale READY detail after invalidation', async () => {
    const { session, paths } = await ready()
    paths.searchPaths.mockResolvedValueOnce({ ok: false, kind: 'invalid-response', error: { message: '잘못된 응답' } })
    await session.searchPaths(); expect(session.getSnapshot().pathResponse).toMatchObject({ kind: 'invalid-response' })
    paths.searchPaths.mockResolvedValueOnce({ ok: false, kind: 'api', status: 409, error: { code: 'DATASET_INVALIDATED', message: '무효화', retryable: false } })
    await session.searchPaths()
    expect(canSearch(session.getSnapshot())).toBe(false)
    expect(session.getSnapshot().pathResponse).toMatchObject({ kind: 'api', status: 409 })
    await session.searchPaths(); expect(paths.searchPaths).toHaveBeenCalledTimes(2)
    await session.selectDataset(selection); expect(canSearch(session.getSnapshot())).toBe(true)
  })
})
