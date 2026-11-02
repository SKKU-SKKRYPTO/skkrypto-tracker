import type { PatternRequest } from './api/patterns'
import { matchesV1 } from './api/validateV1'

export type PatternDirection = 'all' | NonNullable<PatternRequest['direction']>
export type PatternConditions = { address: string; direction: PatternDirection }
export const DEFAULT_PATTERN_CONDITIONS: PatternConditions = { address: '', direction: 'all' }
export const PATTERN_DIRECTION_LABELS = { all: '전체', outgoing: '분산(FAN_OUT)', incoming: '합류(FAN_IN)' } as const
export function validatePatternConditions(conditions: PatternConditions): string | null {
  if (!matchesV1(conditions.address.trim(), 'Address')) return '기준 주소는 0x로 시작하는 40자리 16진수 주소여야 합니다.'
  if (!Object.hasOwn(PATTERN_DIRECTION_LABELS, conditions.direction)) return '분석 방향은 전체, 분산 또는 합류여야 합니다.'
  return null
}
