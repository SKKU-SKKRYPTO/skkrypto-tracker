import { describe, expect, it } from 'vitest'
import traceOk from '../../mocks/trace-ok.draft.json'
import { searchTrace } from './trace'

// 주소 형식 검사(ADDRESS_PATTERN)는 내보내지 않으므로 searchTrace의 결과로 확인한다.
// 형식이 틀리면 ok: false(오류 응답), 맞으면 ok: true가 나온다.
describe('searchTrace 주소 형식 검사', () => {
  it('0x + 16진수 40자리 주소는 통과한다', async () => {
    const response = await searchTrace('0x000000000000000000000000000000000000a001')
    expect(response.ok).toBe(true)
  })

  it('0x가 없으면 거절한다', async () => {
    const response = await searchTrace('000000000000000000000000000000000000a001')
    expect(response.ok).toBe(false)
  })

  it('길이가 짧거나 길면 거절한다', async () => {
    expect((await searchTrace('0x000000000000000000000000000000000000a00')).ok).toBe(false)
    expect((await searchTrace('0x000000000000000000000000000000000000a0011')).ok).toBe(false)
  })

  it('16진수가 아닌 글자가 있으면 거절한다', async () => {
    const response = await searchTrace('0x000000000000000000000000000000000000g001')
    expect(response.ok).toBe(false)
  })

  it('대문자가 섞여도 통과하고, 소문자 주소와 같은 결과를 돌려준다', async () => {
    const response = await searchTrace('0x000000000000000000000000000000000000A001')
    expect(response).toEqual({ ok: true, result: traceOk })
  })
})
