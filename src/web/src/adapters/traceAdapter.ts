import type { Dataset, SuccessEnvelope, V1Error, AnalysisRequest, AnalysisResult, LimitStatus, Asset, Coverage } from '../api/v1Types'
import { isRecord, matchesResponse, matchesV1 } from '../api/validateV1'
import type { TraceResult } from '../types'
import type { SearchFailure } from '../api/searchFailure'

export type TraceResponse =
  | { ok: true; result: TraceResult }
  | { ok: false; kind: 'api'; status: number; error: V1Error }
  | { ok: false; kind: 'mock-unsupported' | 'invalid-response'; error: { message: string } }
  | SearchFailure

function invalid(): TraceResponse {
  return { ok: false, kind: 'invalid-response', error: { message: '응답 JSON이 공식 v1 규격 또는 현재 데이터셋·요청 조건과 맞지 않습니다.' } }
}

export function adaptTraceResponse(raw: unknown, datasetRaw: unknown, status = 200, request?: AnalysisRequest): TraceResponse {
  try {
    const envelope: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!matchesResponse(envelope, 'POST', '/api/trace', status) || !isRecord(envelope)) return invalid()
    if (status !== 200) {
      if (envelope.data !== null || !matchesV1(envelope.error, 'Error')) return invalid()
      return { ok: false, kind: 'api', status, error: envelope.error as V1Error }
    }
    if (!matchesResponse(datasetRaw, 'GET', '/api/datasets/{id}', 200)) return invalid()
    const dataset = (datasetRaw as SuccessEnvelope<Dataset>).data
    const meta = envelope.meta as Record<string, unknown>
    const data = envelope.data as AnalysisResult
    const conditions = meta.conditions as AnalysisRequest | undefined
    if (dataset.datasetId !== 'flow-demo' || dataset.datasetVersion !== 'v1' || dataset.status !== 'READY' ||
      meta.datasetId !== dataset.datasetId || meta.datasetVersion !== dataset.datasetVersion ||
      meta.sourceMode !== dataset.sourceMode || !matchesV1(meta.coverage, 'Coverage') ||
      !matchesV1(conditions, 'AnalysisRequest') || !conditions ||
      conditions.datasetId !== dataset.datasetId || conditions.datasetVersion !== dataset.datasetVersion ||
      conditions.targetAddress !== undefined ||
      (conditions.direction !== 'incoming' && conditions.direction !== 'outgoing') ||
      ![1, 2, 3].includes(conditions.maxDepth ?? -1) || !matchesV1(conditions.asset, 'Asset') ||
      !matchesV1(meta.limits, 'LimitStatus') || !sameLimits(data.limits, meta.limits as LimitStatus)) return invalid()
    const asset = conditions.asset as Dataset['asset']
    if (!sameAsset(asset, dataset.asset) || data.transfers.some(transfer => !sameAsset(transfer.asset, dataset.asset))) return invalid()
    // coverage is the immutable collected range, not the narrower conditions.filter or analyzedUntil.
    if (!sameCoverage(meta.coverage as Coverage, dataset)) return invalid()
    if (request && (conditions.address.toLowerCase() !== request.address.toLowerCase() ||
      conditions.direction !== request.direction || conditions.maxDepth !== request.maxDepth ||
      (request.limits?.maxCandidates !== undefined && conditions.limits?.maxCandidates !== request.limits.maxCandidates))) return invalid()
    if (new Set(data.transfers.map(t => t.id)).size !== data.transfers.length || new Set(data.nodes.map(n => n.id)).size !== data.nodes.length) return invalid()
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
    return invalid()
  }
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
