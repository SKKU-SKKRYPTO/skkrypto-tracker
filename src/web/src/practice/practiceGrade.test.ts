import { describe, expect, it, vi } from 'vitest'
import { createHttpClient } from '../api/httpClient'
import { createPracticeGradeApi, practicePerfect, practiceVerdict } from './practiceGrade'

const submission = { challenge: 'T1', datasetId: 'flow-demo', datasetVersion: 'v1', paths: [['e1', 'e4']] }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const api = (fetchImpl: typeof fetch) => createPracticeGradeApi(createHttpClient({ baseUrl: 'https://api.test', fetch: fetchImpl }))
const graded = { challenge: 'T1', datasetMatches: true, passed: false }

describe('practice grading client', () => {
  it('posts the answer to the configured API and reads the verdict', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { data: graded, meta: {}, error: null }))
    expect(await api(fetchImpl).grade(submission)).toEqual({ status: 'graded', result: graded })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.test/api/practice/grade')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(submission)
  })
  it('says grading is off when the server has no answers (404)', async () => {
    const off = vi.fn<typeof fetch>().mockResolvedValue(reply(404, { data: null, meta: {}, error: { code: 'NOT_FOUND', message: '실습 채점이 꺼져 있습니다.', retryable: false } }))
    expect((await api(off).grade(submission)).status).toBe('disabled')
  })
  it('reports input errors, rate limits, offline and malformed replies without throwing', async () => {
    const bad = vi.fn<typeof fetch>().mockResolvedValue(reply(400, { data: null, meta: {}, error: { code: 'INVALID_INPUT', message: '모르는 실습 문제입니다: T1', retryable: false } }))
    expect(await api(bad).grade(submission)).toEqual({ status: 'failed', message: '모르는 실습 문제입니다: T1' })
    const busy = vi.fn<typeof fetch>().mockResolvedValue(reply(429, { data: null, meta: {}, error: { code: 'RATE_LIMITED', message: 'x', retryable: true } }))
    expect((await api(busy).grade(submission)).status).toBe('failed')
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    expect((await api(offline).grade(submission)).status).toBe('failed')
    const other = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { data: { ...graded, challenge: 'T9' }, meta: {}, error: null }))
    expect(await api(other).grade(submission)).toEqual({ status: 'failed', message: '채점 응답 형식이 올바르지 않습니다.' })
    const broken = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { data: { ...graded, passed: 'yes' }, meta: {}, error: null }))
    expect((await api(broken).grade(submission)).status).toBe('failed')
    // 예전 점수 응답(passed 없음)은 받지 않는다.
    const old = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { data: { challenge: 'T1', datasetMatches: true, score: 10, total: 10, answerCount: 1, hit: 1, wrong: 0 }, meta: {}, error: null }))
    expect((await api(old).grade(submission)).status).toBe('failed')
  })
  it('stops when the request is cancelled', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(api(vi.fn<typeof fetch>()).grade(submission, abort.signal)).rejects.toThrow()
  })
  it('shows only PASS or FAIL', () => {
    expect(practiceVerdict(graded)).toBe('FAIL')
    expect(practiceVerdict({ ...graded, passed: true })).toBe('PASS')
    expect(practiceVerdict({ ...graded, passed: true, datasetMatches: false })).toBe('FAIL')
    expect(practicePerfect(graded)).toBe(false)
    expect(practicePerfect({ ...graded, passed: true })).toBe(true)
  })
})
