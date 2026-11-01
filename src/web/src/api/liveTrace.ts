import type { AnalysisRequest, Dataset, SuccessEnvelope } from './v1Types'
import type { DatasetKey } from './datasets'
import type { SearchConditions } from '../searchConditions'
import { createHttpClient } from './httpClient'
import type { HttpClient } from './httpClient'
import { adaptSelectedTraceResponse } from '../adapters/traceAdapter'
import type { InvalidDiagnostic, TraceResponse } from '../adapters/traceAdapter'

export type LiveTraceResponse = TraceResponse & { retryAfter?: string | null }
export type LiveTraceInput = {
  selection: DatasetKey
  dataset: SuccessEnvelope<Dataset>
  request: AnalysisRequest
  signal?: AbortSignal
  onInvalid?: (diagnostic: InvalidDiagnostic) => void
}
export function buildLiveTraceRequest(key: DatasetKey, address: string, conditions: SearchConditions): AnalysisRequest {
  return { ...key, address: address.trim().toLowerCase(), direction: conditions.direction, maxDepth: conditions.maxDepth }
}
export function createLiveTraceApi(http: HttpClient = createHttpClient()) {
  return {
    async searchTrace(input: LiveTraceInput): Promise<LiveTraceResponse> {
      const reply = await http('/api/trace', { method: 'POST', body: input.request, signal: input.signal })
      if (!reply.ok) {
        // The transport has already identified a JSON syntax error. Preserve diagnostics without re-parsing.
        try { input.onInvalid?.({ code: 'JSON_PARSE', path: 'response' }) } catch { /* Observer only. */ }
        return reply
      }
      const result = adaptSelectedTraceResponse(reply.body, input.dataset, input.selection, reply.status, input.request, { onInvalid: input.onInvalid })
      return !result.ok && result.kind === 'api' ? { ...result, retryAfter: reply.retryAfter } : result
    },
  }
}
