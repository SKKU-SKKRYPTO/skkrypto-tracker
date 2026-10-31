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

// Characterization tests: these exact results were established before diagnostic refactoring.
// Keep these tests unchanged afterwards, including explicitly documented legacy behavior.
const fixedInvalidResult = {
  ok: false, kind: 'invalid-response',
  error: { message: '응답 JSON이 공식 v1 규격 또는 현재 데이터셋·요청 조건과 맞지 않습니다.' },
}
function alteredField(root: unknown, path: readonly (string | number)[], value: unknown) {
  let current = root as Record<string | number, unknown>
  for (const key of path.slice(0, -1)) current = current[key] as Record<string | number, unknown>
  current[path[path.length - 1]] = value
}
const fixedMutations = [
  ['dataset id', 'dataset', ['data', 'datasetId'], 'other'],
  ['dataset version', 'dataset', ['data', 'datasetVersion'], 'v2'],
  ['dataset status', 'dataset', ['data', 'status'], 'COLLECTING'],
  ['dataset schema', 'dataset', ['data', 'asset', 'decimals'], 256],
  ['meta dataset id', 'response', ['meta', 'datasetId'], 'other'],
  ['meta dataset version', 'response', ['meta', 'datasetVersion'], 'v2'],
  ['source mode', 'response', ['meta', 'sourceMode'], 'SNAPSHOT'],
  ['missing coverage', 'response', ['meta', 'coverage'], undefined],
  ['coverage schema', 'response', ['meta', 'coverage', 'startBlock'], 1],
  ['coverage mismatch', 'response', ['meta', 'coverage', 'startBlock'], '1'],
  ['missing conditions', 'response', ['meta', 'conditions'], undefined],
  ['conditions schema', 'response', ['meta', 'conditions', 'address'], '0x123'],
  ['conditions dataset id', 'response', ['meta', 'conditions', 'datasetId'], 'other'],
  ['conditions dataset version', 'response', ['meta', 'conditions', 'datasetVersion'], 'v2'],
  ['target address in trace', 'response', ['meta', 'conditions', 'targetAddress'], success.meta.conditions.address],
  ['missing direction', 'response', ['meta', 'conditions', 'direction'], undefined],
  ['missing depth', 'response', ['meta', 'conditions', 'maxDepth'], undefined],
  ['effective depth zero', 'response', ['meta', 'conditions', 'maxDepth'], 0],
  ['missing asset', 'response', ['meta', 'conditions', 'asset'], undefined],
  ['incomplete asset', 'response', ['meta', 'conditions', 'asset'], { chainId: 84532, tokenAddress: dataset.data.asset.tokenAddress }],
  ['conditions asset mismatch', 'response', ['meta', 'conditions', 'asset', 'decimals'], 18],
  ['transfer chain', 'response', ['data', 'transfers', 0, 'asset', 'chainId'], 1],
  ['transfer token', 'response', ['data', 'transfers', 0, 'asset', 'tokenAddress'], '0x0000000000000000000000000000000000002000'],
  ['transfer decimals', 'response', ['data', 'transfers', 0, 'asset', 'decimals'], 18],
  ['transfer symbol', 'response', ['data', 'transfers', 0, 'asset', 'symbol'], 'OTHER'],
  ['missing limits', 'response', ['meta', 'limits'], undefined],
  ['limits schema', 'response', ['meta', 'limits', 'found'], '6'],
  ['limits mismatch', 'response', ['meta', 'limits', 'found'], 99],
  ['duplicate transfer', 'response', ['data', 'transfers', 1, 'id'], success.data.transfers[0].id],
  ['duplicate node', 'response', ['data', 'nodes', 1, 'id'], success.data.nodes[0].id],
] as const

