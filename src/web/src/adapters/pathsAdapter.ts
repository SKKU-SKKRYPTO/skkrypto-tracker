import type { AnalysisResult, Asset, Coverage, Dataset, ErrorEnvelope, LimitStatus, Meta, PathsRequest, SuccessEnvelope, Transfer, V1Error } from '../api/v1Types'
import type { DatasetKey } from '../api/datasets'
import { matchesResponse, matchesV1 } from '../api/validateV1'

export type PathsResult = SuccessEnvelope<AnalysisResult> & {
  meta: Meta & {
    datasetId: string; datasetVersion: string; sourceMode: Dataset['sourceMode']
    coverage: Coverage; limits: LimitStatus
    conditions: PathsRequest & { direction: 'incoming' | 'outgoing'; maxDepth: number; asset: Asset }
  }
}
export type PathsDiagnostic = {
  code: 'JSON_PARSE' | 'RESPONSE_SCHEMA' | 'DATASET_SCHEMA' | 'DATASET_MISMATCH'
    | 'CONDITIONS_MISMATCH' | 'REQUEST_MISMATCH' | 'ASSET_MISMATCH' | 'COVERAGE_MISMATCH'
    | 'LIMITS_MISMATCH' | 'DUPLICATE_ID' | 'PATH_EVIDENCE' | 'UNEXPECTED'
  path: string
}
export type PathsAdapterOptions = { onInvalid?: (diagnostic: PathsDiagnostic) => void }
export type PathsResponse =
  | { ok: true; result: PathsResult }
  | { ok: false; kind: 'api'; status: number; error: V1Error; retryAfter?: string | null }
  | { ok: false; kind: 'invalid-response'; error: { message: string }; status?: number }

