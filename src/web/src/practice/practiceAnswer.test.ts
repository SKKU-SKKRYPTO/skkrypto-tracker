import { describe, expect, it } from 'vitest'
import type { HttpClient, HttpRequestOptions } from '../api/httpClient'
import type { Transfer } from '../api/v1Types'
import { answerToTransferIds, gradePracticeAnswer, parseAnswerText } from './practiceAnswer'
import { decodePracticeProblems } from './practiceProblems'
import { A, S, T, testProblemsFile } from './practiceTestProblems'

const X = '0x0000000000000000000000000000000000000009'
const labels = { [S]: 'S', [A]: 'A', [T]: 'T', [X]: 'X' }
const row = (id: string, from: string, to: string) => ({ id, from, to }) as Transfer
const transfers = [row('t1', S, A), row('t2', A, T), row('t3', S, X), row('t4', X, T), row('t5', X, T)]
const [problem] = decodePracticeProblems(testProblemsFile)

describe('practice answers written with wallet names', () => {
  it('reads one path per line with any separator and ignores case and blank lines', () => {
    expect(parseAnswerText('S → A → T\n\n  s,a -> t \r\nS>T')).toEqual([['S', 'A', 'T'], ['S', 'A', 'T'], ['S', 'T']])
    expect(parseAnswerText('   \n')).toEqual([])
  })
  it('turns each name pair into the single transfer between those wallets', () => {
    expect(answerToTransferIds([['S', 'A', 'T']], transfers, labels, 3)).toEqual({ ok: true, paths: [['t1', 't2']] })
  })
  it('says which line cannot be graded instead of guessing', () => {
    const fail = (path: string[], depth = 3) => {
      const result = answerToTransferIds([['S', 'A', 'T'], path], transfers, labels, depth)
      return result.ok ? '' : result.message
    }
    expect(fail(['S'])).toContain('2번째 줄: 지갑 이름을 두 개 이상')
    expect(fail(['S', 'Q'])).toContain('Q은(는) 이 데이터셋에 없는 지갑 이름')
    expect(fail(['A', 'S'])).toContain('A → S 송금이 없습니다')
    expect(fail(['S', 'X', 'T'])).toContain('X → T 송금이 여러 건')
    expect(fail(['S', 'A', 'T', 'X'], 2)).toContain('최대 2단계')
  })
  it('accepts full addresses when only some wallets have labels (start and target only)', () => {
    const partial = { [S]: 'S', [T]: 'T' }
    const named = answerToTransferIds(parseAnswerText('S → A → T'), transfers, partial, 3)
    expect(named.ok ? '' : named.message).toContain('전체 주소(0x…)')
    expect(answerToTransferIds(parseAnswerText(`S → ${A.toUpperCase().replace('0X', '0x')} → T`), transfers, partial, 3)).toEqual({ ok: true, paths: [['t1', 't2']] })
    expect(answerToTransferIds(parseAnswerText(`${S} -> ${A} -> ${T}`), transfers, {}, 3)).toEqual({ ok: true, paths: [['t1', 't2']] })
    const missing = answerToTransferIds(parseAnswerText(`${A} → ${S}`), transfers, {}, 3)
    expect(missing.ok ? '' : missing.message).toBe('1번째 줄: 0x0000…0002 → 0x0000…0001 송금이 없습니다.')
  })
  it('refuses a name that labels more than one wallet instead of picking one', () => {
    const result = answerToTransferIds(parseAnswerText('S → A → T'), transfers, { ...labels, [X]: 'A' }, 3)
    expect(result.ok ? '' : result.message).toContain('A은(는) 여러 지갑에 붙은 이름')
  })
})

describe('grading an answer', () => {
  function fakeHttp(transferReply: { status: number; body: unknown }) {
    const calls: { path: string; options?: HttpRequestOptions }[] = []
    const http: HttpClient = async (path, options) => {
      calls.push({ path, options })
      if (path.startsWith('/api/transfers')) return { ok: true, status: transferReply.status, body: transferReply.body, retryAfter: null }
      return { ok: true, status: 200, body: { data: { challenge: problem.id, datasetMatches: true, passed: true }, meta: {}, error: null }, retryAfter: null }
    }
    return { http, calls }
  }
  it('loads the dataset transfers, sends transfer ID paths and returns the verdict', async () => {
    const { http, calls } = fakeHttp({ status: 200, body: { data: transfers } })
    const outcome = await gradePracticeAnswer(problem, 'S → A → T', labels, http)
    expect(outcome).toEqual({ status: 'graded', result: { challenge: problem.id, datasetMatches: true, passed: true } })
    expect(calls[0].path).toBe('/api/transfers?datasetId=flow-demo&datasetVersion=v1&limit=1000')
    expect(calls[1].path).toBe('/api/practice/grade')
    expect(calls[1].options?.body).toEqual({ challenge: problem.id, datasetId: 'flow-demo', datasetVersion: 'v1', paths: [['t1', 't2']] })
  })
  it('does not call the server for an empty or unconvertible answer', async () => {
    const empty = fakeHttp({ status: 200, body: { data: transfers } })
    expect(await gradePracticeAnswer(problem, '  ', labels, empty.http)).toMatchObject({ status: 'failed' })
    expect(empty.calls).toHaveLength(0)
    const wrong = fakeHttp({ status: 200, body: { data: transfers } })
    expect(await gradePracticeAnswer(problem, 'A → S', labels, wrong.http)).toEqual({ status: 'failed', message: '1번째 줄: A → S 송금이 없습니다.' })
    expect(wrong.calls.map(call => call.path)).not.toContain('/api/practice/grade')
  })
  it('follows the next cursor until every transfer is loaded', async () => {
    const calls: string[] = []
    const http: HttpClient = async path => {
      calls.push(path)
      if (path.startsWith('/api/transfers') && !path.includes('cursor=')) return { ok: true, status: 200, body: { data: transfers.slice(0, 1), meta: { page: { limit: 1000, nextCursor: 'c2' } } }, retryAfter: null }
      if (path.startsWith('/api/transfers')) return { ok: true, status: 200, body: { data: transfers.slice(1), meta: { page: { limit: 1000, nextCursor: null } } }, retryAfter: null }
      return { ok: true, status: 200, body: { data: { challenge: problem.id, datasetMatches: true, passed: true }, meta: {}, error: null }, retryAfter: null }
    }
    expect(await gradePracticeAnswer(problem, 'S → A → T', labels, http)).toMatchObject({ status: 'graded' })
    expect(calls[1]).toBe('/api/transfers?datasetId=flow-demo&datasetVersion=v1&limit=1000&cursor=c2')
    expect(calls[2]).toBe('/api/practice/grade')
  })
  it('reports when the transfer list cannot be loaded', async () => {
    const { http } = fakeHttp({ status: 503, body: { data: null } })
    expect(await gradePracticeAnswer(problem, 'S → A → T', labels, http)).toMatchObject({ status: 'failed', message: expect.stringContaining('송금 목록') })
  })
})