describe('pre-refactor exact behavior characterization', () => {
  it.each([success, empty, limited])('returns the exact existing normal/empty/partial UI result', sample => {
    expect(adaptTraceResponse(sample, dataset)).toEqual({ ok: true, result: {
      sourceMode: dataset.data.sourceMode, asset: sample.meta.conditions.asset,
      coverage: sample.meta.coverage, conditions: sample.meta.conditions,
      nodes: sample.data.nodes, transfers: sample.data.transfers,
      limits: sample.meta.limits, limitations: sample.meta.limitations,
    } })
  })
  it('preserves the exact API error result without requiring a dataset', () => {
    expect(adaptTraceResponse(unavailable, null, 503)).toEqual({ ok: false, kind: 'api', status: 503, error: unavailable.error })
  })
  it.each(fixedMutations)('preserves rejection for %s', (_label, target, path, value) => {
    const raw = structuredClone(success)
    const detail = structuredClone(dataset)
    alteredField(target === 'dataset' ? detail : raw, path, value)
    expect(adaptTraceResponse(raw, detail)).toEqual(fixedInvalidResult)
  })
  it.each(['{', null, [], {}, { ...success, error: unavailable.error }])('preserves malformed envelope handling', raw => {
    expect(adaptTraceResponse(raw, dataset)).toEqual(fixedInvalidResult)
  })
  it.each([
    { direction: 'incoming', maxDepth: 2 },
    { direction: 'outgoing', maxDepth: 3 },
  ] as const)('preserves request direction/depth mismatch rejection', conditions => {
    expect(adaptTraceResponse(success, dataset, 200, buildTraceRequest(success.meta.conditions.address, conditions))).toEqual(fixedInvalidResult)
  })
  it('preserves request address and candidate-limit mismatch rejection', () => {
    const request = buildTraceRequest(empty.meta.conditions.address, { direction: 'outgoing', maxDepth: 2 })
    expect(adaptTraceResponse(success, dataset, 200, request)).toEqual(fixedInvalidResult)
    request.address = success.meta.conditions.address
    request.limits = { maxCandidates: 4 }
    expect(adaptTraceResponse(success, dataset, 200, request)).toEqual(fixedInvalidResult)
  })
  it('characterizes existing behavior: request dataset/filter/startTransferId mismatches are not checked', () => {
    const request = buildTraceRequest(success.meta.conditions.address, { direction: 'outgoing', maxDepth: 2 })
    request.datasetId = 'other'
    request.filter = { minAmountRaw: '999999999' }
    request.startTransferId = 'fx:flow-demo-v1:unmatched'
    expect(adaptTraceResponse(success, dataset, 200, request)).toEqual(adaptTraceResponse(success, dataset))
  })
  it('characterizes existing behavior: summary is not cross-checked against transfers', () => {
    const raw = structuredClone(success)
    raw.data.summary.uniqueTransferCount = 999
    expect(adaptTraceResponse(raw, dataset)).toEqual(adaptTraceResponse(success, dataset))
  })
})

const fixedDiagnosticExpectations = [
  ['DATASET_MISMATCH', 'dataset.data.datasetId'], ['DATASET_MISMATCH', 'dataset.data.datasetVersion'],
  ['DATASET_MISMATCH', 'dataset.data.status'], ['DATASET_SCHEMA', 'dataset'],
  ['DATASET_MISMATCH', 'meta.datasetId'], ['DATASET_MISMATCH', 'meta.datasetVersion'], ['DATASET_MISMATCH', 'meta.sourceMode'],
  ['RESPONSE_SCHEMA', 'response'], ['RESPONSE_SCHEMA', 'response'], ['COVERAGE_MISMATCH', 'meta.coverage'],
  ['RESPONSE_SCHEMA', 'response'], ['RESPONSE_SCHEMA', 'response'],
  ['CONDITIONS_MISMATCH', 'meta.conditions.datasetId'], ['CONDITIONS_MISMATCH', 'meta.conditions.datasetVersion'],
  ['CONDITIONS_MISMATCH', 'meta.conditions.targetAddress'], ['RESPONSE_SCHEMA', 'response'], ['RESPONSE_SCHEMA', 'response'],
  ['CONDITIONS_MISMATCH', 'meta.conditions.maxDepth'], ['RESPONSE_SCHEMA', 'response'], ['ASSET_SCHEMA', 'meta.conditions.asset'],
  ['ASSET_MISMATCH', 'meta.conditions.asset'],
  ['TRANSFER_ASSET_MISMATCH', 'data.transfers[0].asset'], ['TRANSFER_ASSET_MISMATCH', 'data.transfers[0].asset'],
  ['TRANSFER_ASSET_MISMATCH', 'data.transfers[0].asset'], ['TRANSFER_ASSET_MISMATCH', 'data.transfers[0].asset'],
  ['RESPONSE_SCHEMA', 'response'], ['RESPONSE_SCHEMA', 'response'], ['LIMITS_MISMATCH', 'meta.limits'],
  ['DUPLICATE_TRANSFER_ID', 'data.transfers[1].id'], ['DUPLICATE_NODE_ID', 'data.nodes[1].id'],
] as const

