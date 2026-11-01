import { describe, expect, it } from 'vitest'
import spec from '../mocks/v1/openapi.json'
import { formatLimitReason } from './limitReasons'

const cases = [
  ['PATH_LIMIT', '표시할 수 있는 경로 수 제한을 초과했습니다.'],
  ['STATE_LIMIT', '탐색할 수 있는 상태 수 제한에 도달했습니다.'],
  ['CANDIDATE_LIMIT', '분석 후보 송금 수 제한으로 일부 후보만 분석했습니다.'],
  ['NODE_LIMIT', '결과에 포함할 수 있는 주소 수 제한에 도달했습니다.'],
  ['EDGE_LIMIT', '결과에 포함할 수 있는 송금 수 제한에 도달했습니다.'],
  ['TIME_BUDGET', '분석에 허용된 시간을 모두 사용했습니다.'],
] as const

describe('limit reason presentation', () => {
  it('covers every official v1 reason', () => {
    expect(cases.map(([code]) => code).sort()).toEqual([...spec.components.schemas.Truncation.properties.reason.enum].sort())
  })
  it.each(cases)('explains %s in Korean', (code, message) => {
    expect(formatLimitReason(code)).toBe(message)
    expect(formatLimitReason(code)).not.toContain(code)
  })
  it.each(['FUTURE_LIMIT', '__proto__', 'toString', '', null, undefined, 1])('safely handles unknown input %s', code => {
    expect(formatLimitReason(code)).toBe('분석 제한으로 결과의 일부만 표시합니다.')
  })
})