// A separate endpoint adapter keeps Trace/Mock behavior unchanged. Preserve the complete
// envelope: paths are candidate connections, not proof that the same funds travelled.
export function adaptPathsResponse(raw: unknown, datasetRaw: unknown, selection: DatasetKey, status = 200, request?: PathsRequest, options?: PathsAdapterOptions): PathsResponse {
  const invalid = (code: PathsDiagnostic['code'], path: string): PathsResponse => {
    try { options?.onInvalid?.({ code, path }) } catch { /* Observers cannot affect validation. */ }
    return { ok: false, kind: 'invalid-response', error: { message: '경로 응답이 공식 v1 규격 또는 현재 데이터셋·요청 조건과 맞지 않습니다.' } }
  }
  let exceptionCode: PathsDiagnostic['code'] = 'JSON_PARSE'
  try {
    const envelope: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    exceptionCode = 'UNEXPECTED'
    // First failure only: endpoint schema/API error, dataset, conditions/request,
    // asset/coverage/limits, IDs, then path references and chronological connections.
    if (!matchesResponse(envelope, 'POST', '/api/paths', status)) return invalid('RESPONSE_SCHEMA', 'response')
    if (status !== 200) return { ok: false, kind: 'api', status, error: structuredClone((envelope as ErrorEnvelope).error) }
    if (!matchesResponse(datasetRaw, 'GET', '/api/datasets/{id}', 200)) return invalid('DATASET_SCHEMA', 'dataset')
    const dataset = (datasetRaw as SuccessEnvelope<Dataset>).data
    const response = envelope as SuccessEnvelope<AnalysisResult>
    const { data, meta } = response
    if (dataset.datasetId !== selection.datasetId || dataset.datasetVersion !== selection.datasetVersion || dataset.status !== 'READY') return invalid('DATASET_MISMATCH', 'dataset.data')
    if (meta.datasetId !== selection.datasetId || meta.datasetVersion !== selection.datasetVersion || meta.sourceMode !== dataset.sourceMode) return invalid('DATASET_MISMATCH', 'meta')
    if (!matchesV1(meta.conditions, 'PathsRequest')) return invalid('CONDITIONS_MISMATCH', 'meta.conditions')
    const conditions = meta.conditions as PathsRequest
    if (conditions.datasetId !== selection.datasetId || conditions.datasetVersion !== selection.datasetVersion ||
      conditions.address.toLowerCase() === conditions.targetAddress.toLowerCase() ||
      !['incoming', 'outgoing'].includes(conditions.direction ?? '') || ![1, 2, 3].includes(conditions.maxDepth ?? -1)) return invalid('CONDITIONS_MISMATCH', 'meta.conditions')
    if (request) {
      // Optional undefined properties are omitted by the HTTP client's JSON.stringify.
      // Validate the same wire representation, so they retain the API's defaults.
      const sentRequest = JSON.parse(JSON.stringify(request)) as PathsRequest
      if (!matchesV1(sentRequest, 'PathsRequest') || sentRequest.datasetId !== selection.datasetId || sentRequest.datasetVersion !== selection.datasetVersion ||
        conditions.address.toLowerCase() !== sentRequest.address.toLowerCase() || conditions.targetAddress.toLowerCase() !== sentRequest.targetAddress.toLowerCase() ||
        conditions.direction !== (sentRequest.direction ?? 'outgoing') || conditions.maxDepth !== (sentRequest.maxDepth || 2) ||
        conditions.startTransferId !== sentRequest.startTransferId) return invalid('REQUEST_MISMATCH', 'meta.conditions')
      for (const [key, value] of Object.entries(sentRequest.limits ?? {})) {
        if (value !== 0 && conditions.limits?.[key as keyof NonNullable<PathsRequest['limits']>] !== value) return invalid('REQUEST_MISMATCH', `meta.conditions.limits.${key}`)
      }
      for (const [key, value] of Object.entries(sentRequest.filter ?? {})) {
        const actual = conditions.filter?.[key as keyof NonNullable<PathsRequest['filter']>]
        if (typeof actual !== 'string' || (key.endsWith('Time') ? !sameInstant(actual, value) : actual !== value)) return invalid('REQUEST_MISMATCH', `meta.conditions.filter.${key}`)
      }
      if (sentRequest.asset && (sentRequest.asset.chainId !== dataset.asset.chainId || sentRequest.asset.tokenAddress.toLowerCase() !== dataset.asset.tokenAddress.toLowerCase())) return invalid('REQUEST_MISMATCH', 'request.asset')
    }
    if (!matchesV1(conditions.asset, 'Asset') || !sameAsset(conditions.asset as Asset, dataset.asset)) return invalid('ASSET_MISMATCH', 'meta.conditions.asset')
    const assetIndex = data.transfers.findIndex(transfer => !sameAsset(transfer.asset, dataset.asset))
    if (assetIndex !== -1) return invalid('ASSET_MISMATCH', `data.transfers[${assetIndex}].asset`)
    if (!matchesV1(meta.coverage, 'Coverage') || !sameCoverage(meta.coverage as Coverage, dataset)) return invalid('COVERAGE_MISMATCH', 'meta.coverage')
    if (!matchesV1(meta.limits, 'LimitStatus') || !sameLimits(data.limits, meta.limits as LimitStatus)) return invalid('LIMITS_MISMATCH', 'meta.limits')
    for (const [name, rows] of [['transfers', data.transfers], ['nodes', data.nodes], ['paths', data.paths]] as const) {
      const seen = new Set<string>()
      const duplicate = rows.findIndex(row => { if (seen.has(row.id)) return true; seen.add(row.id); return false })
      if (duplicate !== -1) return invalid('DUPLICATE_ID', `data.${name}[${duplicate}].id`)
    }
    const transfers = new Map(data.transfers.map(transfer => [transfer.id, transfer]))
    for (const [index, path] of data.paths.entries()) {
      const location = `data.paths[${index}]`
      if (path.hops !== path.transferIds.length || path.hops > conditions.maxDepth!) return invalid('PATH_EVIDENCE', `${location}.hops`)
      if (new Set(path.transferIds).size !== path.transferIds.length) return invalid('PATH_EVIDENCE', `${location}.transferIds`)
      const evidence: Transfer[] = []
      for (const [i, id] of path.transferIds.entries()) {
        const transfer = transfers.get(id)
        if (!transfer) return invalid('PATH_EVIDENCE', `${location}.transferIds[${i}]`)
        evidence.push(transfer)
      }
      // Even incoming paths arrive in money-flow order. Never reverse the API array.
      const from = conditions.direction === 'incoming' ? conditions.targetAddress : conditions.address
      const to = conditions.direction === 'incoming' ? conditions.address : conditions.targetAddress
      if (evidence[0].from.toLowerCase() !== from.toLowerCase() || evidence.at(-1)!.to.toLowerCase() !== to.toLowerCase()) return invalid('PATH_EVIDENCE', `${location}.transferIds`)
      for (let i = 1; i < evidence.length; i++) {
        if (evidence[i - 1].to.toLowerCase() !== evidence[i].from.toLowerCase() || !precedes(evidence[i - 1], evidence[i])) return invalid('PATH_EVIDENCE', `${location}.transferIds[${i}]`)
      }
    }
    return { ok: true, result: structuredClone(response) as PathsResult }
  } catch {
    return invalid(exceptionCode, 'response')
  }
}

function sameAsset(a: Asset, b: Asset): boolean {
  return a.chainId === b.chainId && a.tokenAddress.toLowerCase() === b.tokenAddress.toLowerCase() && a.symbol === b.symbol && a.decimals === b.decimals
}
function sameInstant(a: string, b: string): boolean {
  const seconds = (value: string) => Date.parse(value.replace(/\.\d+/, ''))
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').replace(/0+$/, '')
  return seconds(a) === seconds(b) && fraction(a) === fraction(b)
}
function sameCoverage(a: Coverage, b: Coverage): boolean {
  return a.startBlock === b.startBlock && a.endBlock === b.endBlock && sameInstant(a.startTime, b.startTime) && sameInstant(a.endTime, b.endTime)
}
function sameLimits(a: LimitStatus, b: LimitStatus): boolean {
  return a.found === b.found && a.foundIsLowerBound === b.foundIsLowerBound && a.statesVisited === b.statesVisited &&
    a.candidatesConsidered === b.candidatesConsidered && a.durationMs === b.durationMs &&
    a.truncated?.reason === b.truncated?.reason && JSON.stringify(a.truncated?.reasons) === JSON.stringify(b.truncated?.reasons) &&
    a.analyzedUntil?.blockNumber === b.analyzedUntil?.blockNumber && a.analyzedUntil?.timestamp === b.analyzedUntil?.timestamp
}
function precedes(a: Transfer, b: Transfer): boolean {
  // Block numbers are decimal strings; do not pass them through Number.
  if (a.blockNumber !== b.blockNumber) return BigInt(a.blockNumber) < BigInt(b.blockNumber)
  if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex < b.transactionIndex
  return a.logIndex < b.logIndex
}
