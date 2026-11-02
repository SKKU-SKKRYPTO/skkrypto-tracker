import { describe, expect, it, vi } from 'vitest'
import { createDatasetSession, canSearch } from './datasetSession'
import type { PatternResponse } from '../api/patterns'
import { createPatternApi } from '../api/patterns'
import { createHttpClient } from '../api/httpClient'
import { SearchRequestError } from '../api/searchFailure'
import type { Dataset, SuccessEnvelope } from '../api/v1Types'
import sample from '../../mocks/v1/samples/patterns-success.json'
import detailJson from '../../mocks/v1/samples/dataset-detail.json'

const selection = { datasetId: 'patterns-demo', datasetVersion: 'v1' }
const conditions = { address: sample.meta.conditions.address, direction: 'all' as const }
const detail = { ...detailJson, data: { ...detailJson.data, ...selection, asset: sample.meta.conditions.asset, ...sample.meta.coverage } } as SuccessEnvelope<Dataset>
const normal = { ok: true, envelope: sample } as PatternResponse
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (v: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const datasets = {
    listDatasets: vi.fn().mockResolvedValue({ ok: true, envelope: { ...detail, data: [detail.data] } }),
    getDataset: vi.fn().mockResolvedValue({ ok: true, envelope: detail }),
  }
  const patterns = { searchPatterns: vi.fn<ReturnType<typeof createPatternApi>['searchPatterns']>().mockResolvedValue(normal) }
  const trace = { searchTrace: vi.fn().mockResolvedValue({ ok: false, kind: 'invalid-response', error: { message: 'trace' } }) }
  const paths = { searchPaths: vi.fn().mockResolvedValue({ ok: false, kind: 'invalid-response', error: { message: 'paths' } }) }
  const onInvalidPattern = vi.fn()
  const session = createDatasetSession({ datasets, patterns, trace, paths, onInvalidPattern })
  return { session, datasets, patterns, trace, paths, onInvalidPattern }
}
async function ready() {
  const f = setup(); await f.session.loadDatasets(); f.session.setMode('patterns'); f.session.setPatternConditions(conditions); return f
}
describe('Pattern session', () => {
  it.each(['all', 'outgoing', 'incoming'] as const)('uses the phase-one request builder for %s', async direction => {
    const { session, patterns, trace, paths, onInvalidPattern } = await ready()
    session.setPatternConditions({ address: ` ${conditions.address} `, direction }); await session.searchPatterns()
    const request = { ...selection, address: conditions.address, ...(direction === 'all' ? {} : { direction }) }
    expect(patterns.searchPatterns).toHaveBeenCalledExactlyOnceWith({ selection, dataset: detail, request, signal: expect.any(AbortSignal), onInvalid: onInvalidPattern })
    if (direction === 'all') expect(patterns.searchPatterns.mock.calls[0][0].request).not.toHaveProperty('direction')
    for (const key of ['targetAddress', 'startTransferId', 'maxDepth']) expect(patterns.searchPatterns.mock.calls[0][0].request).not.toHaveProperty(key)
    expect(session.getSnapshot()).toMatchObject({ patternResponse: normal, response: null, pathResponse: null, isSearching: false })
    await session.search('ignored'); await session.searchPaths()
    expect(trace.searchTrace).not.toHaveBeenCalled(); expect(paths.searchPaths).not.toHaveBeenCalled()
  })
  it('integrates the real Pattern HTTP client and adapter', async () => {
    const f = setup()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(sample)))
    const session = createDatasetSession({ datasets: f.datasets, patterns: createPatternApi(createHttpClient({ baseUrl: '', fetch: fetcher })) })
    await session.loadDatasets(); session.setMode('patterns'); session.setPatternConditions(conditions); await session.searchPatterns()
    expect(session.getSnapshot().patternResponse).toEqual(normal)
    expect(fetcher.mock.calls[0][0]).toBe('/api/patterns')
  })
  it.each(['', '0x123', 'invalid'])('validates address before calling the API (%s)', async address => {
    const { session, patterns } = await ready(); session.setPatternConditions({ ...conditions, address }); await session.searchPatterns()
    expect(patterns.searchPatterns).not.toHaveBeenCalled(); expect(session.getSnapshot().patternValidationError).toContain('기준 주소')
    session.setPatternConditions(conditions); expect(session.getSnapshot().patternValidationError).toBeNull()
  })
  it.each(['COLLECTING', 'FAILED', 'INVALIDATED'] as const)('blocks %s datasets', async status => {
    const { session, datasets, patterns } = setup()
    datasets.getDataset.mockResolvedValueOnce({ ok: true, envelope: { ...detail, data: { ...detail.data, status } } })
    await session.loadDatasets(); session.setMode('patterns'); session.setPatternConditions(conditions); await session.searchPatterns()
    expect(canSearch(session.getSnapshot())).toBe(false); expect(patterns.searchPatterns).not.toHaveBeenCalled()
  })
  it('blocks before loading and outside Pattern mode', async () => {
    const { session, patterns } = setup(); await session.searchPatterns(); await session.loadDatasets(); await session.searchPatterns()
    expect(patterns.searchPatterns).not.toHaveBeenCalled()
  })
  it.each(['address', 'direction', 'dataset', 'version', 'trace', 'paths', 'cancel', 'cleanup', 'reload'] as const)('invalidates pending requests on %s', async change => {
    const { session, patterns } = await ready(); const old = deferred<PatternResponse>(); patterns.searchPatterns.mockReturnValueOnce(old.promise)
    const pending = session.searchPatterns(); const signal = patterns.searchPatterns.mock.calls[0][0].signal!
    if (change === 'address') session.setPatternConditions({ ...conditions, address: `0x${'a'.repeat(40)}` })
    else if (change === 'direction') session.setPatternConditions({ ...conditions, direction: 'incoming' })
    else if (change === 'dataset' || change === 'version') await session.selectDataset({ datasetId: change === 'dataset' ? 'other' : selection.datasetId, datasetVersion: change === 'version' ? 'v2' : 'v1' })
    else if (change === 'trace' || change === 'paths') session.setMode(change)
    else if (change === 'cancel') session.cancelSearch()
    else if (change === 'reload') await session.loadDatasets()
    else session.cancelPending()
    expect(signal.aborted).toBe(true)
    old.resolve(normal); await pending
    expect(session.getSnapshot()).toMatchObject({ patternResponse: null, isSearching: false })
  })
  it.each(['resolve', 'reject'] as const)('ignores stale %s and finally during a newer request', async outcome => {
    const { session, patterns } = await ready(); const old = deferred<PatternResponse>(), latest = deferred<PatternResponse>()
    patterns.searchPatterns.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const first = session.searchPatterns(); const second = session.searchPatterns()
    expect(patterns.searchPatterns.mock.calls[0][0].signal!.aborted).toBe(true)
    if (outcome === 'resolve') old.resolve(normal); else old.reject(new SearchRequestError('network'))
    await first; expect(session.getSnapshot()).toMatchObject({ isSearching: true, patternResponse: null })
    latest.resolve(normal); await second; expect(session.getSnapshot()).toMatchObject({ isSearching: false, patternResponse: normal })
  })
  it.each(['trace', 'paths'] as const)('isolates pending Pattern from newer %s and vice versa', async mode => {
    const { session, patterns, trace, paths } = await ready()
    const old = deferred<PatternResponse>(), other = deferred<never>()
    patterns.searchPatterns.mockReturnValueOnce(old.promise)
    const first = session.searchPatterns(); session.setMode(mode)
    if (mode === 'paths') session.setPathConditions({ address: conditions.address, targetAddress: `0x${'a'.repeat(40)}`, direction: 'outgoing', maxDepth: 2 })
    const api = mode === 'trace' ? trace.searchTrace : paths.searchPaths
    api.mockReturnValueOnce(other.promise)
    const second = mode === 'trace' ? session.search(conditions.address) : session.searchPaths()
    old.resolve(normal); await first
    expect(session.getSnapshot()).toMatchObject({ isSearching: true, patternResponse: null })
    session.setMode('patterns'); const latest = session.searchPatterns()
    other.reject(new SearchRequestError('response-read')); await second; await latest
    expect(session.getSnapshot()).toMatchObject({ patternResponse: normal, pathResponse: null, response: null, isSearching: false })
  })
  it('clears displayed results on edits and preserves separate mode conditions', async () => {
    const { session } = await ready(); await session.searchPatterns(); session.setPatternConditions({ ...conditions, direction: 'incoming' })
    expect(session.getSnapshot().patternResponse).toBeNull()
    session.setMode('paths'); session.setMode('patterns')
    expect(session.getSnapshot()).toMatchObject({ patternConditions: { ...conditions, direction: 'incoming' }, pathConditions: { maxDepth: 2 }, conditions: { maxDepth: 2 } })
  })
  it.each(['network', 'response-read'] as const)('reports %s failures', async stage => {
    const { session, patterns } = await ready(); await session.searchPatterns(); patterns.searchPatterns.mockRejectedValueOnce(new SearchRequestError(stage)); await session.searchPatterns()
    expect(session.getSnapshot()).toMatchObject({ patternResponse: { kind: 'request-failed', stage }, isSearching: false })
  })
  it('preserves invalid responses and invalidates stale READY detail on server error', async () => {
    const { session, patterns } = await ready()
    patterns.searchPatterns.mockResolvedValueOnce({ ok: false, kind: 'invalid-response', status: 200, error: { message: 'schema' } })
    await session.searchPatterns(); expect(session.getSnapshot().patternResponse).toMatchObject({ kind: 'invalid-response' })
    patterns.searchPatterns.mockResolvedValueOnce({ ok: false, kind: 'api', status: 409, envelope: {} as never, error: { code: 'DATASET_INVALIDATED', message: '무효화', retryable: false } })
    await session.searchPatterns(); expect(canSearch(session.getSnapshot())).toBe(false)
    await session.searchPatterns(); expect(patterns.searchPatterns).toHaveBeenCalledTimes(2)
    await session.selectDataset(selection); expect(canSearch(session.getSnapshot())).toBe(true)
  })
})

