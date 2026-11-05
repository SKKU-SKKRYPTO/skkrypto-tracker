import { useState } from 'react'
import type { PracticeGradeOutcome } from '../practice/practiceGrade'
import { practicePerfect } from '../practice/practiceGrade'
import type { PracticeProblem } from '../practice/practiceProblems'

type Props = {
  problem: PracticeProblem
  disabled?: boolean
  onGrade: (problem: PracticeProblem, text: string) => Promise<PracticeGradeOutcome>
}

// 문제 카드의 답안 칸. 경로를 지갑 이름 순서로 적고 채점하면 통과 여부(PASS/FAIL)만 보여 준다. 몇 번이든 다시 채점할 수 있다.
export default function PracticeAnswer({ problem, disabled = false, onGrade }: Props) {
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<PracticeGradeOutcome | null>(null)
  const [grading, setGrading] = useState(false)
  const id = 'practice-answer-' + problem.id
  async function grade() {
    setGrading(true)
    setOutcome(null)
    try {
      setOutcome(await onGrade(problem, text))
    } catch {
      setOutcome({ status: 'failed', message: '채점하지 못했습니다. 잠시 뒤 다시 눌러 주세요.' })
    } finally {
      setGrading(false)
    }
  }
  return <div className="practice-answer">
    <label htmlFor={id}>답안 · 경로마다 한 줄, 지갑 이름 순서</label>
    <textarea id={id} rows={3} value={text} placeholder="예: B → A → C → H" spellCheck={false} autoComplete="off"
      onChange={event => { setText(event.target.value); setOutcome(null) }} />
    <button type="button" disabled={disabled || grading || !text.trim()} onClick={() => { void grade() }}>{grading ? '채점 중…' : '채점하기'}</button>
    <PracticeVerdict outcome={outcome} />
  </div>
}

// 채점 결과 문구. 통과하면 PASS, 아니면 FAIL만 알려 주고 어느 경로가 맞았는지는 말하지 않는다.
export function PracticeVerdict({ outcome }: { outcome: PracticeGradeOutcome | null }) {
  if (!outcome) return null
  if (outcome.status !== 'graded') return <p className="practice-verdict practice-verdict-info" role="status">{outcome.message}</p>
  return practicePerfect(outcome.result)
    ? <p className="practice-verdict practice-verdict-pass" role="status"><strong>PASS</strong> 정답입니다! 빠진 경로 없이 모두 찾았어요.</p>
    : <p className="practice-verdict practice-verdict-fail" role="status"><strong>FAIL</strong> 아직 정답이 아니에요. 빠진 경로나 틀린 경로가 없는지, 송금 시간 순서를 다시 확인해 보세요.</p>
}
