import type { AnalysisRequest, Dataset, ErrorEnvelope, SuccessEnvelope } from '../api/v1Types'
import type { DatasetKey } from '../api/datasets'
import { isRecord, matchesResponse, matchesV1 } from '../api/validateV1'
import type { PatternEnvelope, PatternResponse, PatternDiagnostic, PatternInput, PatternRequest } from '../api/patterns'

export function validatePatternRequest(r: unknown): asserts r is PatternRequest {
  if (!isRecord(r) ||
      !matchesV1(r, 'AnalysisRequest') ||
      ['targetAddress', 'startTransferId', 'maxDepth'].some(k => Object.hasOwn(r, k))) throw new RangeError('잘못된 Pattern 요청입니다.')
  const f = (r as PatternRequest).filter
  if (f?.startBlock !== undefined && f.endBlock !== undefined && BigInt(f.startBlock) > BigInt(f.endBlock) ||
      f?.startTime !== undefined && f.endTime !== undefined && instant(f.startTime) > instant(f.endTime)) throw new RangeError('잘못된 필터 범위입니다.')
}
export function validatePatternDataset(dataset: unknown, selection: DatasetKey, request: PatternRequest): asserts dataset is SuccessEnvelope<Dataset> {
  if (!matchesResponse(dataset, 'GET', '/api/datasets/{id}', 200)) throw new RangeError('공식 데이터셋 상세 응답이 필요합니다.')
  const ds = (dataset as SuccessEnvelope<Dataset>).data
  if (ds.status !== 'READY' ||
      ds.datasetId !== selection.datasetId ||
      ds.datasetVersion !== selection.datasetVersion ||
      request.datasetId !== selection.datasetId ||
      request.datasetVersion !== selection.datasetVersion ||
      request.asset && !subset(request.asset, ds.asset)) throw new RangeError('선택한 READY 데이터셋과 요청이 일치해야 합니다.')
}
// Go timestamps carry nanoseconds; avoid millisecond rounding at half-open boundaries.
function instant(s: string): bigint { return BigInt(Date.parse(s.replace(/\.\d+/, ''))) * 1000000n + BigInt((s.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0').slice(0, 9)) }
function equal(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return matchesV1(a, 'DateTime') && matchesV1(b, 'DateTime') ? instant(a) === instant(b) : a.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]))
  if (isRecord(a) && isRecord(b)) return Object.keys(a).length === Object.keys(b).length && subset(a, b)
  return a === b
}
function subset(a: object, b: object): boolean { return Object.entries(a).every(([k, v]) => v === undefined || equal(v, (b as Record<string, unknown>)[k])) }
const unique = (v: string[]) => new Set(v).size === v.length

