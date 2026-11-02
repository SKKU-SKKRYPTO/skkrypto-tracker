import type { AnalysisRequest, AnalysisResult, Dataset, ErrorEnvelope, SuccessEnvelope } from './v1Types'
import type { DatasetKey } from './datasets'
import { createHttpClient, type HttpClient } from './httpClient'
import { adaptPatternResponse, validatePatternDataset, validatePatternRequest } from '../adapters/patternAdapter'
export type PatternRequest = Omit<AnalysisRequest, 'targetAddress' | 'startTransferId' | 'maxDepth'> & { targetAddress?: never; startTransferId?: never; maxDepth?: never }
export type PatternEnvelope = SuccessEnvelope<AnalysisResult>
export type PatternResponse =
  | { ok: true; envelope: PatternEnvelope }
  | { ok: false; kind: 'api'; status: number; envelope: ErrorEnvelope; error: ErrorEnvelope['error']; retryAfter?: string | null }
  | { ok: false; kind: 'invalid-response'; status: number; error: { message: string } }
export type PatternDiagnostic = { code: 'RESPONSE_SCHEMA' | 'DATASET_MISMATCH' | 'REQUEST_MISMATCH' | 'PATTERN_INTEGRITY'; path: string }
export type PatternInput = { selection: DatasetKey; dataset: SuccessEnvelope<Dataset>; request: PatternRequest; signal?: AbortSignal; onInvalid?: (diagnostic: PatternDiagnostic) => void }
export function buildPatternRequest(selection: DatasetKey, address: string, direction?: PatternRequest['direction']): PatternRequest {
  const r = { datasetId: selection.datasetId, datasetVersion: selection.datasetVersion, address: address.trim().toLowerCase(), ...(direction === undefined ? {} : { direction }) }
  validatePatternRequest(r)
  return r
}
export function createPatternApi(http: HttpClient = createHttpClient()) {
  return { async searchPatterns(input: PatternInput): Promise<PatternResponse> {
    validatePatternRequest(input.request)
    validatePatternDataset(input.dataset, input.selection, input.request)
    const snapshot = structuredClone({ request: input.request, dataset: input.dataset, selection: input.selection })
    const reply = await http('/api/patterns', { method: 'POST', body: snapshot.request, signal: input.signal })
    if (!reply.ok) return reply
    const result = adaptPatternResponse(reply.body, snapshot.dataset, snapshot.selection, snapshot.request, reply.status, input.onInvalid)
    return !result.ok && result.kind === 'api' ? { ...result, retryAfter: reply.retryAfter } : result
  } }
}
