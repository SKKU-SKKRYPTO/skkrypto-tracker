import type { Truncation } from './api/v1Types'

// Meanings follow contracts/openapi.json (Limits/LimitStatus), analyzer/run.go,
// candidates.go and trace.go. PATH_LIMIT limits displayed paths, not exploration.
const messages: Record<Truncation['reason'], string> = {
  PATH_LIMIT: '표시할 수 있는 경로 수 제한을 초과했습니다.',
  STATE_LIMIT: '탐색할 수 있는 상태 수 제한에 도달했습니다.',
  CANDIDATE_LIMIT: '분석 후보 송금 수 제한으로 일부 후보만 분석했습니다.',
  NODE_LIMIT: '결과에 포함할 수 있는 주소 수 제한에 도달했습니다.',
  EDGE_LIMIT: '결과에 포함할 수 있는 송금 수 제한에 도달했습니다.',
  TIME_BUDGET: '분석에 허용된 시간을 모두 사용했습니다.',
}

// Presentation fallback only; API schema validation still rejects unsupported codes.
export function formatLimitReason(reason: unknown): string {
  return typeof reason === 'string' && Object.hasOwn(messages, reason)
    ? messages[reason as Truncation['reason']]
    : '분석 제한으로 결과의 일부만 표시합니다.'
}
