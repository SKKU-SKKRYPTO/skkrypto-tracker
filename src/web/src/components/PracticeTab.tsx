import type { Dataset } from '../api/v1Types'
import type { PracticeProblem, PracticeProblemsState } from '../practice/practiceProblems'
import type { PracticeGradeOutcome } from '../practice/practiceGrade'
import AddressValue from './AddressValue'
import PracticeAnswer from './PracticeAnswer'

type Props = {
  problems: PracticeProblemsState | null
  datasets: Dataset[]
  busy?: boolean
  submitUrl?: string
  onStart: (problem: PracticeProblem) => void
  // 있으면 문제마다 답안 칸과 채점 버튼을 보여 준다(서버 채점 POST /api/practice/grade).
  onGrade?: (problem: PracticeProblem, text: string) => Promise<PracticeGradeOutcome>
}

// 실습 문제 탭. 문제는 실행할 때 받은 파일(practice/problems.json)에서만 읽고 정답은 없다.
// 풀이는 분석 탭의 추적·패턴으로 하고, 답은 지갑 이름 순서로 제출한다.
export default function PracticeTab({ problems, datasets, busy = false, submitUrl, onStart, onGrade }: Props) {
  if (problems === null) return <p className="notice" role="status">실습 문제를 불러오는 중…</p>
  if (problems.status === 'unavailable') return <p className="notice" role="status">실습 문제는 실습 당일 공개됩니다.</p>
  if (problems.status === 'invalid') return <p className="notice notice-error" role="alert">{problems.message}</p>
  return <div className="practice-tab">
    <div className="notice practice-guide">
      <p><strong>푸는 방법</strong></p>
      <ol>
        <li><strong>이 문제로 추적 시작</strong>을 누르면 문제의 데이터셋·출발 주소·탐색 깊이로 추적한 결과가 분석 탭에 나옵니다.</li>
        <li>그래프의 지갑 이름(A, B, C…)과 송금 목록·상세의 시각·블록 순서를 비교해, 시간 순서가 이어지는 경로를 찾으세요.</li>
        <li>돈이 여러 갈래로 나뉘거나 다시 모이는 흐름은 <strong>패턴 탐지</strong>로 확인할 수 있습니다.</li>
        <li>실습 데이터셋에서는 <strong>경로 탐색(Path)</strong>을 쓸 수 없습니다.</li>
      </ol>
      <p><strong>{onGrade ? '채점' : '제출'}</strong> · 경로를 지갑 이름 순서대로 적어 주세요(예: B → A → C → H). 경로가 여러 개면 줄을 바꿔 적습니다.{onGrade && ' 문제 카드의 채점하기를 누르면 바로 PASS 또는 FAIL이 나옵니다.'}</p>
      {submitUrl && <a className="practice-submit" href={submitUrl} target="_blank" rel="noreferrer">답안 제출하기</a>}
    </div>
    <ol className="practice-list">{problems.problems.map((problem, index) => {
      const dataset = datasets.find(row => row.datasetId === problem.datasetId && row.datasetVersion === problem.datasetVersion)
      const ready = dataset?.status === 'READY'
      const wallet = (role: string, address: string) => {
        const name = dataset?.labels[address.toLowerCase()]
        return <><dt>{role}</dt><dd>{name && <strong className="practice-wallet">{name}</strong>}<AddressValue value={address} label={`${problem.title} ${role} 주소`} /></dd></>
      }
      return <li key={problem.id} className="practice-card">
        <h3>{index + 1}. {problem.title}{problem.level && <span className="practice-level">{problem.level}</span>}</h3>
        {problem.prompt.map((text, line) => <p key={line}>{text}</p>)}
        <dl className="practice-facts">
          <dt>데이터셋</dt><dd>{problem.datasetId} / {problem.datasetVersion}{!ready && <span className="practice-pending">아직 준비되지 않았습니다</span>}</dd>
          {wallet('출발', problem.startAddress)}
          {problem.viaAddress && wallet('경유', problem.viaAddress)}
          {wallet('도착', problem.targetAddress)}
          <dt>탐색 깊이</dt><dd>최대 {problem.maxDepth}단계 · 시간순</dd>
        </dl>
        {problem.notes.map((text, line) => <p key={line} className="practice-note">{text}</p>)}
        {problem.hints.length > 0 && <div className="practice-hints">{problem.hints.map((hint, step) => <details key={step}>
          <summary>힌트 {step + 1} · {hint.title}</summary><p>{hint.text}</p>
        </details>)}</div>}
        <button type="button" disabled={!ready || busy} onClick={() => onStart(problem)}>이 문제로 추적 시작</button>
        {onGrade && <PracticeAnswer problem={problem} disabled={!ready} onGrade={onGrade} />}
      </li>
    })}</ol>
  </div>
}
