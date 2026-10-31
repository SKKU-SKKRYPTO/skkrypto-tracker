import { describe, expect, it, vi } from 'vitest'
import { buildTraceRequest, searchTrace } from './trace'
import { DEFAULT_SEARCH_CONDITIONS } from '../searchConditions'
const S = '0x0000000000000000000000000000000000000001'
const T = '0x0000000000000000000000000000000000000007'
describe('v1 request and Mock', () => {
  it('fixes the dataset, preserving every selected depth and direction', () => {
    for (const maxDepth of [1, 2, 3] as const) {
      expect(buildTraceRequest(` ${S} \n`, { direction: 'incoming', maxDepth })).toEqual({ datasetId: 'flow-demo', datasetVersion: 'v1', address: S, direction: 'incoming', maxDepth })
    }
  })
  it('normalizes case without mutating conditions', () => {
    const conditions = { ...DEFAULT_SEARCH_CONDITIONS }
    expect(buildTraceRequest(' 0x000000000000000000000000000000000000ABCD ', conditions).address).toBe('0x000000000000000000000000000000000000abcd')
    expect(conditions).toEqual(DEFAULT_SEARCH_CONDITIONS)
  })
  it('never silently adjusts depth for the partial-result mode', () => {
    expect(buildTraceRequest(S, { direction: 'outgoing', maxDepth: 1 }, 'candidate-limit')).toMatchObject({ maxDepth: 1, limits: { maxCandidates: 4 } })
  })
  it('returns official success and empty data without network calls', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'))
    try {
      const success = await searchTrace(buildTraceRequest(S, DEFAULT_SEARCH_CONDITIONS))
      const empty = await searchTrace(buildTraceRequest(T, DEFAULT_SEARCH_CONDITIONS))
      expect(success.ok && success.result.transfers).toHaveLength(6)
      expect(empty.ok && empty.result.transfers).toHaveLength(0)
      expect(spy).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
  it('requires explicit maxCandidates 4 and depth 3 for partial results', async () => {
    const result = await searchTrace(buildTraceRequest(S, { direction: 'outgoing', maxDepth: 3 }, 'candidate-limit'))
    expect(result.ok && result.result.transfers).toHaveLength(4)
    expect(result.ok && result.result.limits).toMatchObject({ found: 4, foundIsLowerBound: true, truncated: { reason: 'CANDIDATE_LIMIT' }, analyzedUntil: { blockNumber: '18205040' } })
  })
  it.each([
    [S, 'incoming', 2, 'default'], [S, 'outgoing', 1, 'default'], [S, 'outgoing', 3, 'default'],
    [T, 'outgoing', 3, 'default'], [T, 'outgoing', 2, 'candidate-limit'], [S, 'outgoing', 2, 'candidate-limit'],
    ['0x000000000000000000000000000000000000a001', 'outgoing', 2, 'default'],
  ] as const)('does not fabricate results for %s %s %s %s', async (address, direction, maxDepth, mode) => {
    expect(await searchTrace(buildTraceRequest(address, { direction, maxDepth }, mode))).toMatchObject({ kind: 'mock-unsupported', error: { message: expect.stringContaining('실제 백엔드 API의 기능 제한은 아닙니다') } })
  })
  it.each(['0x123', S.slice(2), S + '0', '0x000000000000000000000000000000000000000g'])('returns official INVALID_INPUT for %s', async address => {
    expect(await searchTrace(buildTraceRequest(address, DEFAULT_SEARCH_CONDITIONS))).toMatchObject({ ok: false, kind: 'api', status: 400, error: { code: 'INVALID_INPUT', retryable: false } })
  })
})
