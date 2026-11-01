import { createDatasetApi } from '../api/datasets'
import type { DatasetKey, DatasetResponse } from '../api/datasets'
import { buildLiveTraceRequest, createLiveTraceApi } from '../api/liveTrace'
import type { LiveTraceResponse } from '../api/liveTrace'
import { searchFailure } from '../api/searchFailure'
import type { InvalidDiagnostic } from '../adapters/traceAdapter'
import type { Dataset, SuccessEnvelope } from '../api/v1Types'
import { DEFAULT_SEARCH_CONDITIONS } from '../searchConditions'
import type { SearchConditions } from '../searchConditions'

export type RequestFailure = Exclude<DatasetResponse<unknown>, { ok: true }> | Exclude<LiveTraceResponse, { ok: true }>
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type DatasetSessionState = {
  datasets: Dataset[]; listStatus: LoadStatus; listError: RequestFailure | null
  selection: DatasetKey | null; detail: SuccessEnvelope<Dataset> | null; detailStatus: LoadStatus; detailError: RequestFailure | null
  conditions: SearchConditions; response: LiveTraceResponse | null; isSearching: boolean; selectedTransferId: string | null
}
export function canSearch(state: DatasetSessionState): boolean {
  return state.detailStatus === 'ready' && state.detail?.data.status === 'READY' &&
    state.selection?.datasetId === state.detail.data.datasetId && state.selection?.datasetVersion === state.detail.data.datasetVersion
}
export function datasetKeyValue(key: DatasetKey): string {
  return JSON.stringify([key.datasetId, key.datasetVersion])
}
const aborted = (cause: unknown, signal: AbortSignal) => signal.aborted || (cause instanceof Error && cause.name === 'AbortError')

// Immutable snapshots make this store usable by React.useSyncExternalStore and testable without a DOM library.
export function createDatasetSession(dependencies: {
  datasets?: ReturnType<typeof createDatasetApi>; trace?: ReturnType<typeof createLiveTraceApi>
  onInvalid?: (diagnostic: InvalidDiagnostic) => void
} = {}) {
  const datasets = dependencies.datasets ?? createDatasetApi()
  const trace = dependencies.trace ?? createLiveTraceApi()
  const listeners = new Set<() => void>()
  let state: DatasetSessionState = {
    datasets: [], listStatus: 'idle', listError: null, selection: null, detail: null, detailStatus: 'idle', detailError: null,
    conditions: { ...DEFAULT_SEARCH_CONDITIONS }, response: null, isSearching: false, selectedTransferId: null,
  }
  let listId = 0, detailId = 0, traceId = 0
  let listController: AbortController | undefined, detailController: AbortController | undefined, traceController: AbortController | undefined
  function update(patch: Partial<DatasetSessionState>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  function invalidateTrace(clearResult = false) {
    ++traceId
    traceController?.abort()
    traceController = undefined
    update({ isSearching: false, selectedTransferId: null, ...(clearResult ? { response: null } : {}) })
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
    if (!canSearch(state) || !state.selection || !state.detail) return
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
      update({ response: result })
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
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    loadDatasets, selectDataset, search, cancelPending,
    setConditions(conditions: SearchConditions) { invalidateTrace(); update({ conditions: { ...conditions } }) },
    selectTransfer(id: string) {
      if (state.response?.ok && state.response.result.transfers.some(transfer => transfer.id === id)) update({ selectedTransferId: id })
    },
  }
}
export type DatasetSession = ReturnType<typeof createDatasetSession>
