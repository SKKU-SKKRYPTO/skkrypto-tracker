import { describe, expect, it } from 'vitest'
import trace from '../../mocks/v1/samples/trace-success.json'
import dataset from '../../mocks/v1/samples/dataset-detail.json'
import multiple from '../../mocks/v1/samples/transaction-multiple.json'
import { adaptTraceResponse } from '../adapters/traceAdapter'
import type { TraceResult } from '../types'
import { buildElements } from './graphElements'
const response = adaptTraceResponse(trace, dataset)
if (!response.ok) throw new Error('Official trace must adapt')
const result: TraceResult = response.result
describe('v1 graph elements', () => {
  const elements = buildElements(result)
  const nodes = elements.filter(e => e.group === 'nodes')
  const edges = elements.filter(e => e.group === 'edges')
  it('uses the same transfer IDs as table/detail and official node IDs', () => {
    expect(nodes).toHaveLength(6)
    expect(edges).toHaveLength(6)
    expect(edges.map(e => e.data.id)).toEqual(result.transfers.map(t => t.id))
    expect(edges[0].data.source).toBe(result.transfers[0].from)
    expect(edges[0].data.target).toBe(result.transfers[0].to)
  })
  it('marks one effective starting address and preserves labels', () => {
    const starts = nodes.filter(n => n.classes === 'start')
    expect(starts).toHaveLength(1)
    expect(starts[0].data.id).toBe(result.conditions.address)
    expect(starts[0].data.label).toBe('시작\nS\n0x0000…0001')
  })
  it('uses each transfer asset for amount labels', () => {
    expect(edges[0].data.label).toBe('1200 SKK')
    expect(edges[1].data.label).toBe('2500 SKK')
    const other = structuredClone(result)
    other.transfers[0].asset = { ...other.transfers[0].asset, decimals: 6, symbol: 'OTHER' }
    expect(buildElements(other).find(e => e.data.id === other.transfers[0].id)?.data.label).toBe('0.12 OTHER')
  })
  it('supplements missing endpoints without merging transaction logs', () => {
    const other = { ...result, nodes: [], transfers: multiple.data } as TraceResult
    const built = buildElements(other)
    expect(built.filter(e => e.group === 'edges')).toHaveLength(2)
    expect(new Set(built.filter(e => e.group === 'edges').map(e => e.data.id)).size).toBe(2)
    expect(built.filter(e => e.group === 'nodes')).toHaveLength(3)
  })
})
