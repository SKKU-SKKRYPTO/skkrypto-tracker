import type { HttpClient } from '../api/httpClient'
import type { Transfer } from '../api/v1Types'
import { createPracticeGradeApi } from './practiceGrade'
import type { PracticeGradeOutcome } from './practiceGrade'
import type { PracticeProblem } from './practiceProblems'

// 학생은 경로를 지갑 이름 순서로 적는다(예: B → A → C → H, 경로마다 한 줄).
// 화면이 데이터셋의 지갑 이름표와 송금 목록으로 이름 쌍마다 송금 하나를 찾아 송금 ID 경로로 바꾸고, 서버가 정답과 비교한다.
// 이름 쌍 사이 송금이 없거나 여러 건이면 채점하지 않고 그 줄을 알려 준다(시간 순서가 맞는지는 서버 채점이 판단한다).

export type AnswerConversion = { ok: true; paths: string[][] } | { ok: false; message: string }

// 한 줄이 경로 하나다. 화살표·쉼표·공백 등 글자·숫자가 아닌 것은 모두 구분자로 본다. 이름은 대소문자를 가리지 않는다.
export function parseAnswerText(text: string): string[][] {
  return text.split(/\r?\n/)
    .map(line => line.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(name => name.toUpperCase()))
    .filter(path => path.length > 0)
}

export function answerToTransferIds(paths: string[][], transfers: readonly Transfer[], labels: Record<string, string>, maxDepth: number): AnswerConversion {
  const addressOf = new Map(Object.entries(labels).map(([address, name]) => [name.toUpperCase(), address.toLowerCase()]))
  const result: string[][] = []
  for (const [index, path] of paths.entries()) {
    const line = `${index + 1}번째 줄`
    if (path.length < 2) return { ok: false, message: `${line}: 지갑 이름을 두 개 이상 적어 주세요(예: B → A).` }
    if (path.length - 1 > maxDepth) return { ok: false, message: `${line}: 경로는 최대 ${maxDepth}단계(지갑 ${maxDepth + 1}개)까지입니다.` }
    const unknown = path.find(name => !addressOf.has(name))
    if (unknown) return { ok: false, message: `${line}: ${unknown}은(는) 이 데이터셋에 없는 지갑 이름입니다.` }
    const ids: string[] = []
    for (let step = 1; step < path.length; step++) {
      const from = addressOf.get(path[step - 1])!, to = addressOf.get(path[step])!
      const matches = transfers.filter(row => row.from.toLowerCase() === from && row.to.toLowerCase() === to)
      if (matches.length === 0) return { ok: false, message: `${line}: ${path[step - 1]} → ${path[step]} 송금이 없습니다.` }
      if (matches.length > 1) return { ok: false, message: `${line}: ${path[step - 1]} → ${path[step]} 송금이 여러 건이라 지갑 이름만으로 정할 수 없습니다.` }
      ids.push(matches[0].id)
    }
    result.push(ids)
  }
  return { ok: true, paths: result }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isTransfer = (value: unknown): value is Transfer => record(value) && typeof value.id === 'string' && typeof value.from === 'string' && typeof value.to === 'string'

// 답안을 채점한다: 데이터셋의 송금 목록을 받아 이름 경로를 송금 ID 경로로 바꾸고 POST /api/practice/grade로 보낸다.
export async function gradePracticeAnswer(problem: PracticeProblem, text: string, labels: Record<string, string>, http: HttpClient): Promise<PracticeGradeOutcome> {
  const paths = parseAnswerText(text)
  if (paths.length === 0) return { status: 'failed', message: '경로를 한 줄에 하나씩 적어 주세요(예: B → A → C → H).' }
  const query = new URLSearchParams({ datasetId: problem.datasetId, datasetVersion: problem.datasetVersion, limit: '1000' })
  const reply = await http('/api/transfers?' + query.toString())
  const rows = reply.ok && reply.status === 200 && record(reply.body) && Array.isArray(reply.body.data) ? reply.body.data : null
  if (!rows || !rows.every(isTransfer)) return { status: 'failed', message: '송금 목록을 불러오지 못했습니다. 잠시 뒤 다시 채점해 주세요.' }
  const converted = answerToTransferIds(paths, rows, labels, problem.maxDepth)
  if (!converted.ok) return { status: 'failed', message: converted.message }
  return createPracticeGradeApi(http).grade({ challenge: problem.id, datasetId: problem.datasetId, datasetVersion: problem.datasetVersion, paths: converted.paths })
}
