import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PathResults from './PathResults'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PathsResult } from '../adapters/pathsAdapter'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import normal from '../../mocks/v1/samples/paths-success.json'
import limited from '../../mocks/v1/samples/paths-path-limit.json'
import timed from '../../mocks/v1/samples/paths-time-budget.json'

function result(body: unknown = normal): PathsResult {
  const adapted = adaptPathsResponse(body, detail, { datasetId: 'flow-demo', datasetVersion: 'v1' })
  if (!adapted.ok) throw Error('Invalid test fixture')
  return adapted.result
}
const render = (value: PathsResult) => renderToStaticMarkup(<PathResults result={value} />)
describe('Path result list', () => {
  it('keeps backend order, hops and complete address connections', () => {
    const value = result(), before = structuredClone(value), html = render(value)
    expect(html.indexOf(normal.data.paths[0].id)).toBeLessThan(html.indexOf(normal.data.paths[1].id))
    expect(html).toContain('경로 1 · 3단계')
    expect(html).toContain('경로 2 · 3단계')
    expect(html).toContain([normal.data.transfers[0].from, normal.data.transfers[0].to, normal.data.transfers[2].to, normal.data.transfers[4].to].join(' → '))
    for (const transfer of normal.data.transfers) expect(html).toContain(transfer.id)
    expect(html).toContain('동일 자금의 이동이나 소유 관계를 확정하지 않습니다')
    expect(html).toContain('찾은 경로 2개 중 2개 표시')
    expect(html).not.toContain('찾은 송금')
    expect(html).not.toContain('송금 상세')
    expect(value).toEqual(before)
  })
  it('retains actual money-flow order for incoming', () => {
    const value = result()
    Object.assign(value.meta.conditions, { direction: 'incoming', address: normal.meta.conditions.targetAddress, targetAddress: normal.meta.conditions.address })
    const html = render(value)
    expect(html).toContain('대상 주소에서 검색 시작 주소로 이어지는 실제 송금 순서')
    expect(html).toContain([normal.data.transfers[0].from, normal.data.transfers[0].to, normal.data.transfers[2].to, normal.data.transfers[4].to].join(' → '))
  })
  it.each([[limited, '찾은 경로 2개 중 1개 표시'], [timed, '찾은 경로 1개 이상 중 1개 표시']] as const)('shows exact/lower-bound partial path counts', (sample, message) => {
    const html = render(result(sample))
    expect(html).toContain(message)
    expect(html).toContain('전체 결과가 아닐 수 있습니다')
    expect(html).not.toContain(sample.data.limits.truncated.reason)
  })
  it('shows analyzed position and Korean candidate limits', () => {
    const value = result()
    value.data.limits.truncated = { reason: 'CANDIDATE_LIMIT', reasons: ['CANDIDATE_LIMIT'] }
    value.data.limits.analyzedUntil = { blockNumber: '18205040', timestamp: '2026-10-26T12:00:00Z' }
    const html = render(value)
    expect(html).toContain('분석 후보 송금 수 제한')
    expect(html).toContain('블록 18205040까지만 분석')
  })
  it.each([false, true])('distinguishes a complete empty result from truncated empty (%s)', truncated => {
    const value = result(); value.data.paths = []; value.data.transfers = []; value.data.limits.found = 0
    value.data.limits.truncated = truncated ? { reason: 'TIME_BUDGET', reasons: ['TIME_BUDGET'] } : null
    const html = render(value)
    expect(html).toContain(truncated ? '전체 범위에 경로가 없다고 단정할 수 없습니다' : '후보 경로가 관측되지 않았습니다')
  })
  it('does not invent evidence when independently supplied data has a missing reference', () => {
    const value = result(); value.data.paths[0].transferIds[0] = 'missing'
    expect(render(value)).toContain('경로 1의 근거 송금 정보를 확인할 수 없습니다')
  })
})
