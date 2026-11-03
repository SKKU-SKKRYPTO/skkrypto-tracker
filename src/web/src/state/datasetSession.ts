import { resolvePatternSelection } from '../patternSelection'
import { buildPatternRequest, createPatternApi } from '../api/patterns'
import type { PatternDiagnostic, PatternResponse } from '../api/patterns'
import { DEFAULT_PATTERN_CONDITIONS, validatePatternConditions } from '../patternConditions'
import type { PatternConditions } from '../patternConditions'
import { createDatasetApi } from '../api/datasets'
import type { DatasetKey, DatasetResponse } from '../api/datasets'
import { buildLiveTraceRequest, createLiveTraceApi } from '../api/liveTrace'
import type { LiveTraceResponse } from '../api/liveTrace'
import { buildPathsRequest, createPathsApi } from '../api/paths'
import type { PathsDiagnostic, PathsResponse } from '../adapters/pathsAdapter'
import type { SearchFailure } from '../api/searchFailure'
import { DEFAULT_PATH_CONDITIONS, validatePathAddresses } from '../pathConditions'
import type { PathConditions } from '../pathConditions'
import { resolvePathSelection } from '../pathSelection'
import { searchFailure } from '../api/searchFailure'
import type { InvalidDiagnostic } from '../adapters/traceAdapter'
import type { AnalysisResult, Dataset, SuccessEnvelope } from '../api/v1Types'
import { DEFAULT_SEARCH_CONDITIONS } from '../searchConditions'
import type { SearchConditions } from '../searchConditions'

export type RequestFailure = Exclude<DatasetResponse<unknown>, { ok: true }> | Exclude<LiveTraceResponse, { ok: true }> | Exclude<PathsResponse, { ok: true }> | Exclude<PatternResponse, { ok: true }>
export type AnalysisMode = 'trace' | 'paths' | 'patterns'
export type PatternSearchResponse = PatternResponse | SearchFailure
export type PathSearchResponse = PathsResponse | SearchFailure
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type DatasetSessionState = {
  datasets: Dataset[]; listStatus: LoadStatus; listError: RequestFailure | null
  selection: DatasetKey | null; detail: SuccessEnvelope<Dataset> | null; detailStatus: LoadStatus; detailError: RequestFailure | null
  conditions: SearchConditions; response: LiveTraceResponse | null; isSearching: boolean; selectedTransferId: string | null
  mode: AnalysisMode; pathConditions: PathConditions; pathResponse: PathSearchResponse | null; pathValidationError: string | null
  patternConditions: PatternConditions; patternResponse: PatternSearchResponse | null; patternValidationError: string | null
  // UI results may remain visible after edits, but cannot then be exported.
  downloadReady: boolean
  selectedPatternId: string | null
  selectedPathId: string | null
}
export function canSearch(state: DatasetSessionState): boolean {
  return state.detailStatus === 'ready' && state.detail?.data.status === 'READY' &&
    state.selection?.datasetId === state.detail.data.datasetId && state.selection?.datasetVersion === state.detail.data.datasetVersion
}
// Return only the current accepted success response, never reconstruct from UI fields.
// Treat the returned envelope as read-only; selection changes do not filter its contents.
export function getDownloadEnvelope(state: DatasetSessionState): SuccessEnvelope<AnalysisResult> | null {
  if (!state.downloadReady || state.isSearching || !canSearch(state)) return null
  const envelope = state.mode === 'trace' ? (state.response?.ok ? state.response.envelope : null)
    : state.mode === 'paths' ? (state.pathResponse?.ok ? state.pathResponse.result : null)
    : (state.patternResponse?.ok ? state.patternResponse.envelope : null)
  if (!envelope || envelope.meta.datasetId !== state.selection?.datasetId || envelope.meta.datasetVersion !== state.selection?.datasetVersion) return null
  return envelope
}

export function datasetKeyValue(key: DatasetKey): string {
  return JSON.stringify([key.datasetId, key.datasetVersion])
}
const aborted = (cause: unknown, signal: AbortSignal) => signal.aborted || (cause instanceof Error && cause.name === 'AbortError')

