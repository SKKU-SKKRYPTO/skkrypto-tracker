import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import JsonDownloadButton from '../components/JsonDownloadButton'
import { describe, expect, it, vi } from 'vitest'
import { createDatasetSession, getDownloadEnvelope } from './datasetSession'
import type { AnalysisMode } from './datasetSession'
import type { AnalysisRequest, AnalysisResult, Dataset, SuccessEnvelope } from '../api/v1Types'
import { createHttpClient } from '../api/httpClient'
import { createLiveTraceApi } from '../api/liveTrace'
import { createPathsApi } from '../api/paths'
import { createPatternApi } from '../api/patterns'
import trace from '../../mocks/v1/samples/trace-success.json'
import empty from '../../mocks/v1/samples/trace-ready-empty.json'
import partial from '../../mocks/v1/samples/trace-candidate-limit.json'
import paths from '../../mocks/v1/samples/paths-success.json'
import pathPartial from '../../mocks/v1/samples/paths-path-limit.json'
import patterns from '../../mocks/v1/samples/patterns-success.json'
import list from '../../mocks/v1/samples/datasets-list.json'
import error from '../../mocks/v1/samples/error-unavailable.json'
const modes = ['trace', 'paths', 'patterns'] as const
const samples = { trace, paths, patterns }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function setup(mode: AnalysisMode, body: unknown = samples[mode]) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(body))
  const http = createHttpClient({ baseUrl: '', fetch: fetcher })
  const datasets = {
    listDatasets: vi.fn().mockResolvedValue({ ok: true, envelope: list }),
    getDataset: vi.fn().mockImplementation(async (key: { datasetId: string; datasetVersion: string }) => {
      const data = (list.data as unknown as Dataset[]).find(row => row.datasetId === key.datasetId && row.datasetVersion === key.datasetVersion)
      return { ok: true, envelope: { data, error: null, meta: { contractVersion: 'v1', ruleVersion: 'flow-v1', limitations: [] } } }
    }),
  }
  const session = createDatasetSession({ datasets, trace: createLiveTraceApi(http), paths: createPathsApi(http), patterns: createPatternApi(http) })
  await session.loadDatasets()
  const conditions = (body as SuccessEnvelope<AnalysisResult>).meta.conditions as AnalysisRequest
  await session.selectDataset({ datasetId: conditions.datasetId, datasetVersion: conditions.datasetVersion })
  session.setMode(mode)
  if (mode === 'trace') session.setConditions({ direction: conditions.direction!, maxDepth: conditions.maxDepth as 1 | 2 | 3 })
  if (mode === 'paths') session.setPathConditions({ address: conditions.address, targetAddress: conditions.targetAddress!, direction: conditions.direction!, maxDepth: conditions.maxDepth as 1 | 2 | 3 })
  if (mode === 'patterns') session.setPatternConditions({ address: conditions.address, direction: conditions.direction ?? 'all' })
  const search = () => mode === 'trace' ? session.search(conditions.address) : mode === 'paths' ? session.searchPaths() : session.searchPatterns()
  return { session, fetcher, datasets, search }
}
describe('current validated download envelope', () => {
  it.each(modes)('exposes exactly the stored full %s envelope, independent of selections', async mode => {
    const { session, search } = await setup(mode)
    expect(session.getDownloadEnvelope()).toBeNull(); await search()
    const envelope = session.getDownloadEnvelope(), state = session.getSnapshot()
    expect(envelope).toEqual(samples[mode]); expect(getDownloadEnvelope(state)).toBe(envelope)
    const stored = mode === 'trace' && state.response?.ok ? state.response.envelope : mode === 'paths' && state.pathResponse?.ok ? state.pathResponse.result : state.patternResponse?.ok ? state.patternResponse.envelope : null
    expect(envelope).toBe(stored)
    if (mode === 'paths') session.selectPath(paths.data.paths[0].id)
    if (mode === 'patterns') session.selectPattern(patterns.data.patterns[0].patternId)
    session.selectTransfer(samples[mode].data.transfers[0].id)
    expect(session.getDownloadEnvelope()).toBe(envelope)
    if (mode === 'paths') session.selectPath(paths.data.paths[1].id)
    if (mode === 'patterns') session.selectPattern(patterns.data.patterns[1].patternId)
    expect(session.getDownloadEnvelope()).toEqual(samples[mode])
  })
  it.each(modes)('blocks %s while searching and allows the new accepted result', async mode => {
    const { session, fetcher, search } = await setup(mode); await search()
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise)
    const request = search(); expect(session.getSnapshot().isSearching).toBe(true); expect(session.getDownloadEnvelope()).toBeNull()
    pending.resolve(json(samples[mode])); await request; expect(session.getDownloadEnvelope()).toEqual(samples[mode])
  })
  it.each(modes)('invalidates %s conditions until a successful new search', async mode => {
    const { session, search } = await setup(mode); await search()
    const state = session.getSnapshot()
    if (mode === 'trace') session.setConditions({ ...state.conditions, maxDepth: 1 })
    if (mode === 'paths') session.setPathConditions({ ...state.pathConditions, targetAddress: trace.data.transfers[0].to })
    if (mode === 'patterns') session.setPatternConditions({ ...state.patternConditions, direction: 'incoming' })
    expect(session.getDownloadEnvelope()).toBeNull()
    if (mode === 'trace') expect(session.getSnapshot().response?.ok).toBe(true) // UI result retention is unchanged.
  })
  it('invalidates on every Trace address edit, including editing back to the old value', async () => {
    const { session, search } = await setup('trace'); await search()
    const previous = session.getSnapshot().response
    session.onTraceAddressChange(); expect(session.getDownloadEnvelope()).toBeNull()
    session.onTraceAddressChange(); expect(session.getDownloadEnvelope()).toBeNull()
    expect(session.getSnapshot().response).toBe(previous)
    await search(); expect(session.getDownloadEnvelope()).toEqual(trace)
  })
  it.each(modes)('ignores late %s success after editing', async mode => {
    const { session, search, fetcher } = await setup(mode); const old = deferred<Response>(); fetcher.mockReturnValueOnce(old.promise)
    const pending = search()
    if (mode === 'trace') session.onTraceAddressChange()
    else if (mode === 'paths') session.setPathConditions({ ...session.getSnapshot().pathConditions, address: '' })
    else session.setPatternConditions({ ...session.getSnapshot().patternConditions, address: '' })
    old.resolve(json(samples[mode])); await pending
    expect(session.getDownloadEnvelope()).toBeNull(); expect(session.getSnapshot().isSearching).toBe(false)
  })
  it.each(modes)('keeps %s target invalid on API, network, JSON and schema failures', async mode => {
    const { session, search, fetcher } = await setup(mode)
    for (const failure of ['api', 'network', 'json', 'schema']) {
      await search(); expect(session.getDownloadEnvelope()).not.toBeNull()
      if (failure === 'network') fetcher.mockRejectedValueOnce(new TypeError('offline'))
      else fetcher.mockResolvedValueOnce(failure === 'api' ? json(error, 503) : failure === 'json' ? new Response('<html>') : json({ data: null }))
      await search(); expect(session.getDownloadEnvelope()).toBeNull()
    }
  })
  it.each(modes)('clears %s export on dataset reload, version change, cancel and cleanup', async mode => {
    for (const change of ['reload', 'version', 'cancel', 'cleanup']) {
      const { session, search } = await setup(mode); await search()
      if (change === 'reload') await session.loadDatasets()
      else if (change === 'version') await session.selectDataset({ datasetId: samples[mode].meta.datasetId, datasetVersion: 'v2' })
      else if (change === 'cancel') session.cancelSearch()
      else session.cancelPending()
      expect(session.getDownloadEnvelope()).toBeNull()
    }
  })
  it.each(modes)('does not mix %s results across modes or revive them on switching back', async mode => {
    const { session, search } = await setup(mode); await search()
    session.setMode(mode === 'trace' ? 'paths' : 'trace'); expect(session.getDownloadEnvelope()).toBeNull()
    session.setMode(mode); expect(session.getDownloadEnvelope()).toBeNull()
  })
  it.each(['resolve', 'reject'] as const)('ignores stale %s without changing a newer successful target', async outcome => {
    const { session, fetcher, search } = await setup('trace'); const old = deferred<Response>(); fetcher.mockReturnValueOnce(old.promise)
    const first = search(); await search(); const current = session.getDownloadEnvelope()
    if (outcome === 'resolve') old.resolve(json(trace)); else old.reject(new TypeError('old failure'))
    await first; expect(session.getDownloadEnvelope()).toBe(current); expect(current).toEqual(trace)
  })
  it.each([['trace', empty], ['trace', partial], ['paths', pathPartial]] as const)('allows official empty/partial %s response', async (mode, body) => {
    const { session, search } = await setup(mode, body); await search(); expect(session.getDownloadEnvelope()).toEqual(body)
  })
  it.each(['paths', 'patterns'] as const)('allows derived empty and truncated %s responses', async mode => {
    for (const truncated of [false, true]) {
      const body = structuredClone(samples[mode]) as SuccessEnvelope<AnalysisResult>
      body.data.transfers = []; body.data.nodes = []; body.data.paths = []; body.data.patterns = []
      body.data.summary = { uniqueTransferCount: 0, uniqueAmountRaw: '0' }; body.data.limits.found = 0
      body.data.limits.truncated = truncated ? { reason: 'TIME_BUDGET', reasons: ['TIME_BUDGET'] } : null
      body.data.limits.foundIsLowerBound = truncated; body.meta.limits = structuredClone(body.data.limits)
      const { session, search } = await setup(mode, body); await search(); expect(session.getDownloadEnvelope()).toEqual(body)
    }
  })
})


