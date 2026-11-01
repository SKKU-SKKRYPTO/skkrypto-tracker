import type { Dataset, SuccessEnvelope, V1Error, AnalysisRequest, AnalysisResult, LimitStatus, Asset, Coverage } from '../api/v1Types'
import { isRecord, matchesResponse, matchesV1 } from '../api/validateV1'
import type { TraceResult } from '../types'
import type { SearchFailure } from '../api/searchFailure'

export type TraceResponse =
  | { ok: true; result: TraceResult }
  | { ok: false; kind: 'api'; status: number; error: V1Error }
  | { ok: false; kind: 'mock-unsupported' | 'invalid-response'; error: { message: string } }
  | SearchFailure

export type InvalidDiagnostic = {
  code: 'JSON_PARSE' | 'RESPONSE_SCHEMA' | 'DATASET_SCHEMA' | 'DATASET_MISMATCH'
    | 'COVERAGE_SCHEMA' | 'CONDITIONS_SCHEMA' | 'CONDITIONS_MISMATCH' | 'ASSET_SCHEMA'
    | 'LIMITS_SCHEMA' | 'LIMITS_MISMATCH' | 'ASSET_MISMATCH' | 'TRANSFER_ASSET_MISMATCH'
    | 'COVERAGE_MISMATCH' | 'REQUEST_MISMATCH' | 'DUPLICATE_TRANSFER_ID' | 'DUPLICATE_NODE_ID' | 'UNEXPECTED'
  path: string
}
type DatasetKey = Pick<Dataset, 'datasetId' | 'datasetVersion'>
type AdapterOptions = { onInvalid?: (diagnostic: InvalidDiagnostic) => void; expectedDataset?: DatasetKey }

// New HTTP callers must supply the selected key. The legacy entry point keeps Mock behavior unchanged.
export function adaptSelectedTraceResponse(raw: unknown, datasetRaw: unknown, selection: DatasetKey, status = 200, request?: AnalysisRequest, options?: Pick<AdapterOptions, 'onInvalid'>): TraceResponse {
  return adaptTraceResponse(raw, datasetRaw, status, request, { ...options, expectedDataset: selection })
}