// Pattern-specific validation; no Trace or Path adapter assumptions. The complete official
// envelope is cloned, preserving each window, shared groupId, limits and limitations.
export function adaptPatternResponse(raw: unknown, dataset: SuccessEnvelope<Dataset>, selection: DatasetKey, request: PatternRequest, status = 200, onInvalid?: PatternInput['onInvalid']): PatternResponse {
  const invalid = (code: PatternDiagnostic['code'], path: string): PatternResponse => {
    try { onInvalid?.({ code, path }) } catch { /* Diagnostic observer only. */ }
    return { ok: false, kind: 'invalid-response', status, error: { message: 'Pattern 응답이 공식 규격 또는 데이터셋·요청·근거와 맞지 않습니다.' } }
  }
  if (!matchesResponse(raw, 'POST', '/api/patterns', status)) return invalid('RESPONSE_SCHEMA', 'response')
  if (status !== 200) {
    const envelope = structuredClone(raw) as ErrorEnvelope
    return { ok: false, kind: 'api', status, envelope, error: envelope.error }
  }
  try { validatePatternRequest(request); validatePatternDataset(dataset, selection, request) } catch { return invalid('DATASET_MISMATCH', 'dataset') }
  const envelope = raw as PatternEnvelope
  const { data, meta } = envelope
  const ds = dataset.data
  const c = meta.conditions as AnalysisRequest | undefined
  if (meta.datasetId !== ds.datasetId ||
      meta.datasetVersion !== ds.datasetVersion ||
      meta.sourceMode !== ds.sourceMode ||
      !matchesV1(meta.coverage, 'Coverage') ||
      !subset(meta.coverage!, ds)) return invalid('DATASET_MISMATCH', 'meta')
  if (!c ||
      !matchesV1(c, 'AnalysisRequest') ||
      !matchesV1(c.asset, 'Asset') ||
      !equal(c.asset, ds.asset) ||
      c.targetAddress !== undefined ||
      c.startTransferId !== undefined ||
      c.maxDepth !== undefined ||
      c.datasetId !== request.datasetId ||
      c.datasetVersion !== request.datasetVersion ||
      !equal(c.address, request.address) ||
      c.direction !== request.direction ||
      request.filter && (!c.filter ||
      !subset(request.filter, c.filter))) return invalid('REQUEST_MISMATCH', 'meta.conditions')
  // The server fills omitted range bounds and limits. Reject silently changed conditions.
  const expectedFilter = { startBlock: ds.startBlock, endBlock: ds.endBlock, startTime: ds.startTime, endTime: ds.endTime, ...request.filter }
  const expectedLimits = {
    maxNodes: request.limits?.maxNodes || 200,
    maxEdges: request.limits?.maxEdges || 500,
    maxPaths: request.limits?.maxPaths || 10,
    maxStates: request.limits?.maxStates || 10000,
    maxCandidates: request.limits?.maxCandidates || 10000,
    timeBudgetMs: request.limits?.timeBudgetMs || 1500,
  }
  if (!equal(c.filter, expectedFilter) || !equal(c.limits, expectedLimits)) return invalid('REQUEST_MISMATCH', 'meta.conditions')
  const l = data.limits
  if (!equal(l, meta.limits) ||
      l.found !== data.patterns.length ||
      l.foundIsLowerBound && !l.truncated ||
      l.truncated && (!unique(l.truncated.reasons) ||
      !l.truncated.reasons.includes(l.truncated.reason))) return invalid('PATTERN_INTEGRITY', 'data.limits')
  if (meta.ruleVersion !== 'flow-v1' ||
      data.paths.length ||
      !unique(data.transfers.map(t => t.id)) ||
      !unique(data.nodes.map(n => n.id.toLowerCase())) ||
      !unique(data.patterns.map(p => p.patternId))) return invalid('PATTERN_INTEGRITY', 'data')
  const nodes = new Set(data.nodes.map(n => n.id.toLowerCase()))
  const transfers = new Map(data.transfers.map(t => [t.id, t]))
  const used = new Set<string>()
  for (const t of data.transfers) {
    const f = c.filter
    if (!equal(t.asset, ds.asset) ||
      !nodes.has(t.from.toLowerCase()) ||
      !nodes.has(t.to.toLowerCase()) ||
      BigInt(t.blockNumber) < BigInt(ds.startBlock) ||
      BigInt(t.blockNumber) > BigInt(ds.endBlock) ||
      instant(t.timestamp) < instant(ds.startTime) ||
      instant(t.timestamp) > instant(ds.endTime) ||
      f?.startBlock !== undefined && BigInt(t.blockNumber) < BigInt(f.startBlock) ||
      f?.endBlock !== undefined && BigInt(t.blockNumber) > BigInt(f.endBlock) ||
      f?.startTime !== undefined && instant(t.timestamp) < instant(f.startTime) ||
      f?.endTime !== undefined && instant(t.timestamp) > instant(f.endTime) ||
      f?.minAmountRaw !== undefined && BigInt(t.amountRaw) < BigInt(f.minAmountRaw)) return invalid('PATTERN_INTEGRITY', 'data.transfers')
  }
  for (const [i, p] of data.patterns.entries()) {
    const path = `data.patterns[${i}]`
    if (p.ruleVersion !== meta.ruleVersion ||
      !equal(p.asset, ds.asset) ||
      !equal(p.address, request.address) ||
      p.direction !== (p.ruleId === 'FAN_IN' ? 'incoming' : 'outgoing') ||
      request.direction && p.direction !== request.direction ||
      p.windowSeconds !== 600 ||
      p.threshold !== 3 ||
      instant(p.windowEnd) - instant(p.windowStart) !== 600000000000n ||
      !unique(p.evidenceIds) ||
      !unique(p.counterparties.map(a => a.toLowerCase())) ||
      p.uniqueCounterparties !== p.counterparties.length ||
      p.uniqueCounterparties < 3) return invalid('PATTERN_INTEGRITY', path)
    const others = new Set<string>()
    let starts = false
    for (const id of p.evidenceIds) {
      const t = transfers.get(id)
      if (!t ||
      t.transferType !== 'TRANSFER' ||
      BigInt(t.amountRaw) === 0n ||
      equal(t.from, t.to) ||
      /^0x0{40}$/.test(t.from) ||
      /^0x0{40}$/.test(t.to) ||
      !equal(t.asset, p.asset) ||
      !equal(p.direction === 'incoming' ? t.to : t.from, p.address) ||
      instant(t.timestamp) < instant(p.windowStart) ||
      instant(t.timestamp) >= instant(p.windowEnd)) return invalid('PATTERN_INTEGRITY', `${path}.evidenceIds`)
      starts ||= instant(t.timestamp) === instant(p.windowStart)
      others.add((p.direction === 'incoming' ? t.from : t.to).toLowerCase())
      used.add(id)
    }
    if (!starts || others.size !== p.uniqueCounterparties || !p.counterparties.every(a => others.has(a.toLowerCase()))) return invalid('PATTERN_INTEGRITY', path)
  }
  if (used.size !== transfers.size ||
      data.summary.uniqueTransferCount !== transfers.size ||
      BigInt(data.summary.uniqueAmountRaw) !== data.transfers.reduce((s, t) => s + BigInt(t.amountRaw), 0n)) return invalid('PATTERN_INTEGRITY', 'data.summary')
  return { ok: true, envelope: structuredClone(envelope) }
}
