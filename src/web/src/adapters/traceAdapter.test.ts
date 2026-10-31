import { describe, expect, it } from 'vitest'
import dataset from '../../mocks/v1/samples/dataset-detail.json'
import success from '../../mocks/v1/samples/trace-success.json'
import empty from '../../mocks/v1/samples/trace-ready-empty.json'
import limited from '../../mocks/v1/samples/trace-candidate-limit.json'
import unavailable from '../../mocks/v1/samples/error-unavailable.json'
import { adaptTraceResponse } from './traceAdapter'
import { buildTraceRequest } from '../api/trace'
describe('trace adapter', () => {
  it('preserves raw strings, IDs, nodes and effective metadata without mutating the sample', () => {
    const original = structuredClone(success)
    const response = adaptTraceResponse(success, dataset)
    if (!response.ok) throw new Error('Expected valid sample')
    expect(response.result.transfers).toEqual(success.data.transfers)
    expect(response.result.nodes).toEqual(success.data.nodes)
    expect(response.result.conditions).toEqual(success.meta.conditions)
    expect(response.result.coverage).toEqual(success.meta.coverage)
    expect(response.result.limitations).toEqual(success.meta.limitations)
    response.result.transfers[0].asset.decimals = 18
    expect(success).toEqual(original)
  })
  it('keeps the asset when there are no transfers', () => {
    const response = adaptTraceResponse(empty, dataset)
    expect(response.ok && response.result.asset).toEqual(dataset.data.asset)
    expect(response.ok && response.result.transfers).toEqual([])
  })
  it('keeps limits including analyzedUntil', () => {
    const response = adaptTraceResponse(limited, dataset)
    expect(response.ok && response.result.limits).toEqual(limited.meta.limits)
  })
  it('accepts API errors without dataset metadata', () => {
    expect(adaptTraceResponse(unavailable, null, 503)).toMatchObject({ kind: 'api', status: 503, error: { code: 'UNAVAILABLE', retryable: true } })
  })
  it('parses serialized JSON and rejects malformed text', () => {
    expect(adaptTraceResponse(JSON.stringify(success), dataset).ok).toBe(true)
    expect(adaptTraceResponse('{', dataset)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each([null, [], {}, { error: null }, { ...success, error: unavailable.error }, unavailable])('rejects invalid envelopes', raw => {
    expect(adaptTraceResponse(raw, dataset)).toMatchObject({ ok: false, kind: 'invalid-response' })
  })
  it.each([
    (s: typeof success) => { s.data.transfers[0].amountRaw = '1.5' },
    (s: typeof success) => { s.data.transfers[0].blockNumber = '1e18' },
    (s: typeof success) => { s.data.transfers[0].timestamp = 'not a timestamp' },
    (s: typeof success) => { s.data.transfers[0].asset.decimals = 256 },
    (s: typeof success) => { s.data.nodes[0].id = '0x123' },
    (s: typeof success) => { s.data.transfers.push(s.data.transfers[0]) },
    (s: typeof success) => { s.meta.datasetVersion = 'v2' },
    (s: typeof success) => { s.meta.limits.found = 99 },
    (s: typeof success) => { s.meta.conditions.asset.decimals = 18 },
  ])('rejects bad fields and inconsistent metadata', mutate => {
    const sample = structuredClone(success)
    mutate(sample)
    expect(adaptTraceResponse(sample, dataset)).toMatchObject({ kind: 'invalid-response' })
  })
  it('rejects numeric blocks, missing effective metadata, and responses for another request', () => {
    expect(adaptTraceResponse({ ...success, data: { ...success.data, transfers: [{ ...success.data.transfers[0], blockNumber: 18204511 }] } }, dataset)).toMatchObject({ kind: 'invalid-response' })
    expect(adaptTraceResponse({ ...success, meta: { contractVersion: 'v1', ruleVersion: 'flow-v1', limitations: [] } }, dataset)).toMatchObject({ kind: 'invalid-response' })
    expect(adaptTraceResponse(success, dataset, 200, buildTraceRequest(success.meta.conditions.address, { direction: 'incoming', maxDepth: 2 }))).toMatchObject({ kind: 'invalid-response' })
  })
})

describe('P2 response consistency regressions', () => {
  it.each([
    ['chainId', 1], ['tokenAddress', '0x0000000000000000000000000000000000002000'],
    ['decimals', 18], ['symbol', 'OTHER'],
  ] as const)('rejects a transfer asset with mismatched %s', (key, value) => {
    const sample = structuredClone(success)
    Object.assign(sample.data.transfers[0].asset, { [key]: value })
    expect(adaptTraceResponse(sample, dataset)).toMatchObject({ ok: false, kind: 'invalid-response' })
  })
  it.each([success, empty, limited])('still accepts official normal, empty and partial responses', sample => {
    expect(adaptTraceResponse(sample, dataset).ok).toBe(true)
  })
  it.each([
    ['startBlock', '1'], ['endBlock', '2'],
    ['startTime', '2026-10-26T11:50:05Z'], ['endTime', '2026-10-26T12:30:00Z'],
  ] as const)('rejects coverage mismatch in %s, including a narrower collected range', (key, value) => {
    const sample = structuredClone(empty)
    sample.meta.coverage[key] = value
    expect(adaptTraceResponse(sample, dataset)).toMatchObject({ kind: 'invalid-response' })
  })
  it('allows a narrower effective filter with the full collected coverage', () => {
    const sample = structuredClone(empty)
    sample.meta.conditions.filter = {
      startBlock: '18205000', endBlock: '18206000',
      startTime: '2026-10-26T12:20:00Z', endTime: '2026-10-26T12:30:00Z',
    }
    const request = buildTraceRequest(sample.meta.conditions.address, { direction: 'outgoing', maxDepth: 2 })
    request.filter = { ...sample.meta.conditions.filter }
    const response = adaptTraceResponse(sample, dataset, 200, request)
    expect(response.ok && response.result.coverage).toEqual(dataset.meta.coverage)
    expect(response.ok && response.result.conditions.filter).toEqual(request.filter)
  })
  it('accepts equivalent timestamp spellings without discarding fractional precision', () => {
    const sample = structuredClone(empty)
    sample.meta.coverage.startTime = '2026-10-26T11:50:04.000000000Z'
    expect(adaptTraceResponse(sample, dataset).ok).toBe(true)
    sample.meta.coverage.startTime = '2026-10-26T11:50:04.000000001Z'
    expect(adaptTraceResponse(sample, dataset)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['2026-02-30T12:00:04Z', '2025-02-29T12:00:04Z'])('rejects impossible transfer timestamp %s', timestamp => {
    const sample = structuredClone(success)
    sample.data.transfers[0].timestamp = timestamp
    expect(adaptTraceResponse(sample, dataset)).toMatchObject({ kind: 'invalid-response' })
  })
  it('rejects overflow in amountRaw, while preserving the exact maximum', () => {
    const sample = structuredClone(success)
    sample.data.transfers[0].amountRaw = '115792089237316195423570985008687907853269984665640564039457584007913129639936'
    expect(adaptTraceResponse(sample, dataset)).toMatchObject({ kind: 'invalid-response' })
    sample.data.transfers[0].amountRaw = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
    const response = adaptTraceResponse(sample, dataset)
    expect(response.ok && response.result.transfers[0].amountRaw).toBe(sample.data.transfers[0].amountRaw)
  })
})