describe('download provenance across analysis generations', () => {
  it.each(['resolve', 'reject'] as const)('does not let stale Trace %s replace a newer Path target', async outcome => {
    const { session, search, fetcher } = await setup('trace')
    const old = deferred<Response>(); fetcher.mockReturnValueOnce(old.promise)
    const first = search()
    session.setMode('paths')
    session.setPathConditions({ address: paths.meta.conditions.address, targetAddress: paths.meta.conditions.targetAddress, direction: 'outgoing', maxDepth: 3 })
    fetcher.mockResolvedValueOnce(json(paths)); await session.searchPaths()
    expect(session.getDownloadEnvelope()).toEqual(paths)
    if (outcome === 'resolve') old.resolve(json(trace)); else old.reject(new TypeError('old request'))
    await first; expect(session.getDownloadEnvelope()).toEqual(paths)
  })
  it('preserves nonempty incomplete and truncated Pattern results without selection filtering', async () => {
    const body = structuredClone(patterns) as SuccessEnvelope<AnalysisResult>
    body.data.patterns[0].incomplete = true
    body.data.limits.truncated = { reason: 'CANDIDATE_LIMIT', reasons: ['CANDIDATE_LIMIT'] }
    body.data.limits.foundIsLowerBound = true
    body.meta.limits = structuredClone(body.data.limits)
    const { session, search } = await setup('patterns', body); await search()
    session.selectPattern(body.data.patterns[0].patternId)
    expect(session.getDownloadEnvelope()).toEqual(body)
    expect(session.getDownloadEnvelope()?.data.patterns).toHaveLength(2)
  })
})


