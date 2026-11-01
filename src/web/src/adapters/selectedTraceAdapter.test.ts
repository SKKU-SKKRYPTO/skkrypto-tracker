import { describe, expect, it } from 'vitest'
import detailSample from '../../mocks/v1/samples/dataset-detail.json'
import traceSample from '../../mocks/v1/samples/trace-success.json'
import emptySample from '../../mocks/v1/samples/trace-ready-empty.json'
import partialSample from '../../mocks/v1/samples/trace-candidate-limit.json'
import unavailable from '../../mocks/v1/samples/error-unavailable.json'
import { buildTraceRequest } from '../api/trace'
import { adaptSelectedTraceResponse, adaptTraceResponse } from './traceAdapter'

function selectedFixture(key = { datasetId: 'other-demo', datasetVersion: 'v2' }, sample: typeof traceSample | typeof emptySample | typeof partialSample = traceSample) {
  const detail = structuredClone(detailSample)
  const trace = structuredClone(sample)
  Object.assign(detail.data, key, { sourceNamespace: `${key.datasetId}-${key.datasetVersion}` })
  Object.assign(detail.meta, key)
  Object.assign(trace.meta, key)
  Object.assign(trace.meta.conditions, key)
  for (const transfer of trace.data.transfers) transfer.id = transfer.id.replace('flow-demo-v1', detail.data.sourceNamespace)
  const request = { ...buildTraceRequest(trace.meta.conditions.address, {
    direction: trace.meta.conditions.direction as 'outgoing', maxDepth: trace.meta.conditions.maxDepth as 1 | 2 | 3,
  }), ...key }
  return { key, trace, detail, request }
}
describe('explicit selected dataset trace adapter', () => {
  it.each([
    { datasetId: 'other-demo', datasetVersion: 'v2' },
    { datasetId: 'flow-demo', datasetVersion: 'v2' },
    { datasetId: 'third-demo', datasetVersion: 'revision-10' },
  ])('accepts matching $datasetId / $datasetVersion without a fixed-ID restriction', key => {
    const f = selectedFixture(key)
    const response = adaptSelectedTraceResponse(f.trace, f.detail, key, 200, f.request)
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('Expected selected result')
    expect(response.result.conditions.datasetId).toBe(key.datasetId)
    expect(response.result.conditions.datasetVersion).toBe(key.datasetVersion)
    expect(response.result.transfers).toEqual(f.trace.data.transfers)
    expect(f.detail.data.finalizedBlock).toBeNull()
    // No selection implicitly opts the legacy Mock/tests into dynamic datasets.
    expect(adaptTraceResponse(f.trace, f.detail, 200, f.request)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each([traceSample, emptySample, partialSample])('retains normal, empty and partial results for a selected version', sample => {
    const f = selectedFixture(undefined, sample)
    if (sample === partialSample) f.request.limits = { maxCandidates: 4 }
    const result = adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request)
    expect(result.ok && result.result.limits).toEqual(f.trace.meta.limits)
    expect(result.ok && result.result.coverage).toEqual(f.trace.meta.coverage)
    expect(result.ok && result.result.transfers).toEqual(f.trace.data.transfers)
  })
  it.each(['datasetId', 'datasetVersion'] as const)('rejects selection/detail %s mismatch', field => {
    const f = selectedFixture()
    const calls: unknown[] = []
    expect(adaptSelectedTraceResponse(f.trace, f.detail, { ...f.key, [field]: 'wrong' }, 200, f.request, { onInvalid: d => calls.push(d) })).toMatchObject({ kind: 'invalid-response' })
    expect(calls).toEqual([{ code: 'DATASET_MISMATCH', path: `dataset.data.${field}` }])
  })
  it.each(['datasetId', 'datasetVersion'] as const)('rejects mismatched request %s even when response and detail agree', field => {
    const f = selectedFixture()
    const calls: unknown[] = []
    expect(adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, { ...f.request, [field]: 'wrong' }, { onInvalid: d => calls.push(d) })).toMatchObject({ kind: 'invalid-response' })
    expect(calls).toEqual([{ code: 'REQUEST_MISMATCH', path: `request.${field}` }])
  })
  it.each(['datasetId', 'datasetVersion'] as const)('rejects trace metadata %s from another selection', field => {
    const f = selectedFixture()
    f.trace.meta[field] = 'wrong'
    expect(adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['datasetId', 'datasetVersion'] as const)('rejects effective conditions %s from another selection', field => {
    const f = selectedFixture()
    f.trace.meta.conditions[field] = 'wrong'
    expect(adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['COLLECTING', 'FAILED', 'INVALIDATED'])('does not treat %s details as a valid trace context', status => {
    const f = selectedFixture()
    Object.assign(f.detail.data, { status, collectedAt: null })
    expect(adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request)).toMatchObject({ kind: 'invalid-response' })
  })
  it('retains asset, coverage and limits checks for a different dataset', () => {
    for (const field of ['asset', 'coverage', 'limits']) {
      const f = selectedFixture()
      if (field === 'asset') f.trace.data.transfers[0].asset.decimals = 18
      if (field === 'coverage') f.trace.meta.coverage.startBlock = '1'
      if (field === 'limits') f.trace.meta.limits.found = 999
      expect(adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request)).toMatchObject({ kind: 'invalid-response' })
    }
  })
  it('accepts a different supported asset only when all context and transfers agree', () => {
    const f = selectedFixture()
    const asset = { chainId: 1, tokenAddress: '0x000000000000000000000000000000000000abcd', decimals: 6, symbol: 'OTHER' }
    f.detail.data.asset = { ...asset }
    f.trace.meta.conditions.asset = { ...asset }
    f.trace.data.transfers.forEach(t => { t.asset = { ...asset } })
    const result = adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request)
    expect(result.ok && result.result.asset).toEqual(asset)
    expect(result.ok && result.result.transfers[0].amountRaw).toBe('120000')
  })
  it('supports a SNAPSHOT context without inventing fixture metadata', () => {
    const f = selectedFixture()
    Object.assign(f.detail.data, { sourceMode: 'SNAPSHOT', finalizedBlock: f.detail.data.endBlock })
    f.detail.meta.sourceMode = 'SNAPSHOT'
    f.trace.meta.sourceMode = 'SNAPSHOT'
    f.trace.data.transfers.forEach(t => { t.id = `${t.asset.chainId}:${t.txHash}:${t.logIndex}` })
    const result = adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request)
    expect(result.ok && result.result.sourceMode).toBe('SNAPSHOT')
  })
  it('preserves API errors without requiring a successful detail response', () => {
    expect(adaptSelectedTraceResponse(unavailable, null, { datasetId: 'other-demo', datasetVersion: 'v2' }, 503)).toEqual({ ok: false, kind: 'api', status: 503, error: unavailable.error })
  })
  it('keeps diagnostics isolated and inputs unmodified in selected mode', () => {
    const f = selectedFixture()
    const before = structuredClone(f)
    expect(adaptSelectedTraceResponse(f.trace, f.detail, f.key, 200, f.request).ok).toBe(true)
    expect(f).toEqual(before)
    let calls = 0
    expect(adaptSelectedTraceResponse(f.trace, f.detail, { ...f.key, datasetVersion: 'wrong' }, 200, f.request, { onInvalid: () => { calls++; throw Error('observer') } })).toMatchObject({ kind: 'invalid-response' })
    expect(calls).toBe(1)
  })
})
