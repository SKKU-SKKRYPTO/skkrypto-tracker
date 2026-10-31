import { describe, expect, it } from 'vitest'
import { mockTrace } from './mockApi'
import { buildTraceRequest } from './trace'
const S = '0x0000000000000000000000000000000000000001'
const conditions = { direction: 'outgoing', maxDepth: 2 } as const
describe('Mock request boundaries', () => {
  it('matches every request condition, including optional filters and start transfer', async () => {
    const request = buildTraceRequest(S, conditions)
    expect(await mockTrace({ ...request, filter: { minAmountRaw: '1' } })).toEqual({ supported: false })
    expect(await mockTrace({ ...request, startTransferId: 'fx:flow-demo-v1:e1' })).toEqual({ supported: false })
    expect(await mockTrace({ ...request, datasetVersion: 'v2' })).toEqual({ supported: false })
    expect(await mockTrace({ ...request, limits: { maxEdges: 1 } })).toEqual({ supported: false })
  })
  it('returns independent sample copies', async () => {
    const request = buildTraceRequest(S, conditions)
    const first = await mockTrace(request)
    const second = await mockTrace(request)
    expect(first).toEqual(second)
    if (!first.supported || !second.supported) throw new Error('Expected supported sample')
    expect(first.body).not.toBe(second.body)
    expect(request).toEqual(buildTraceRequest(S, conditions))
  })
})