describe('download button with real analysis session state', () => {
  const disabled = (session: ReturnType<typeof createDatasetSession>) => /<button[^>]*disabled/.test(renderToStaticMarkup(createElement(JsonDownloadButton, { session })))
  it.each(modes)('follows success, editing, loading, errors and mode changes for %s', async mode => {
    const { session, search, fetcher } = await setup(mode)
    expect(disabled(session)).toBe(true)
    await search(); expect(disabled(session)).toBe(false)
    session.selectTransfer(samples[mode].data.transfers[0].id); expect(disabled(session)).toBe(false)
    const old = deferred<Response>(); fetcher.mockReturnValueOnce(old.promise)
    const pending = search(); expect(disabled(session)).toBe(true)
    old.resolve(json(samples[mode])); await pending; expect(disabled(session)).toBe(false)
    fetcher.mockRejectedValueOnce(new TypeError('offline')); await search(); expect(disabled(session)).toBe(true)
    fetcher.mockResolvedValueOnce(json(error, 503)); await search(); expect(disabled(session)).toBe(true)
    fetcher.mockResolvedValueOnce(json({ data: null })); await search(); expect(disabled(session)).toBe(true)
    await search(); expect(disabled(session)).toBe(false)
    if (mode === 'trace') session.onTraceAddressChange()
    if (mode === 'paths') session.setPathConditions({ ...session.getSnapshot().pathConditions, address: '' })
    if (mode === 'patterns') session.setPatternConditions({ ...session.getSnapshot().patternConditions, address: '' })
    expect(disabled(session)).toBe(true)
    session.setMode(mode === 'trace' ? 'paths' : 'trace'); expect(disabled(session)).toBe(true)
    session.setMode(mode); expect(disabled(session)).toBe(true)
  })
  it.each([['trace', empty], ['trace', partial], ['paths', pathPartial]] as const)('allows successful empty/partial %s downloads', async (mode, body) => {
    const { session, search } = await setup(mode, body); await search(); expect(disabled(session)).toBe(false)
  })
  it.each(modes)('disables %s download during dataset changes and until a new search', async mode => {
    const { session, search } = await setup(mode); await search(); expect(disabled(session)).toBe(false)
    const pending = session.selectDataset({ datasetId: samples[mode].meta.datasetId, datasetVersion: 'v1' })
    expect(disabled(session)).toBe(true); await pending; expect(disabled(session)).toBe(true)
  })
})
