// 실습 문제는 코드에 넣지 않고 실행할 때 파일로 받는다. 저장소는 공개라서 문제 파일은 실습 당일에만 배포본에 둔다.
// 이 파일에는 정답·해설이 없고, 화면이 문제를 그리고 출발점을 준비하는 데 필요한 값만 있다.
export type PracticeDatasetRef = { datasetId: string; datasetVersion: string }
export type PracticeHint = { title: string; text: string }
export type PracticeProblem = {
  id: string
  title: string
  level: string
  prompt: string[]
  datasetId: string
  datasetVersion: string
  startAddress: string
  targetAddress: string
  viaAddress?: string
  maxDepth: 1 | 2 | 3
  hints: PracticeHint[]
  notes: string[]
}
export type PracticeProblemsState =
  | { status: 'ready'; problems: PracticeProblem[] }
  | { status: 'unavailable' }
  | { status: 'invalid'; message: string }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const address = (value: unknown): value is string => typeof value === 'string' && ADDRESS.test(value)

export const practiceDatasetKey = (ref: PracticeDatasetRef) => JSON.stringify([ref.datasetId, ref.datasetVersion])

export function practiceProblemsUrl(env: { VITE_PRACTICE_PROBLEMS_URL?: string; BASE_URL?: string } = import.meta.env): string {
  const configured = env.VITE_PRACTICE_PROBLEMS_URL?.trim()
  if (configured) return configured
  const base = env.BASE_URL || '/'
  return (base.endsWith('/') ? base : base + '/') + 'practice/problems.json'
}

function invalid(message: string): never {
  throw new Error('실습 문제 파일 형식이 올바르지 않습니다: ' + message)
}

export function decodePracticeProblems(raw: unknown): PracticeProblem[] {
  if (!record(raw) || (raw.version !== 2 && raw.version !== 3) || !Array.isArray(raw.problems) || raw.problems.length === 0) invalid('version 2 또는 3과 problems 목록이 필요합니다')
  const seen = new Set<string>()
  return raw.problems.map((value, index) => {
    if (!record(value) || !text(value.id) || seen.has(value.id)) invalid(`${index + 1}번째 문제 ID`)
    const id = value.id
    seen.add(id)
    if (!text(value.title)) invalid(id + ' 제목')
    if (!texts(value.prompt) || value.prompt.length === 0) invalid(id + ' 문제문')
    if (!text(value.datasetId) || !text(value.datasetVersion)) invalid(id + ' 데이터셋')
    if (!address(value.startAddress) || !address(value.targetAddress)) invalid(id + ' 출발·도착 주소')
    if (value.startAddress.toLowerCase() === value.targetAddress.toLowerCase()) invalid(id + ' 출발과 도착이 같습니다')
    if (value.viaAddress !== undefined && !address(value.viaAddress)) invalid(id + ' 경유 주소')
    const maxDepth = value.maxDepth
    if (maxDepth !== 1 && maxDepth !== 2 && maxDepth !== 3) invalid(id + ' 탐색 깊이')
    const hints = value.hints ?? [], notes = value.notes ?? []
    if (!Array.isArray(hints) || hints.some(row => !record(row) || !text(row.title) || !text(row.text))) invalid(id + ' 힌트')
    if (!texts(notes)) invalid(id + ' 안내')
    return {
      id, title: value.title, level: text(value.level) ? value.level : '', prompt: [...value.prompt],
      datasetId: value.datasetId, datasetVersion: value.datasetVersion,
      startAddress: value.startAddress, targetAddress: value.targetAddress,
      ...(value.viaAddress !== undefined ? { viaAddress: value.viaAddress } : {}),
      maxDepth, hints: (hints as PracticeHint[]).map(row => ({ title: row.title, text: row.text })), notes: [...notes],
    }
  })
}

// 파일이 없으면(404·네트워크 오류) 실습 당일 전으로 보고, 형식이 틀리면 운영진이 알 수 있게 알린다.
export async function loadPracticeProblems(url = practiceProblemsUrl(), fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<PracticeProblemsState> {
  let response: Response
  try {
    response = await fetchImpl(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  } catch (cause) {
    if (signal?.aborted) throw cause
    return { status: 'unavailable' }
  }
  if (!response.ok) return { status: 'unavailable' }
  let body: unknown
  try { body = await response.json() } catch { return { status: 'unavailable' } }
  try {
    return { status: 'ready', problems: decodePracticeProblems(body) }
  } catch (cause) {
    return { status: 'invalid', message: cause instanceof Error ? cause.message : '실습 문제 파일을 읽지 못했습니다.' }
  }
}
