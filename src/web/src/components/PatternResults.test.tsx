import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PatternResults from './PatternResults'
import type { PatternEnvelope } from '../api/patterns'
import sample from '../../mocks/v1/samples/patterns-success.json'
const fresh = () => structuredClone(sample) as PatternEnvelope
const render = (envelope: PatternEnvelope) => renderToStaticMarkup(<PatternResults envelope={envelope} />)
describe('Pattern results', () => {
  it('keeps official overlapping windows, shared group and repeated counterparties', () => {
    const envelope = fresh(), before = structuredClone(envelope), html = render(envelope)
    expect(html.match(/<h2>/g)).toHaveLength(2)
    for (const p of envelope.data.patterns) {
      for (const text of [p.patternId, p.groupId, p.address, p.windowStart, p.windowEnd, ...p.counterparties]) expect(html).toContain(text)
    }
    for (const text of ['발견된 패턴 창 2개', '고유 상대 주소 3개', '근거 송금 3건', '근거 송금 4건', '분석 창: 600초', '시작 포함, 종료 제외', '관측 범위 내 분석 창', '합류(FAN_IN)', '불법 거래, 동일 소유자 또는 동일 자금의 이동을 증명하지 않습니다']) expect(html).toContain(text)
    expect(html).not.toContain('송금 상세 보기'); expect(html).toContain('graph-canvas'); expect(envelope).toEqual(before)
  })
  it('renders derived FAN_OUT response with the applied direction', () => {
    const e = fresh(); for (const p of e.data.patterns) { p.ruleId = 'FAN_OUT'; p.direction = 'outgoing' }
    ;(e.meta.conditions as { direction?: string }).direction = 'outgoing'
    expect(render(e)).toContain('분산(FAN_OUT)')
  })
  it.each([false, true])('distinguishes incomplete from truncated (%s)', truncated => {
    const e = fresh(); e.data.patterns[0].incomplete = true
    if (truncated) { e.data.limits.truncated = { reason: 'CANDIDATE_LIMIT', reasons: ['CANDIDATE_LIMIT'] }; e.data.limits.foundIsLowerBound = true; e.data.limits.analyzedUntil = { blockNumber: '20005', timestamp: sample.data.transfers[4].timestamp } }
    const html = render(e)
    expect(html).toContain('관측 범위 불완전'); expect(html).toContain('관측 범위가 불완전')
    if (truncated) { expect(html).toContain('최소 발견 건수'); expect(html).toContain('분석 후보 송금 수 제한'); expect(html).toContain('블록 20005까지만 분석') }
    else { expect(html).not.toContain('전체 결과가 아닐 수'); expect(html).not.toContain('최소 발견 건수') }
  })
  it.each([false, true])('renders complete/partial empty result (%s)', truncated => {
    const e = fresh(); e.data.patterns = []; e.data.limits.found = 0
    if (truncated) e.data.limits.truncated = { reason: 'TIME_BUDGET', reasons: ['TIME_BUDGET'] }
    expect(render(e)).toContain(truncated ? '전체 범위에 패턴이 없다고 단정할 수 없습니다' : '선택한 조건과 수집 범위에서 패턴이 관측되지 않았습니다')
  })
})