describe('Pattern selection and details state', () => {
  it('selects separate windows in the same group and follows Path transfer-selection UX', async () => {
    const { session } = await ready(); await session.searchPatterns()
    const [first, second] = sample.data.patterns
    expect(first.groupId).toBe(second.groupId)
    session.selectPattern(first.patternId); session.selectTransfer(first.evidenceIds[0])
    expect(session.getSnapshot()).toMatchObject({ selectedPatternId: first.patternId, selectedTransferId: first.evidenceIds[0], selectedPathId: null })
    session.selectPattern(second.patternId)
    expect(session.getSnapshot()).toMatchObject({ selectedPatternId: second.patternId, selectedTransferId: null })
    session.selectTransfer(second.evidenceIds[0]); session.selectPattern(first.patternId)
    expect(session.getSnapshot().selectedTransferId).toBe(second.evidenceIds[0])
    session.selectTransfer(sample.data.transfers[4].id)
    expect(session.getSnapshot()).toMatchObject({ selectedPatternId: null, selectedTransferId: sample.data.transfers[4].id })
    session.selectPattern(second.patternId); session.selectPattern(null)
    expect(session.getSnapshot()).toMatchObject({ selectedPatternId: null, selectedTransferId: sample.data.transfers[4].id })
  })
  it.each(['address', 'direction', 'dataset', 'version', 'trace', 'paths', 'search', 'cancel', 'cleanup', 'reload'] as const)('clears both selections on %s', async change => {
    const { session } = await ready(); await session.searchPatterns()
    session.selectPattern(sample.data.patterns[0].patternId); session.selectTransfer(sample.data.transfers[0].id)
    if (change === 'address' || change === 'direction') session.setPatternConditions({ ...conditions, [change]: change === 'address' ? '0x123' : 'incoming' })
    else if (change === 'dataset' || change === 'version') await session.selectDataset({ ...selection, [change === 'dataset' ? 'datasetId' : 'datasetVersion']: 'other' })
    else if (change === 'trace' || change === 'paths') session.setMode(change)
    else if (change === 'search') await session.searchPatterns()
    else if (change === 'cancel') session.cancelSearch()
    else if (change === 'reload') await session.loadDatasets()
    else session.cancelPending()
    expect(session.getSnapshot()).toMatchObject({ selectedPatternId: null, selectedTransferId: null, selectedPathId: null })
  })
  it('ignores missing IDs and selections made while searching or in another mode', async () => {
    const { session, patterns } = await ready(); await session.searchPatterns()
    session.selectPattern('missing'); session.selectTransfer('missing')
    expect(session.getSnapshot()).toMatchObject({ selectedPatternId: null, selectedTransferId: null })
    const bad = structuredClone(sample); bad.data.patterns[0].evidenceIds[0] = 'missing'
    patterns.searchPatterns.mockResolvedValueOnce({ ok: true, envelope: bad as never }); await session.searchPatterns()
    session.selectPattern(bad.data.patterns[0].patternId); expect(session.getSnapshot().selectedPatternId).toBeNull()
    const pending = deferred<PatternResponse>(); patterns.searchPatterns.mockReturnValueOnce(pending.promise)
    const request = session.searchPatterns(); session.selectPattern(sample.data.patterns[0].patternId); session.selectTransfer(sample.data.transfers[0].id)
    expect(session.getSnapshot()).toMatchObject({ selectedPatternId: null, selectedTransferId: null })
    pending.resolve(normal); await request; session.setMode('paths'); session.selectPattern(sample.data.patterns[0].patternId)
    expect(session.getSnapshot().selectedPatternId).toBeNull()
  })
})
