import { canSearch } from '../state/datasetSession'
import type { DatasetSession } from '../state/datasetSession'
import type { PracticeProblem } from './practiceProblems'

type PracticeSession = Pick<DatasetSession, 'getSnapshot' | 'selectDataset' | 'setMode' | 'setConditions' | 'search'>

// 실습 문제의 데이터셋을 고르고, 출발 주소에서 보낸 쪽으로 문제의 탐색 깊이만큼 추적한다.
// 경로 탐색(Path)은 정답이 바로 보이므로 쓰지 않는다(실습 데이터셋은 서버도 403으로 막는다).
// 데이터셋이 READY가 아니면 검색하지 않고 false를 돌려준다.
export async function startPractice(session: PracticeSession, problem: PracticeProblem, setAddress: (address: string) => void): Promise<boolean> {
  const ref = { datasetId: problem.datasetId, datasetVersion: problem.datasetVersion }
  const current = session.getSnapshot()
  if (current.selection?.datasetId !== ref.datasetId || current.selection.datasetVersion !== ref.datasetVersion || current.detailStatus !== 'ready') {
    await session.selectDataset(ref)
  }
  if (!canSearch(session.getSnapshot())) return false
  session.setMode('trace')
  session.setConditions({ direction: 'outgoing', maxDepth: problem.maxDepth })
  setAddress(problem.startAddress)
  await session.search(problem.startAddress)
  return true
}
