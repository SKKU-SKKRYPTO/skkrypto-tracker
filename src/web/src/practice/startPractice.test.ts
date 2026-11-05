import { describe, expect, it, vi } from 'vitest'
import type { DatasetSessionState } from '../state/datasetSession'
import { decodePracticeProblems } from './practiceProblems'
import { S, testProblemsFile } from './practiceTestProblems'
import { startPractice } from './startPractice'

const [problem] = decodePracticeProblems(testProblemsFile)
const readyState = {
  selection: { datasetId: 'flow-demo', datasetVersion: 'v1' }, detailStatus: 'ready',
  detail: { data: { datasetId: 'flow-demo', datasetVersion: 'v1', status: 'READY' } },
} as unknown as DatasetSessionState

// 세션의 동작 순서만 기록하는 가짜 세션. selectDataset이 끝나면 afterSelect 상태가 된다.
function fakeSession(initial: DatasetSessionState, afterSelect: DatasetSessionState) {
  let state = initial
  const calls: string[] = []
  const session = {
    getSnapshot: () => state,
    selectDataset: async (key: { datasetId: string }) => { calls.push('select ' + key.datasetId); state = afterSelect },
    setMode: (mode: string) => { calls.push('mode ' + mode) },
    setConditions: (conditions: { direction: string; maxDepth: number }) => { calls.push(`conditions ${conditions.direction} ${conditions.maxDepth}`) },
    search: async (address: string) => { calls.push('search ' + address) },
  }
  return { calls, session: session as unknown as Parameters<typeof startPractice>[0] }
}

describe('start a practice problem', () => {
  it('selects the problem dataset and traces outgoing from the start address at the problem depth', async () => {
    const { calls, session } = fakeSession({ selection: null, detailStatus: 'idle', detail: null } as unknown as DatasetSessionState, readyState)
    const setAddress = vi.fn()
    expect(await startPractice(session, problem, setAddress)).toBe(true)
    expect(calls).toEqual(['select flow-demo', 'mode trace', `conditions outgoing ${problem.maxDepth}`, 'search ' + S])
    expect(setAddress).toHaveBeenCalledWith(S)
  })
  it('keeps the dataset when it is already selected and ready', async () => {
    const { calls, session } = fakeSession(readyState, readyState)
    await startPractice(session, problem, () => {})
    expect(calls[0]).toBe('mode trace')
  })
  it('does not search a dataset that is not READY', async () => {
    const collecting = { ...readyState, detail: { data: { datasetId: 'flow-demo', datasetVersion: 'v1', status: 'COLLECTING' } } } as unknown as DatasetSessionState
    const { calls, session } = fakeSession({ selection: null, detailStatus: 'idle', detail: null } as unknown as DatasetSessionState, collecting)
    expect(await startPractice(session, problem, () => {})).toBe(false)
    expect(calls).toEqual(['select flow-demo'])
  })
})
