// 주소 추적 검색. 지금은 서버가 없어서 mocks/*.draft.json으로 응답을 흉내 낸다.
// 실제 API가 나오면 이 파일의 searchTrace 안쪽만 fetch로 바꾸면 된다.
// 화면 쪽은 searchTrace가 돌려주는 TraceResponse 모양만 알면 된다.
import traceEmpty from '../../mocks/trace-empty.draft.json'
import traceError from '../../mocks/trace-error.draft.json'
import traceOk from '../../mocks/trace-ok.draft.json'
import traceTruncated from '../../mocks/trace-truncated.draft.json'
import type { SearchConditions } from '../searchConditions'
import type { ApiError, TraceResult } from '../types'

export type TraceResponse =
  | { ok: true; result: TraceResult }
  | { ok: false; error: ApiError['error'] }

// 서버에 보낼 요청 값. 실제 API가 나오면 이 모양 그대로 쿼리로 보낸다.
export type TraceRequest = { address: string } & SearchConditions

// 입력한 주소와 고른 조건을 요청 값 하나로 묶는다.
export function buildTraceRequest(
  address: string,
  conditions: SearchConditions,
): TraceRequest {
  return {
    address: address.trim(),
    direction: conditions.direction,
    maxDepth: conditions.maxDepth,
  }
}

// 0x로 시작하고 16진수 40자리
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

// 주소별로 돌려줄 mock 파일. 여기에 없는 올바른 주소는 빈 결과로 흉내 낸다.
const MOCK_BY_ADDRESS: Record<string, TraceResult> = {
  '0x000000000000000000000000000000000000a001': traceOk,
  '0x000000000000000000000000000000000000b001': traceEmpty,
  '0x000000000000000000000000000000000000a002': traceTruncated,
}

// mock이라 direction·maxDepth는 아직 결과에 반영하지 않는다. 주소만 보고 파일을 고른다.
export async function searchTrace(request: TraceRequest): Promise<TraceResponse> {
  const trimmed = request.address.trim()

  if (!ADDRESS_PATTERN.test(trimmed)) {
    const errorResponse: ApiError = traceError
    return { ok: false, error: errorResponse.error }
  }

  const result = MOCK_BY_ADDRESS[trimmed.toLowerCase()] ?? traceEmpty
  return { ok: true, result }
}
