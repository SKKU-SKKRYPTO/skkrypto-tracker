import type { Dataset, ErrorEnvelope, SuccessEnvelope, V1Error } from './v1Types'
import { matchesResponse } from './validateV1'
import { createHttpClient } from './httpClient'
import type { HttpClient, HttpResult, InvalidHttpResponse } from './httpClient'

export type DatasetKey = Pick<Dataset, 'datasetId' | 'datasetVersion'>
export type DatasetResponse<T> =
  | { ok: true; envelope: SuccessEnvelope<T> }
  | { ok: false; kind: 'api'; status: number; error: V1Error; retryAfter: string | null }
  | InvalidHttpResponse
export type DatasetRequestOptions = { signal?: AbortSignal }

function invalid(status: number): InvalidHttpResponse {
  return { ok: false, kind: 'invalid-response', status, error: { message: '데이터셋 응답이 공식 v1 규격 또는 요청한 데이터셋·버전과 맞지 않습니다.' } }
}
function decode<T>(reply: HttpResult, path: '/api/datasets' | '/api/datasets/{id}'): DatasetResponse<T> {
  if (!reply.ok) return reply
  if (!matchesResponse(reply.body, 'GET', path, reply.status)) return invalid(reply.status)
  if (reply.status !== 200) {
    return { ok: false, kind: 'api', status: reply.status, error: (reply.body as ErrorEnvelope).error, retryAfter: reply.retryAfter }
  }
  return { ok: true, envelope: reply.body as SuccessEnvelope<T> }
}

// Dataset information is available in every status; only the later trace action requires READY.
export function createDatasetApi(http: HttpClient = createHttpClient()) {
  return {
    async listDatasets(options: DatasetRequestOptions = {}): Promise<DatasetResponse<Dataset[]>> {
      return decode<Dataset[]>(await http('/api/datasets', { signal: options.signal }), '/api/datasets')
    },
    async getDataset(key: DatasetKey, options: DatasetRequestOptions = {}): Promise<DatasetResponse<Dataset>> {
      if (!key.datasetId || !key.datasetVersion) throw new RangeError('datasetId and datasetVersion are required')
      const query = new URLSearchParams({ datasetVersion: key.datasetVersion })
      const reply = await http(`/api/datasets/${encodeURIComponent(key.datasetId)}?${query}`, { signal: options.signal })
      const result = decode<Dataset>(reply, '/api/datasets/{id}')
      if (!result.ok) return result
      const { data, meta } = result.envelope
      if (data.datasetId !== key.datasetId || data.datasetVersion !== key.datasetVersion ||
        (meta.datasetId !== undefined && meta.datasetId !== key.datasetId) ||
        (meta.datasetVersion !== undefined && meta.datasetVersion !== key.datasetVersion) ||
        (meta.sourceMode !== undefined && meta.sourceMode !== data.sourceMode)) return invalid(200)
      return result
    },
  }
}
