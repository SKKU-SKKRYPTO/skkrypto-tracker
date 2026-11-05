import { createHttpClient } from '../api/httpClient'
import type { HttpClient, HttpResult } from '../api/httpClient'
import { SearchRequestError } from '../api/searchFailure'

// 실습 채점 POST /api/practice/grade. 서버는 통과 여부(passed)만 준다. 점수·맞힌 개수·어떤 경로가 맞았는지는 알려 주지 않는다.
// 낸 답안: 경로마다 송금 ID를 출발부터 도착까지 순서대로. 경로끼리의 순서는 상관없다.
export type PracticeSubmission = { challenge: string; datasetId: string; datasetVersion: string; paths: string[][] }
export type PracticeGradeResult = { challenge: string; datasetMatches: boolean; passed: boolean }
export type PracticeGradeOutcome =
  | { status: 'graded'; result: PracticeGradeResult }
  | { status: 'disabled'; message: string }
  | { status: 'failed'; message: string }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function decodeResult(value: unknown, challenge: string): PracticeGradeResult | null {
  if (!record(value) || value.challenge !== challenge || typeof value.datasetMatches !== 'boolean' || typeof value.passed !== 'boolean') return null
  return { challenge, datasetMatches: value.datasetMatches, passed: value.passed }
}

const errorMessage = (body: unknown) => record(body) && record(body.error) && typeof body.error.message === 'string' ? body.error.message : ''
const errorCode = (body: unknown) => record(body) && record(body.error) && typeof body.error.code === 'string' ? body.error.code : ''

export function createPracticeGradeApi(http: HttpClient = createHttpClient()) {
  return {
    async grade(submission: PracticeSubmission, signal?: AbortSignal): Promise<PracticeGradeOutcome> {
      let reply: HttpResult
      try {
        reply = await http('/api/practice/grade', { method: 'POST', body: submission, signal })
      } catch (cause) {
        if (signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')) throw cause
        return { status: 'failed', message: cause instanceof SearchRequestError ? '채점 서버에 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.' : '채점하지 못했습니다.' }
      }
      if (!reply.ok) return { status: 'failed', message: reply.error.message }
      // 404는 서버에 정답 파일이 없거나 채점 기능이 없는 경우다(실습 당일 전). 없는 데이터셋(DATASET_NOT_FOUND)과 수집 중·무효화(409)는 서버 문구를 그대로 보여 준다.
      if (reply.status === 404 && errorCode(reply.body) !== 'DATASET_NOT_FOUND') return { status: 'disabled', message: '지금은 채점이 꺼져 있습니다. 실습이 시작되면 다시 눌러 주세요.' }
      if (reply.status === 429) return { status: 'failed', message: '요청이 많습니다. 잠시 뒤 다시 채점해 주세요.' }
      if (reply.status !== 200) return { status: 'failed', message: errorMessage(reply.body) || '채점하지 못했습니다.' }
      const result = decodeResult(record(reply.body) ? reply.body.data : null, submission.challenge)
      return result ? { status: 'graded', result } : { status: 'failed', message: '채점 응답 형식이 올바르지 않습니다.' }
    },
  }
}
export type PracticeGradeApi = ReturnType<typeof createPracticeGradeApi>

export const practicePerfect = (result: PracticeGradeResult) => result.datasetMatches && result.passed
// 화면에는 통과하면 PASS, 아니면 FAIL만 보인다.
export const practiceVerdict = (result: PracticeGradeResult) => practicePerfect(result) ? 'PASS' : 'FAIL'
