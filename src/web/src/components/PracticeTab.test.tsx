import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import list from '../../mocks/v1/samples/datasets-list.json'
import type { Dataset } from '../api/v1Types'
import { decodePracticeProblems } from '../practice/practiceProblems'
import type { PracticeProblemsState } from '../practice/practiceProblems'
import { testProblemsFile } from '../practice/practiceTestProblems'
import PracticeTab from './PracticeTab'
import { PracticeVerdict } from './PracticeAnswer'

type ButtonProps = { onClick?: () => void; disabled?: boolean; children?: ReactNode }
const datasets = list.data as unknown as Dataset[]
const ready: PracticeProblemsState = { status: 'ready', problems: decodePracticeProblems(testProblemsFile) }
const html = (props: Partial<Parameters<typeof PracticeTab>[0]> = {}) =>
  renderToStaticMarkup(<PracticeTab problems={ready} datasets={datasets} onStart={() => {}} {...props} />)
function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<ButtonProps>(node)) return []
  return [...(node.type === 'button' ? [node] : []), ...buttons(node.props.children)]
}

describe('practice tab', () => {
  it('shows each problem with wallet names beside the addresses', () => {
    const page = html()
    expect(page).toContain('1. 연습 1 · 경로')
    expect(page).toContain('flow-demo / v1')
    // flow-demo 이름표: 출발 S, 경유 A, 도착(0x…05) D
    for (const name of ['S', 'A', 'D']) expect(page).toContain(`<strong class="practice-wallet">${name}</strong>`)
    expect(page).toContain('최대 2단계 · 시간순')
    expect(page).toContain('힌트 1 · 첫 힌트')
    expect(page).toContain('경로 탐색(Path)</strong>을 쓸 수 없습니다')
  })
  it('disables the start button until the problem dataset is READY', () => {
    const collecting = datasets.map(row => row.datasetId === 'flow-demo' ? { ...row, status: 'COLLECTING' as const } : row)
    const [first, second] = buttons(PracticeTab({ problems: ready, datasets: collecting, onStart: () => {} }))
    expect(first.props.disabled).toBe(true)
    expect(second.props.disabled).toBe(false)
    expect(html({ datasets: collecting })).toContain('아직 준비되지 않았습니다')
    expect(buttons(PracticeTab({ problems: ready, datasets, busy: true, onStart: () => {} })).every(button => button.props.disabled)).toBe(true)
  })
  it('starts the chosen problem', () => {
    const onStart = vi.fn()
    buttons(PracticeTab({ problems: ready, datasets, onStart }))[1].props.onClick?.()
    expect(onStart).toHaveBeenCalledWith(ready.problems[1])
  })
  it('tells when problems are not published yet or the file is broken', () => {
    expect(html({ problems: null })).toContain('불러오는 중')
    expect(html({ problems: { status: 'unavailable' } })).toContain('실습 당일 공개')
    expect(html({ problems: { status: 'invalid', message: '실습 문제 파일 형식이 올바르지 않습니다: T1 제목' } })).toContain('T1 제목')
  })
  it('adds an answer box and grade button to each card only when grading is on', () => {
    expect(html()).not.toContain('채점하기')
    const page = html({ onGrade: async () => ({ status: 'disabled', message: '' }) })
    expect(page.match(/<textarea/g)).toHaveLength(2)
    expect(page.match(/채점하기/g)).toHaveLength(3)
    expect(page).toContain('바로 PASS 또는 FAIL')
  })
  it('shows only PASS or FAIL as the verdict', () => {
    const verdict = (passed: boolean) => renderToStaticMarkup(<PracticeVerdict outcome={{ status: 'graded', result: { challenge: 'T1', datasetMatches: true, passed } }} />)
    expect(verdict(true)).toContain('<strong>PASS</strong>')
    expect(verdict(false)).toContain('<strong>FAIL</strong>')
    expect(renderToStaticMarkup(<PracticeVerdict outcome={{ status: 'disabled', message: '지금은 채점이 꺼져 있습니다.' }} />)).toContain('채점이 꺼져')
    expect(renderToStaticMarkup(<PracticeVerdict outcome={null} />)).toBe('')
  })
  it('links the submit form only when it is configured', () => {
    expect(html()).not.toContain('답안 제출하기')
    expect(html({ submitUrl: 'https://forms.example/practice' })).toContain('href="https://forms.example/practice"')
  })
})