describe('optional Adapter diagnostics', () => {
  it.each(fixedMutations.map((entry, index) => ({ entry, expected: fixedDiagnosticExpectations[index], label: entry[0] })))(
    'reports exactly one diagnostic for $label and preserves the return value', ({ entry, expected }) => {
      const [, target, path, value] = entry
      const raw = structuredClone(success)
      const detail = structuredClone(dataset)
      alteredField(target === 'dataset' ? detail : raw, path, value)
      const calls: unknown[] = []
      const result = adaptTraceResponse(raw, detail, 200, undefined, { onInvalid: diagnostic => calls.push(diagnostic) })
      expect(result).toEqual(fixedInvalidResult)
      expect(calls).toEqual([{ code: expected[0], path: expected[1] }])
    },
  )
  it.each([
    ['coverage', 'COVERAGE_SCHEMA'], ['conditions', 'CONDITIONS_SCHEMA'], ['limits', 'LIMITS_SCHEMA'],
  ] as const)('diagnoses omitted optional meta.%s required by the UI', (key, code) => {
    const raw = structuredClone(success)
    delete (raw.meta as Partial<typeof raw.meta>)[key]
    const calls: unknown[] = []
    expect(adaptTraceResponse(raw, dataset, 200, undefined, { onInvalid: d => calls.push(d) })).toEqual(fixedInvalidResult)
    expect(calls).toEqual([{ code, path: `meta.${key}` }])
  })
  it.each(['direction', 'maxDepth', 'asset'] as const)('diagnoses omitted effective %s after schema validation', key => {
    const raw = structuredClone(success)
    delete (raw.meta.conditions as Partial<typeof raw.meta.conditions>)[key]
    const calls: unknown[] = []
    expect(adaptTraceResponse(raw, dataset, 200, undefined, { onInvalid: d => calls.push(d) })).toEqual(fixedInvalidResult)
    expect(calls).toEqual([{ code: key === 'asset' ? 'ASSET_SCHEMA' : 'CONDITIONS_MISMATCH', path: `meta.conditions.${key}` }])
  })
  it.each([
    ['address', empty.meta.conditions.address, 'meta.conditions.address'],
    ['direction', 'incoming', 'meta.conditions.direction'], ['maxDepth', 3, 'meta.conditions.maxDepth'],
    ['limits', { maxCandidates: 4 }, 'meta.conditions.limits.maxCandidates'],
  ] as const)('diagnoses request %s mismatch', (key, value, path) => {
    const request = buildTraceRequest(success.meta.conditions.address, { direction: 'outgoing', maxDepth: 2 })
    Object.assign(request, { [key]: value })
    const calls: unknown[] = []
    expect(adaptTraceResponse(success, dataset, 200, request, { onInvalid: d => calls.push(d) })).toEqual(fixedInvalidResult)
    expect(calls).toEqual([{ code: 'REQUEST_MISMATCH', path }])
  })
  it.each([success, empty, limited])('does not notify for valid normal/empty/partial results', raw => {
    const calls: unknown[] = []
    expect(adaptTraceResponse(raw, dataset, 200, undefined, { onInvalid: d => calls.push(d) })).toEqual(adaptTraceResponse(raw, dataset))
    expect(calls).toEqual([])
  })
  it('does not notify for a valid API error', () => {
    const calls: unknown[] = []
    expect(adaptTraceResponse(unavailable, null, 503, undefined, { onInvalid: d => calls.push(d) })).toEqual({ ok: false, kind: 'api', status: 503, error: unavailable.error })
    expect(calls).toEqual([])
  })
  it('notifies once for invalid JSON even when the observer throws', () => {
    const calls: unknown[] = []
    expect(adaptTraceResponse('{', dataset, 200, undefined, { onInvalid: d => { calls.push(d); throw new Error('observer failed') } })).toEqual(fixedInvalidResult)
    expect(calls).toEqual([{ code: 'JSON_PARSE', path: 'response' }])
  })
  it.each(fixedMutations)('isolates a throwing observer for %s', (_label, target, path, value) => {
    const raw = structuredClone(success)
    const detail = structuredClone(dataset)
    alteredField(target === 'dataset' ? detail : raw, path, value)
    let calls = 0
    expect(adaptTraceResponse(raw, detail, 200, undefined, { onInvalid: () => { calls++; throw new Error('observer failed') } })).toEqual(fixedInvalidResult)
    expect(calls).toBe(1)
  })
  it('preserves first-failure ordering across multiple invalid fields', () => {
    const raw = structuredClone(success)
    const detail = structuredClone(dataset)
    detail.data.status = 'COLLECTING'
    raw.meta.coverage.startBlock = '1'
    raw.meta.limits.found = 99
    const calls: unknown[] = []
    adaptTraceResponse(raw, detail, 200, undefined, { onInvalid: d => calls.push(d) })
    expect(calls).toEqual([{ code: 'DATASET_MISMATCH', path: 'dataset.data.status' }])
    detail.data.status = 'READY'
    calls.length = 0
    adaptTraceResponse(raw, detail, 200, undefined, { onInvalid: d => calls.push(d) })
    expect(calls).toEqual([{ code: 'LIMITS_MISMATCH', path: 'meta.limits' }])
  })
  it('classifies unexpected exceptions once and isolates the observer', () => {
    const raw = { ...success, get data() { throw new Error('unexpected getter') } }
    const calls: unknown[] = []
    expect(adaptTraceResponse(raw, dataset, 200, undefined, { onInvalid: d => { calls.push(d); throw new Error('observer failed') } })).toEqual(fixedInvalidResult)
    expect(calls).toEqual([{ code: 'UNEXPECTED', path: 'response' }])
  })
})

