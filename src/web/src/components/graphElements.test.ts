import { describe, expect, it } from 'vitest'
import traceOk from '../../mocks/trace-ok.draft.json'
import type { TraceResult } from '../types'
import { buildElements } from './graphElements'

const result: TraceResult = traceOk
const token = result.dataset.token

describe('buildElements', () => {
  const elements = buildElements(result, token)
  const nodes = elements.filter((element) => element.group === 'nodes')
  const edges = elements.filter((element) => element.group === 'edges')

  it('주소마다 점 하나, 송금마다 화살표 하나를 만든다', () => {
    expect(nodes).toHaveLength(5)
    expect(edges).toHaveLength(4)
  })

  it('화살표 id는 transfers[].id와 같다', () => {
    expect(edges.map((edge) => edge.data.id)).toEqual(
      result.transfers.map((transfer) => transfer.id),
    )
  })

  it('검색한 시작 주소 하나에만 "시작" 표시를 붙인다', () => {
    const startNodes = nodes.filter((node) => node.classes === 'start')
    expect(startNodes).toHaveLength(1)
    expect(startNodes[0].data.id).toBe(result.query.address)
    expect(startNodes[0].data.label).toBe('시작\n0x0000…a001')
  })

  it('화살표 글자는 소수점을 옮긴 금액과 토큰 이름이다', () => {
    expect(edges[0].data.label).toBe('5 TST')
    expect(edges[1].data.label).toBe('1.5 TST')
  })
})
