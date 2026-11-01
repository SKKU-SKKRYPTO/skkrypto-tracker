import type { RequestFailure } from '../state/datasetSession'
export default function RequestNotice({ failure }: { failure: RequestFailure }) {
  const label = failure.kind === 'api' ? `API 오류 (HTTP ${failure.status} · ${failure.error.code})` :
    failure.kind === 'request-failed' ? '요청 실패' : failure.kind === 'mock-unsupported' ? 'Mock 미지원' : '응답 형식 오류'
  return <p className="notice notice-error" role="alert">
    {label}: {failure.error.message}
    {failure.kind === 'api' && failure.error.retryable && ' 잠시 뒤 다시 시도할 수 있습니다.'}
    {'retryAfter' in failure && failure.retryAfter && ` (Retry-After: ${failure.retryAfter})`}
  </p>
}