export function adaptTraceResponse(raw: unknown, datasetRaw: unknown, status = 200, request?: AnalysisRequest, options?: AdapterOptions): TraceResponse {
  function invalid(code: InvalidDiagnostic['code'], path: string): TraceResponse {
    try { options?.onInvalid?.({ code, path }) } catch { /* Diagnostic observers cannot change the result. */ }
    return { ok: false, kind: 'invalid-response', error: { message: '응답 JSON이 공식 v1 규격 또는 현재 데이터셋·요청 조건과 맞지 않습니다.' } }
  }
  let exceptionCode: InvalidDiagnostic['code'] = 'JSON_PARSE'
  try {
    const envelope: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    exceptionCode = 'UNEXPECTED'
    // Preserve the original short-circuit order: schema/API error, dataset, effective conditions,
    // limits, asset, coverage, request, duplicate IDs. Return only the first failure, without schema re-diagnosis.
    if (!matchesResponse(envelope, 'POST', '/api/trace', status) || !isRecord(envelope)) return invalid('RESPONSE_SCHEMA', 'response')
    if (status !== 200) {
      if (envelope.data !== null || !matchesV1(envelope.error, 'Error')) return invalid('RESPONSE_SCHEMA', 'response')
      return { ok: false, kind: 'api', status, error: envelope.error as V1Error }
    }
    if (!matchesResponse(datasetRaw, 'GET', '/api/datasets/{id}', 200)) return invalid('DATASET_SCHEMA', 'dataset')
    const dataset = (datasetRaw as SuccessEnvelope<Dataset>).data
    const meta = envelope.meta as Record<string, unknown>
    const data = envelope.data as AnalysisResult
    const conditions = meta.conditions as AnalysisRequest | undefined

    const expected = options?.expectedDataset ?? { datasetId: 'flow-demo', datasetVersion: 'v1' }
    if (dataset.datasetId !== expected.datasetId) return invalid('DATASET_MISMATCH', 'dataset.data.datasetId')
    if (dataset.datasetVersion !== expected.datasetVersion) return invalid('DATASET_MISMATCH', 'dataset.data.datasetVersion')
    if (dataset.status !== 'READY') return invalid('DATASET_MISMATCH', 'dataset.data.status')
    if (meta.datasetId !== dataset.datasetId) return invalid('DATASET_MISMATCH', 'meta.datasetId')
    if (meta.datasetVersion !== dataset.datasetVersion) return invalid('DATASET_MISMATCH', 'meta.datasetVersion')
    if (meta.sourceMode !== dataset.sourceMode) return invalid('DATASET_MISMATCH', 'meta.sourceMode')

    if (!matchesV1(meta.coverage, 'Coverage')) return invalid('COVERAGE_SCHEMA', 'meta.coverage')
    if (!matchesV1(conditions, 'AnalysisRequest') || !conditions) return invalid('CONDITIONS_SCHEMA', 'meta.conditions')
    if (conditions.datasetId !== dataset.datasetId) return invalid('CONDITIONS_MISMATCH', 'meta.conditions.datasetId')
    if (conditions.datasetVersion !== dataset.datasetVersion) return invalid('CONDITIONS_MISMATCH', 'meta.conditions.datasetVersion')
    if (conditions.targetAddress !== undefined) return invalid('CONDITIONS_MISMATCH', 'meta.conditions.targetAddress')
    if (conditions.direction !== 'incoming' && conditions.direction !== 'outgoing') return invalid('CONDITIONS_MISMATCH', 'meta.conditions.direction')
    if (![1, 2, 3].includes(conditions.maxDepth ?? -1)) return invalid('CONDITIONS_MISMATCH', 'meta.conditions.maxDepth')
    if (!matchesV1(conditions.asset, 'Asset')) return invalid('ASSET_SCHEMA', 'meta.conditions.asset')
    if (!matchesV1(meta.limits, 'LimitStatus')) return invalid('LIMITS_SCHEMA', 'meta.limits')
    if (!sameLimits(data.limits, meta.limits as LimitStatus)) return invalid('LIMITS_MISMATCH', 'meta.limits')

    const asset = conditions.asset as Dataset['asset']
    if (!sameAsset(asset, dataset.asset)) return invalid('ASSET_MISMATCH', 'meta.conditions.asset')
    const badAssetIndex = data.transfers.findIndex(transfer => !sameAsset(transfer.asset, dataset.asset))
    if (badAssetIndex !== -1) return invalid('TRANSFER_ASSET_MISMATCH', `data.transfers[${badAssetIndex}].asset`)
    // coverage is the immutable collected range, not the narrower conditions.filter or analyzedUntil.
    if (!sameCoverage(meta.coverage as Coverage, dataset)) return invalid('COVERAGE_MISMATCH', 'meta.coverage')

    if (request) {
      // Selected-mode requests must agree with the explicit UI key, not only the returned metadata.
      if (options?.expectedDataset && request.datasetId !== expected.datasetId) return invalid('REQUEST_MISMATCH', 'request.datasetId')
      if (options?.expectedDataset && request.datasetVersion !== expected.datasetVersion) return invalid('REQUEST_MISMATCH', 'request.datasetVersion')
      if (conditions.address.toLowerCase() !== request.address.toLowerCase()) return invalid('REQUEST_MISMATCH', 'meta.conditions.address')
      if (conditions.direction !== request.direction) return invalid('REQUEST_MISMATCH', 'meta.conditions.direction')
      if (conditions.maxDepth !== request.maxDepth) return invalid('REQUEST_MISMATCH', 'meta.conditions.maxDepth')
      if (request.limits?.maxCandidates !== undefined && conditions.limits?.maxCandidates !== request.limits.maxCandidates) return invalid('REQUEST_MISMATCH', 'meta.conditions.limits.maxCandidates')
    }
    const duplicateTransfer = duplicateIdIndex(data.transfers)
    if (duplicateTransfer !== -1) return invalid('DUPLICATE_TRANSFER_ID', `data.transfers[${duplicateTransfer}].id`)
    const duplicateNode = duplicateIdIndex(data.nodes)
    if (duplicateNode !== -1) return invalid('DUPLICATE_NODE_ID', `data.nodes[${duplicateNode}].id`)
    return { ok: true, result: {
      sourceMode: dataset.sourceMode,
      asset: { ...asset },
      coverage: { ...(meta.coverage as TraceResult['coverage']) },
      conditions: structuredClone(conditions) as TraceResult['conditions'],
      nodes: structuredClone(data.nodes),
      transfers: structuredClone(data.transfers),
      limits: structuredClone(meta.limits as LimitStatus),
      limitations: [...(meta.limitations as string[])],
    } }
  } catch {
    return invalid(exceptionCode, 'response')
  }
}

function duplicateIdIndex(rows: readonly { id: string }[]): number {
  const seen = new Set<string>()
  return rows.findIndex(row => {
    if (seen.has(row.id)) return true
    seen.add(row.id)
    return false
  })
}

function sameLimits(left: LimitStatus, right: LimitStatus): boolean {
  return left.found === right.found && left.foundIsLowerBound === right.foundIsLowerBound &&
    left.statesVisited === right.statesVisited && left.candidatesConsidered === right.candidatesConsidered &&
    left.durationMs === right.durationMs && left.truncated?.reason === right.truncated?.reason &&
    JSON.stringify(left.truncated?.reasons) === JSON.stringify(right.truncated?.reasons) &&
    left.analyzedUntil?.blockNumber === right.analyzedUntil?.blockNumber && left.analyzedUntil?.timestamp === right.analyzedUntil?.timestamp
}


function sameAsset(left: Asset, right: Asset): boolean {
  return left.chainId === right.chainId && left.tokenAddress.toLowerCase() === right.tokenAddress.toLowerCase() &&
    left.decimals === right.decimals && left.symbol === right.symbol
}

function sameCoverage(left: Coverage, right: Coverage): boolean {
  return left.startBlock === right.startBlock && left.endBlock === right.endBlock &&
    sameInstant(left.startTime, right.startTime) && sameInstant(left.endTime, right.endTime)
}

// Compare equivalent RFC3339 spellings without losing sub-millisecond fractional precision.
function sameInstant(left: string, right: string): boolean {
  const seconds = (value: string) => Date.parse(value.replace(/\.\d+/, ''))
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').replace(/0+$/, '')
  return seconds(left) === seconds(right) && fraction(left) === fraction(right)
}
