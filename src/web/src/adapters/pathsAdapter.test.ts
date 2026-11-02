import { describe, expect, it, vi } from 'vitest'
import { adaptPathsResponse } from './pathsAdapter'
import type { PathsDiagnostic } from './pathsAdapter'
import type { PathsRequest, SuccessEnvelope, AnalysisResult } from '../api/v1Types'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import success from '../../mocks/v1/samples/paths-success.json'
import limited from '../../mocks/v1/samples/paths-path-limit.json'
import timed from '../../mocks/v1/samples/paths-time-budget.json'
import badInput from '../../mocks/v1/samples/error-bad-input.json'
import unavailable from '../../mocks/v1/samples/error-unavailable.json'
import notFound from '../../mocks/v1/samples/error-not-found.json'
import notReady from '../../mocks/v1/samples/error-not-ready.json'
import outOfRange from '../../mocks/v1/samples/error-out-of-range.json'
import rateLimited from '../../mocks/v1/samples/error-rate-limited.json'

const key = { datasetId: 'flow-demo', datasetVersion: 'v1' }
const request: PathsRequest = { ...key, address: success.meta.conditions.address, targetAddress: success.meta.conditions.targetAddress, direction: 'outgoing', maxDepth: 3 }
function fixture() { return structuredClone(success) as SuccessEnvelope<AnalysisResult> }
function emptyFixture() {
  // No official Paths-empty sample exists; derive a schema-valid empty result without editing samples.
  const body = fixture()
  body.data.paths = []; body.data.transfers = []; body.data.nodes = []
  body.data.summary = { uniqueTransferCount: 0, uniqueAmountRaw: '0' }
  body.data.limits.found = 0
  body.meta.limits = structuredClone(body.data.limits)
  return body
}

