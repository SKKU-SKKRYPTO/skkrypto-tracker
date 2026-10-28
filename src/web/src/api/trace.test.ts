import { describe, expect, it } from 'vitest'
import traceOk from '../../mocks/trace-ok.draft.json'
import { DEFAULT_SEARCH_CONDITIONS } from '../searchConditions'
import { buildTraceRequest, searchTrace } from './trace'

// 기본 조건으로 요청 값을 만들어 검색한다.
function search(address: string) {
  return searchTrace(buildTraceRequest(address, DEFAULT_SEARCH_CONDITIONS))
}

describe('buildTraceRequest', () => {
  it('기본 조건이면 outgoing, maxDepth 2가 담긴다', () => {
    const request = buildTraceRequest(
      '0x000000000000000000000000000000000000a001',
      DEFAULT_SEARCH_CONDITIONS,
    )
    expect(request).toEqual({
      address: '0x000000000000000000000000000000000000a001',
      direction: 'outgoing',
      maxDepth: 2,
    })
  })

  it('고른 방향과 깊이가 그대로 담긴다', () => {
    const request = buildTraceRequest('0xabc', { direction: 'incoming', maxDepth: 3 })
    expect(request.direction).toBe('incoming')
    expect(request.maxDepth).toBe(3)
  })

  it('주소 앞뒤 공백은 지운다', () => {
    const request = buildTraceRequest('  0xabc \n', DEFAULT_SEARCH_CONDITIONS)
    expect(request.address).toBe('0xabc')
  })

  it('넘겨받은 조건 객체는 바꾸지 않는다', () => {
    const conditions = { direction: 'incoming', maxDepth: 1 } as const
    const request = buildTraceRequest('0xabc', conditions)
    expect(request).not.toBe(conditions)
    expect(conditions).toEqual({ direction: 'incoming', maxDepth: 1 })
  })
})

// 주소 형식 검사(ADDRESS_PATTERN)는 내보내지 않으므로 searchTrace의 결과로 확인한다.
// 형식이 틀리면 ok: false(오류 응답), 맞으면 ok: true가 나온다.
describe('searchTrace 주소 형식 검사', () => {
  it('0x + 16진수 40자리 주소는 통과한다', async () => {
    const response = await search('0x000000000000000000000000000000000000a001')
    expect(response.ok).toBe(true)
  })

  it('0x가 없으면 거절한다', async () => {
    const response = await search('000000000000000000000000000000000000a001')
    expect(response.ok).toBe(false)
  })

  it('길이가 짧거나 길면 거절한다', async () => {
    expect((await search('0x000000000000000000000000000000000000a00')).ok).toBe(false)
    expect((await search('0x000000000000000000000000000000000000a0011')).ok).toBe(false)
  })

  it('16진수가 아닌 글자가 있으면 거절한다', async () => {
    const response = await search('0x000000000000000000000000000000000000g001')
    expect(response.ok).toBe(false)
  })

  it('대문자가 섞여도 통과하고, 소문자 주소와 같은 결과를 돌려준다', async () => {
    const response = await search('0x000000000000000000000000000000000000A001')
    expect(response).toEqual({ ok: true, result: traceOk })
  })
})
