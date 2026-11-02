import type { Dataset, PathsRequest, SuccessEnvelope } from './v1Types'
import type { DatasetKey } from './datasets'
import type { SearchConditions } from '../searchConditions'
import { createHttpClient } from './httpClient'
import type { HttpClient } from './httpClient'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PathsDiagnostic, PathsResponse } from '../adapters/pathsAdapter'

export type PathsInput = {
  selection: DatasetKey
  dataset: SuccessEnvelope<Dataset>
  request: PathsRequest
  signal?: AbortSignal
  onInvalid?: (diagnostic: PathsDiagnostic) => void
}
export function buildPathsRequest(key: DatasetKey, address: string, targetAddress: string, conditions: SearchConditions,
  options: Pick<PathsRequest, 'asset' | 'startTransferId' | 'filter' | 'limits'> = {}): PathsRequest {
  return { ...structuredClone(options), ...key, address: address.trim().toLowerCase(), targetAddress: targetAddress.trim().toLowerCase(), direction: conditions.direction, maxDepth: conditions.maxDepth }
}
export function createPathsApi(http: HttpClient = createHttpClient()) {
  return {
    async searchPaths(input: PathsInput): Promise<PathsResponse> {
      const reply = await http('/api/paths', { method: 'POST', body: input.request, signal: input.signal })
      if (!reply.ok) {
        try { input.onInvalid?.({ code: 'JSON_PARSE', path: 'response' }) } catch { /* Observer only. */ }
        return reply
      }
      const result = adaptPathsResponse(reply.body, input.dataset, input.selection, reply.status, input.request, { onInvalid: input.onInvalid })
      return !result.ok && result.kind === 'api' ? { ...result, retryAfter: reply.retryAfter } : result
    },
  }
}