describe('paths endpoint adapter', () => {
  it.each([success, limited, timed])('preserves the official envelope, ordering and partial-result semantics', body => {
    const req = { ...request, limits: { maxPaths: body.meta.conditions.limits.maxPaths } }
    const onInvalid = vi.fn()
    const result = adaptPathsResponse(body, detail, key, 200, req, { onInvalid })
    expect(result).toEqual({ ok: true, result: body })
    expect(onInvalid).not.toHaveBeenCalled()
    if (!result.ok) throw Error('Expected valid paths')
    expect(result.result).not.toBe(body)
    expect(result.result.data.paths).not.toBe(body.data.paths)
  })
  it('retains shared evidence once while keeping every path reference', () => {
    const result = adaptPathsResponse(success, detail, key, 200, request)
    expect(result.ok && result.result.data.paths.map(path => path.transferIds.at(-1))).toEqual(['fx:flow-demo-v1:e6', 'fx:flow-demo-v1:e6'])
    expect(result.ok && result.result.data.transfers).toHaveLength(5)
    expect(result.ok && result.result.data.summary).toEqual(success.data.summary)
  })
  it('accepts an empty result without claiming a complete search when truncated', () => {
    const body = emptyFixture()
    expect(adaptPathsResponse(body, detail, key, 200, request)).toEqual({ ok: true, result: body })
    body.data.limits.truncated = { reason: 'TIME_BUDGET', reasons: ['TIME_BUDGET'] }
    body.data.limits.foundIsLowerBound = true
    body.meta.limits = structuredClone(body.data.limits)
    expect(adaptPathsResponse(body, detail, key, 200, request)).toEqual({ ok: true, result: body })
  })
  it('preserves incoming money-flow order instead of reversing transfers', () => {
    const body = fixture()
    Object.assign(body.meta.conditions!, { address: request.targetAddress, targetAddress: request.address, direction: 'incoming' })
    const req = { ...request, address: request.targetAddress, targetAddress: request.address, direction: 'incoming' as const }
    const result = adaptPathsResponse(body, detail, key, 200, req)
    expect(result.ok && result.result.data.paths).toEqual(success.data.paths)
  })
  it('matches documented defaults for omitted direction and depth zero', () => {
    const body = emptyFixture()
    Object.assign(body.meta.conditions!, { direction: 'outgoing', maxDepth: 2 })
    expect(adaptPathsResponse(body, detail, key, 200, { ...request, direction: undefined, maxDepth: 0 }).ok).toBe(true)
  })
  it('supports another selected dataset/version without a flow-demo constant', () => {
    const selection = { datasetId: 'other', datasetVersion: 'revision-3' }
    const dataset = structuredClone(detail), body = fixture()
    Object.assign(dataset.data, selection); Object.assign(dataset.meta, selection)
    Object.assign(body.meta, selection); Object.assign(body.meta.conditions!, selection)
    expect(adaptPathsResponse(body, dataset, selection, 200, { ...request, ...selection }).ok).toBe(true)
  })
  it('accepts equivalent coverage timestamps with full fractional precision', () => {
    const body = fixture()
    body.meta.coverage!.startTime = body.meta.coverage!.startTime.replace('Z', '.000000000Z')
    expect(adaptPathsResponse(body, detail, key, 200, request).ok).toBe(true)
    body.meta.coverage!.startTime = body.meta.coverage!.startTime.replace('.000000000Z', '.000000001Z')
    expect(adaptPathsResponse(body, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
  })
  it('keeps AmountSum larger than uint256 as an exact decimal string', () => {
    const body = fixture()
    body.data.summary.uniqueAmountRaw = String((1n << 256n) + 150n)
    const result = adaptPathsResponse(body, detail, key, 200, request)
    expect(result.ok && result.result.data.summary.uniqueAmountRaw).toBe(body.data.summary.uniqueAmountRaw)
    body.data.transfers[0].amountRaw = String(1n << 256n)
    expect(adaptPathsResponse(body, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each([[400, badInput], [404, notFound], [409, notReady], [422, outOfRange], [429, rateLimited], [503, unavailable]] as const)('preserves a valid HTTP %s API error without dataset context', (status, body) => {
    const onInvalid = vi.fn()
    expect(adaptPathsResponse(body, null, key, status, request, { onInvalid })).toEqual({ ok: false, kind: 'api', status, error: body.error })
    expect(onInvalid).not.toHaveBeenCalled()
  })
  it.each(['{', null, {}, { ...success, error: badInput.error }])('rejects malformed or invalid response %s', raw => {
    const onInvalid = vi.fn()
    expect(adaptPathsResponse(raw, detail, key, 200, request, { onInvalid })).toMatchObject({ kind: 'invalid-response' })
    expect(onInvalid).toHaveBeenCalledTimes(1)
  })
  it('accepts JSON text and isolates observer exceptions without mutating input', () => {
    const body = fixture(), before = structuredClone(body)
    expect(adaptPathsResponse(JSON.stringify(body), detail, key, 200, request).ok).toBe(true)
    expect(body).toEqual(before)
    body.data.paths[0].transferIds[0] = 'missing'
    const onInvalid = vi.fn(() => { throw Error('observer') })
    expect(adaptPathsResponse(body, detail, key, 200, request, { onInvalid })).toMatchObject({ kind: 'invalid-response' })
    expect(onInvalid).toHaveBeenCalledTimes(1)
  })
  it.each(['datasetId', 'datasetVersion'] as const)('rejects selected dataset, request and response %s mismatches', field => {
    expect(adaptPathsResponse(success, detail, { ...key, [field]: 'wrong' }, 200, request)).toMatchObject({ kind: 'invalid-response' })
    expect(adaptPathsResponse(success, detail, key, 200, { ...request, [field]: 'wrong' })).toMatchObject({ kind: 'invalid-response' })
    const body = fixture(); Object.assign(body.meta, { [field]: 'wrong' })
    expect(adaptPathsResponse(body, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['COLLECTING', 'INVALIDATED', 'FAILED'] as const)('rejects a %s detail', status => {
    const dataset = structuredClone(detail); dataset.data.status = status
    expect(adaptPathsResponse(success, dataset, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['address', 'targetAddress', 'direction', 'maxDepth', 'startTransferId'] as const)('checks effective request %s', field => {
    const wrong = { ...request, [field]: field === 'maxDepth' ? 2 : field === 'direction' ? 'incoming' : '0x0000000000000000000000000000000000000099' }
    expect(adaptPathsResponse(success, detail, key, 200, wrong)).toMatchObject({ kind: 'invalid-response' })
  })
  it('matches explicit limits and filters without rejecting server defaults', () => {
    expect(adaptPathsResponse(success, detail, key, 200, { ...request, limits: { maxPaths: 0 } }).ok).toBe(true)
    expect(adaptPathsResponse(success, detail, key, 200, { ...request, limits: { maxPaths: undefined }, filter: { minAmountRaw: undefined } }).ok).toBe(true)
    expect(adaptPathsResponse(success, detail, key, 200, { ...request, limits: { maxPaths: 1 } })).toMatchObject({ kind: 'invalid-response' })
    expect(adaptPathsResponse(success, detail, key, 200, { ...request, filter: { startBlock: success.meta.coverage.startBlock } }).ok).toBe(true)
    expect(adaptPathsResponse(success, detail, key, 200, { ...request, filter: { startBlock: '1' } })).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['chainId', 'tokenAddress', 'symbol', 'decimals'] as const)('rejects transfer asset %s mismatches', field => {
    const body = fixture()
    Object.assign(body.data.transfers[0].asset, { [field]: field === 'chainId' || field === 'decimals' ? 1 : field === 'tokenAddress' ? '0x0000000000000000000000000000000000000001' : 'OTHER' })
    expect(adaptPathsResponse(body, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
  })
  it('rejects mismatched conditions asset, coverage and duplicate IDs', () => {
    const asset = fixture(); (asset.meta.conditions as PathsRequest).asset!.chainId = 1
    expect(adaptPathsResponse(asset, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
    const coverage = fixture(); coverage.meta.coverage!.endBlock = '99999999'
    expect(adaptPathsResponse(coverage, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
    for (const field of ['transfers', 'nodes', 'paths'] as const) {
      const body = fixture(); body.data[field][1].id = body.data[field][0].id
      expect(adaptPathsResponse(body, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
    }
  })
  it('rejects mismatched limits rather than losing the partial-result meaning', () => {
    const body = fixture(); body.meta.limits!.foundIsLowerBound = true
    expect(adaptPathsResponse(body, detail, key, 200, request)).toMatchObject({ kind: 'invalid-response' })
  })
  it.each(['missing', 'duplicate', 'hops', 'depth', 'disconnected', 'position', 'endpoint'] as const)('rejects %s path evidence', kind => {
    const body = fixture()
    const path = body.data.paths[0]
    if (kind === 'missing') path.transferIds[1] = 'missing'
    if (kind === 'duplicate') path.transferIds[1] = path.transferIds[0]
    if (kind === 'hops') path.hops = 1
    if (kind === 'depth') Object.assign(body.meta.conditions!, { maxDepth: 2 })
    if (kind === 'disconnected') body.data.transfers[2].from = request.address
    if (kind === 'position') Object.assign(body.data.transfers[2], { blockNumber: body.data.transfers[0].blockNumber, transactionIndex: body.data.transfers[0].transactionIndex, logIndex: body.data.transfers[0].logIndex })
    if (kind === 'endpoint') body.data.transfers[0].from = request.targetAddress
    const onInvalid = vi.fn<(diagnostic: PathsDiagnostic) => void>()
    expect(adaptPathsResponse(body, detail, key, 200, kind === 'depth' ? { ...request, maxDepth: 2 } : request, { onInvalid })).toMatchObject({ kind: 'invalid-response' })
    expect(onInvalid).toHaveBeenCalledTimes(1)
    expect(onInvalid.mock.calls[0][0].code).toBe('PATH_EVIDENCE')
  })
})
