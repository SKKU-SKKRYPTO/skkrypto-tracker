// A future transport should wrap fetch failures as network, and body-read failures as response-read.
// JSON syntax/contract errors remain the Adapter's invalid-response result.
export type SearchFailureStage = 'network' | 'response-read' | 'unknown'
export type SearchFailure = {
  ok: false
  kind: 'request-failed'
  stage: SearchFailureStage
  error: { message: string }
}

export class SearchRequestError extends Error {
  readonly stage: Exclude<SearchFailureStage, 'unknown'>
  constructor(stage: Exclude<SearchFailureStage, 'unknown'>) {
    super(stage)
    this.name = 'SearchRequestError'
    this.stage = stage
  }
}

export function searchFailure(cause: unknown): SearchFailure {
  const stage = cause instanceof SearchRequestError ? cause.stage : 'unknown'
  const messages: Record<SearchFailureStage, string> = {
    network: '네트워크 연결에 실패했습니다. 연결 상태를 확인한 뒤 다시 검색해 주세요.',
    'response-read': '서버 응답을 끝까지 읽지 못했습니다. 다시 검색해 주세요.',
    unknown: '검색 요청을 완료하지 못했습니다. 다시 검색해 주세요.',
  }
  return { ok: false, kind: 'request-failed', stage, error: { message: messages[stage] } }
}