// Immutable snapshots make this store usable by React.useSyncExternalStore and testable without a DOM library.
export function createDatasetSession(dependencies: {
  datasets?: ReturnType<typeof createDatasetApi>; trace?: ReturnType<typeof createLiveTraceApi>
  patterns?: ReturnType<typeof createPatternApi>
  onInvalidPattern?: (diagnostic: PatternDiagnostic) => void
  paths?: ReturnType<typeof createPathsApi>
  onInvalid?: (diagnostic: InvalidDiagnostic) => void
  onInvalidPath?: (diagnostic: PathsDiagnostic) => void
} = {}) {
  const datasets = dependencies.datasets ?? createDatasetApi()
  const trace = dependencies.trace ?? createLiveTraceApi()
  const paths = dependencies.paths ?? createPathsApi()
  const patterns = dependencies.patterns ?? createPatternApi()
  const listeners = new Set<() => void>()
  let state: DatasetSessionState = {
    datasets: [], listStatus: 'idle', listError: null, selection: null, detail: null, detailStatus: 'idle', detailError: null,
    conditions: { ...DEFAULT_SEARCH_CONDITIONS }, response: null, isSearching: false, selectedTransferId: null,
    mode: 'trace', pathConditions: { ...DEFAULT_PATH_CONDITIONS }, pathResponse: null, pathValidationError: null,
    patternConditions: { ...DEFAULT_PATTERN_CONDITIONS }, patternResponse: null, patternValidationError: null,
    downloadReady: false, selectedPatternId: null, selectedPathId: null,
  }
  let listId = 0, detailId = 0, traceId = 0
  let listController: AbortController | undefined, detailController: AbortController | undefined, traceController: AbortController | undefined
  function update(patch: Partial<DatasetSessionState>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  function invalidateTrace(clearResult = false) {
    ++traceId
    traceController?.abort()
    traceController = undefined
    // One request generation covers all modes, so stale catch/finally cannot cross modes.
    update({ downloadReady: false, selectedPatternId: null, patternResponse: null, patternValidationError: null, isSearching: false, selectedTransferId: null, selectedPathId: null, pathResponse: null, pathValidationError: null, ...(clearResult ? { response: null } : {}) })
  }
  function cancelPending() {
    ++listId; ++detailId
    listController?.abort(); detailController?.abort()
    invalidateTrace()
    update({ listStatus: state.listStatus === 'loading' ? 'idle' : state.listStatus, detailStatus: state.detailStatus === 'loading' ? 'idle' : state.detailStatus })
  }
  async function selectDataset(key: DatasetKey) {
    const id = ++detailId
    detailController?.abort()
    invalidateTrace(true)
    const controller = new AbortController()
    detailController = controller
    update({ selection: { ...key }, detail: null, detailStatus: 'loading', detailError: null })
    try {
      const result = await datasets.getDataset(key, { signal: controller.signal })
      if (id !== detailId || controller.signal.aborted) return
      if (result.ok) update({ detail: result.envelope, detailStatus: 'ready' })
      else update({ detailStatus: 'error', detailError: result })
    } catch (cause) {
      if (id === detailId && !aborted(cause, controller.signal)) update({ detailStatus: 'error', detailError: searchFailure(cause) })
    }
  }
  async function loadDatasets() {
    cancelPending()
    const id = ++listId
    const controller = new AbortController()
    listController = controller
    update({ datasets: [], listStatus: 'loading', listError: null, selection: null, detail: null, detailStatus: 'idle', detailError: null, response: null })
    try {
      const result = await datasets.listDatasets({ signal: controller.signal })
      if (id !== listId || controller.signal.aborted) return
      if (!result.ok) { update({ listStatus: 'error', listError: result }); return }
      const rows = result.envelope.data
      update({ datasets: rows, listStatus: 'ready' })
      // If no READY version exists, still allow viewing the first dataset's information.
      const first = rows.find(row => row.status === 'READY') ?? rows[0]
      if (first) await selectDataset({ datasetId: first.datasetId, datasetVersion: first.datasetVersion })
    } catch (cause) {
      if (id === listId && !aborted(cause, controller.signal)) update({ listStatus: 'error', listError: searchFailure(cause) })
    }
  }
  async function search(address: string) {
    if (state.mode !== 'trace' || !canSearch(state) || !state.selection || !state.detail) return
    invalidateTrace(true)
    const id = traceId
    const controller = new AbortController()
    traceController = controller
    const selection = { ...state.selection }, detail = state.detail
    const request = buildLiveTraceRequest(selection, address, state.conditions)
    update({ isSearching: true })
    try {
      const result = await trace.searchTrace({ selection, dataset: detail, request, signal: controller.signal, onInvalid: dependencies.onInvalid })
      if (id !== traceId || controller.signal.aborted) return
      update({ response: result, downloadReady: result.ok })
      if (!result.ok && result.kind === 'api' && ['DATASET_NOT_READY', 'DATASET_INVALIDATED', 'DATASET_NOT_FOUND'].includes(result.error.code)) {
        // The server is authoritative if dataset state changes after the detail lookup.
        update({ detail: null, detailStatus: 'error', detailError: null })
      }
    } catch (cause) {
      if (id === traceId && !aborted(cause, controller.signal)) update({ response: searchFailure(cause) })
    } finally {
      if (id === traceId) update({ isSearching: false })
    }
  }
  async function searchPaths() {
    if (state.mode !== 'paths' || !canSearch(state) || !state.selection || !state.detail) return
    invalidateTrace(true)
    const conditions = { ...state.pathConditions }
    const validationError = validatePathAddresses(conditions.address, conditions.targetAddress)
    if (validationError) { update({ pathValidationError: validationError }); return }
    const id = traceId, controller = new AbortController()
    traceController = controller
    const selection = { ...state.selection }, dataset = state.detail
    const request = buildPathsRequest(selection, conditions.address, conditions.targetAddress, conditions)
    update({ isSearching: true })
    try {
      const result = await paths.searchPaths({ selection, dataset, request, signal: controller.signal, onInvalid: dependencies.onInvalidPath })
      if (id !== traceId || controller.signal.aborted) return
      update({ pathResponse: result, downloadReady: result.ok })
      if (!result.ok && result.kind === 'api' && ['DATASET_NOT_READY', 'DATASET_INVALIDATED', 'DATASET_NOT_FOUND'].includes(result.error.code)) {
        update({ detail: null, detailStatus: 'error', detailError: null })
      }
    } catch (cause) {
      if (id === traceId && !aborted(cause, controller.signal)) update({ pathResponse: searchFailure(cause) })
    } finally {
      if (id === traceId) update({ isSearching: false })
    }
  }
  async function searchPatterns() {
    if (state.mode !== 'patterns' || !canSearch(state) || !state.selection || !state.detail) return
    invalidateTrace(true)
    const conditions = { ...state.patternConditions }
    const validationError = validatePatternConditions(conditions)
    if (validationError) { update({ patternValidationError: validationError }); return }
    const id = traceId, controller = new AbortController()
    traceController = controller
    const selection = { ...state.selection }, dataset = state.detail
    update({ isSearching: true })
    try {
      const request = buildPatternRequest(selection, conditions.address, conditions.direction === 'all' ? undefined : conditions.direction)
      const result = await patterns.searchPatterns({ selection, dataset, request, signal: controller.signal, onInvalid: dependencies.onInvalidPattern })
      if (id !== traceId || controller.signal.aborted) return
      update({ patternResponse: result, downloadReady: result.ok })
      if (!result.ok && result.kind === 'api' && ['DATASET_NOT_READY', 'DATASET_INVALIDATED', 'DATASET_NOT_FOUND'].includes(result.error.code)) {
        update({ detail: null, detailStatus: 'error', detailError: null })
      }
    } catch (cause) {
      if (id === traceId && !aborted(cause, controller.signal)) update({ patternResponse: searchFailure(cause) })
    } finally {
      if (id === traceId) update({ isSearching: false })
    }
  }
  return {
    getSnapshot: () => state,
    getDownloadEnvelope: () => getDownloadEnvelope(state),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    loadDatasets, selectDataset, search, searchPaths, searchPatterns, cancelPending,
    setMode(mode: AnalysisMode) {
      if (mode === state.mode) return
      invalidateTrace(true); update({ mode })
    },
    setPathConditions(conditions: PathConditions) {
      invalidateTrace(true); update({ pathConditions: { ...conditions } })
    },
    setPatternConditions(conditions: PatternConditions) {
      invalidateTrace(true); update({ patternConditions: { ...conditions } })
    },
    cancelSearch() { invalidateTrace(true) },
    onTraceAddressChange() {
      // SearchBar owns the draft. Every edit invalidates export and any in-flight request.
      if (state.mode === 'trace') invalidateTrace()
    },
    setConditions(conditions: SearchConditions) { invalidateTrace(); update({ conditions: { ...conditions } }) },
    selectPath(id: string | null) {
      if (state.mode !== 'paths' || state.isSearching || !state.pathResponse?.ok) return
      if (id === null) { update({ selectedPathId: null }); return }
      const { paths, transfers } = state.pathResponse.result.data
      const next = resolvePathSelection(paths, transfers, id)
      if (next.path) update({ selectedPathId: id,
        selectedTransferId: state.selectedTransferId !== null && next.transferIds.has(state.selectedTransferId) ? state.selectedTransferId : null })
    },
    selectPattern(id: string | null) {
      if (state.mode !== 'patterns' || state.isSearching || !state.patternResponse?.ok) return
      if (id === null) { update({ selectedPatternId: null }); return }
      const { patterns, transfers } = state.patternResponse.envelope.data
      const next = resolvePatternSelection(patterns, transfers, id)
      if (next.pattern) update({ selectedPatternId: id,
        selectedTransferId: state.selectedTransferId !== null && next.transferIds.has(state.selectedTransferId) ? state.selectedTransferId : null })
    },
    selectTransfer(id: string) {
      if (state.mode === 'patterns') {
        if (state.isSearching || !state.patternResponse?.ok) return
        const { patterns, transfers } = state.patternResponse.envelope.data
        if (!transfers.some(transfer => transfer.id === id)) return
        const current = resolvePatternSelection(patterns, transfers, state.selectedPatternId)
        update({ selectedTransferId: id, selectedPatternId: current.transferIds.has(id) ? current.pattern!.patternId : null })
        return
      }
      if (state.mode === 'paths') {
        if (state.isSearching || !state.pathResponse?.ok) return
        const { paths, transfers } = state.pathResponse.result.data
        if (!transfers.some(transfer => transfer.id === id)) return
        const current = resolvePathSelection(paths, transfers, state.selectedPathId)
        update({ selectedTransferId: id, selectedPathId: current.transferIds.has(id) ? current.path!.id : null })
        return
      }
      if (state.response?.ok && state.response.result.transfers.some(transfer => transfer.id === id)) update({ selectedTransferId: id })
    },
  }
}
export type DatasetSession = ReturnType<typeof createDatasetSession>
