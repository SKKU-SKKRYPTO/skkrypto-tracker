import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import sample from '../../mocks/v1/samples/patterns-success.json'
import badInput from '../../mocks/v1/samples/error-bad-input.json'
import unavailable from '../../mocks/v1/samples/error-unavailable.json'
import { buildPatternRequest, createPatternApi } from './patterns'
import type { PatternEnvelope, PatternRequest } from './patterns'
import type { Dataset, SuccessEnvelope } from './v1Types'
import { adaptPatternResponse } from '../adapters/patternAdapter'
import { createHttpClient } from './httpClient'

const fixture = JSON.parse(readFileSync(new URL('../../../backend/api-server/testdata/fixtures/patterns-demo-v1.json', import.meta.url), 'utf8')) as { dataset: Dataset }
const detail: SuccessEnvelope<Dataset> = { data: fixture.dataset, meta: sample.meta as SuccessEnvelope<Dataset>['meta'], error: null }
const selection = { datasetId: 'patterns-demo', datasetVersion: 'v1' }
const request = buildPatternRequest(selection, sample.meta.conditions.address)
const fresh = () => structuredClone(sample) as PatternEnvelope
const adapt = (body: unknown, req: PatternRequest = request) => adaptPatternResponse(body, detail, selection, req)
function setup(body: unknown = sample, status = 200, headers = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }))
  return { fetcher, api: createPatternApi(createHttpClient({ baseUrl: '', fetch: fetcher })) }
}
const input = { dataset: detail, selection, request }
// Derived synthetic responses, NOT additional official samples. Reversing the official
// evidence follows TestPatternsFollowRequestedDirection / TestFanOutInFlowDemo.
function outgoing(): PatternEnvelope {
  const b = fresh()
  for (const t of b.data.transfers) [t.from, t.to] = [t.to, t.from]
  for (const p of b.data.patterns) { p.ruleId = 'FAN_OUT'; p.direction = 'outgoing'; p.patternId = p.patternId.replaceAll('FAN_IN', 'FAN_OUT').replace('incoming', 'outgoing'); p.groupId = p.groupId.replaceAll('FAN_IN', 'FAN_OUT').replace('incoming', 'outgoing') }
  return b
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('Pattern contract and semantics', () => {
  it('uses the unchanged official contract and sample', () => {
    expect(JSON.parse(readFileSync(new URL('../../../backend/api-server/contracts/openapi.json', import.meta.url), 'utf8'))).toEqual(JSON.parse(readFileSync(new URL('../../mocks/v1/openapi.json', import.meta.url), 'utf8')))
    expect(JSON.parse(readFileSync(new URL('../../../backend/api-server/contracts/samples/patterns-success.json', import.meta.url), 'utf8'))).toEqual(sample)
    expect(adapt(sample)).toEqual({ ok: true, envelope: sample })
  })
  it('preserves overlapping windows and repeated counterparties without merging groups', () => {
    const result = adapt(sample)
    if (!result.ok) throw Error('expected success')
    const ps = result.envelope.data.patterns
    expect(ps).toHaveLength(2)
    expect(ps[0].groupId).toBe(ps[1].groupId)
    expect(ps[1].evidenceIds).toHaveLength(4)
    expect(ps[1].uniqueCounterparties).toBe(3)
    expect(result.envelope.data.limits.found).toBe(2)
    result.envelope.data.patterns[0].counterparties.pop()
    expect(sample.data.patterns[0].counterparties).toHaveLength(3)
  })
  it.each(['incoming', 'outgoing'] as const)('accepts explicitly requested %s', direction => {
    const b = direction === 'incoming' ? fresh() : outgoing()
    ;(b.meta.conditions as PatternRequest).direction = direction
    expect(adapt(b, { ...request, direction })).toEqual({ ok: true, envelope: b })
  })
  it('accepts both rules when direction is omitted', () => {
    const b = fresh(), out = outgoing()
    for (const t of out.data.transfers) t.id += ':out'
    for (const p of out.data.patterns) p.evidenceIds = p.evidenceIds.map(id => id + ':out')
    b.data.transfers.push(...out.data.transfers); b.data.patterns.push(...out.data.patterns)
    b.data.summary = { uniqueTransferCount: 10, uniqueAmountRaw: '2100' }
    b.data.limits.found = 4; b.meta.limits = structuredClone(b.data.limits)
    expect(adapt(b)).toEqual({ ok: true, envelope: b })
  })
  it('accepts empty results', () => {
    const b = fresh(); b.data.transfers = []; b.data.nodes = []; b.data.patterns = []
    b.data.summary = { uniqueTransferCount: 0, uniqueAmountRaw: '0' }; b.data.limits.found = 0; b.meta.limits = structuredClone(b.data.limits)
    expect(adapt(b)).toEqual({ ok: true, envelope: b })
  })
  it.each([false, true])('preserves incomplete independently of truncation (%s)', truncated => {
    const b = fresh(); b.data.patterns[0].incomplete = true
    if (truncated) { b.data.limits.truncated = { reason: 'CANDIDATE_LIMIT', reasons: ['CANDIDATE_LIMIT'] }; b.data.limits.foundIsLowerBound = true }
    b.meta.limits = structuredClone(b.data.limits)
    expect(adapt(b)).toEqual({ ok: true, envelope: b })
  })
  const mutations: [string, (b: PatternEnvelope) => void][] = [
    ['missing evidence', b => { b.data.patterns[0].evidenceIds[0] = 'missing' }],
    ['duplicate evidence', b => { b.data.patterns[0].evidenceIds.push(b.data.patterns[0].evidenceIds[0]) }],
    ['duplicate pattern', b => { b.data.patterns[1].patternId = b.data.patterns[0].patternId }],
    ['duplicate transfer', b => { b.data.transfers.push(b.data.transfers[0]) }],
    ['duplicate node', b => { b.data.nodes.push(b.data.nodes[0]) }],
    ['missing endpoint', b => { b.data.nodes.pop() }],
    ['wrong rule direction', b => { b.data.patterns[0].ruleId = 'FAN_OUT' }],
    ['wrong address', b => { b.data.patterns[0].address = b.data.transfers[0].from }],
    ['wrong transfer direction', b => { b.data.transfers[0].to = b.data.transfers[0].from }],
    ['wrong asset', b => { b.data.transfers[0].asset.chainId++ }],
    ['wrong pattern asset', b => { b.data.patterns[0].asset.decimals++ }],
    ['wrong rule version', b => { b.data.patterns[0].ruleVersion = 'flow-v2' }],
    ['wrong threshold', b => { b.data.patterns[0].threshold = 2 }],
    ['wrong duration', b => { b.data.patterns[0].windowSeconds = 601 }],
    ['wrong counterparties', b => { b.data.patterns[0].counterparties[0] = b.data.patterns[0].address }],
    ['repeated counterparties', b => { b.data.patterns[0].counterparties[1] = b.data.patterns[0].counterparties[0] }],
    ['end boundary excluded', b => { b.data.patterns[0].evidenceIds.push(b.data.transfers[3].id) }],
    ['before start', b => { b.data.transfers[0].timestamp = '2026-10-26T13:59:59Z' }],
    ['zero amount', b => { b.data.transfers[0].amountRaw = '0' }],
    ['mint evidence', b => { b.data.transfers[0].transferType = 'MINT' }],
    ['summary amount', b => { b.data.summary.uniqueAmountRaw = '1' }],
    ['summary count', b => { b.data.summary.uniqueTransferCount = 2 }],
    ['found means windows', b => { b.data.limits.found = 5; b.meta.limits = structuredClone(b.data.limits) }],
    ['lower bound without truncation', b => { b.data.limits.foundIsLowerBound = true; b.meta.limits = structuredClone(b.data.limits) }],
    ['different meta limits', b => { b.meta.limits!.found++ }],
    ['different dataset', b => { b.meta.datasetVersion = 'v2' }],
    ['different coverage', b => { b.meta.coverage!.startBlock = '19999' }],
    ['different conditions', b => { (b.meta.conditions as PatternRequest).address = b.data.transfers[0].from }],
    ['unsolicited direction', b => { (b.meta.conditions as PatternRequest).direction = 'incoming' }],
    ['forbidden response depth', b => { (b.meta.conditions as AnalysisRequestForTest).maxDepth = 2 }],
    ['schema error', b => { b.data.patterns[0].incomplete = 'false' as unknown as boolean }],
  ]
  it.each(mutations)('rejects %s', (_, mutate) => { const b = fresh(); mutate(b); expect(adapt(b)).toMatchObject({ kind: 'invalid-response' }) })
  it('isolates observers and reports exactly once', () => {
    const observer = vi.fn(() => { throw Error('observer') })
    expect(adaptPatternResponse({}, detail, selection, request, 200, observer)).toMatchObject({ kind: 'invalid-response' })
    expect(observer).toHaveBeenCalledTimes(1)
  })
  it('normalizes zero limits to official defaults', () => {
    expect(adapt(sample, { ...request, limits: { maxNodes: 0, maxEdges: 0, maxPaths: 0, maxStates: 0, maxCandidates: 0, timeBudgetMs: 0 } })).toEqual({ ok: true, envelope: sample })
  })
  it('accepts explicit filters and limits and rejects silently narrowed defaults', () => {
    const b = fresh()
    const req = { ...request, filter: { minAmountRaw: '1' }, limits: { maxCandidates: 20 } }
    const c = b.meta.conditions as PatternRequest
    c.filter = { ...c.filter, minAmountRaw: '1' }
    c.limits = { ...c.limits, maxCandidates: 20 }
    expect(adapt(b, req)).toEqual({ ok: true, envelope: b })
    expect(adapt(b)).toMatchObject({ kind: 'invalid-response' })
  })
  it('rejects requested filter and limit mismatches', () => {
    expect(adapt(sample, { ...request, filter: { minAmountRaw: '100' } })).toMatchObject({ kind: 'invalid-response' })
    expect(adapt(sample, { ...request, limits: { maxCandidates: 3 } })).toMatchObject({ kind: 'invalid-response' })
  })
})
type AnalysisRequestForTest = { maxDepth?: number }
describe('Pattern HTTP service', () => {
  it('posts only Pattern fields and forwards signal', async () => {
    const { api, fetcher } = setup(); const controller = new AbortController()
    expect(await api.searchPatterns({ ...input, signal: controller.signal })).toEqual({ ok: true, envelope: sample })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/patterns', expect.objectContaining({ method: 'POST', body: JSON.stringify(request), signal: controller.signal }))
    expect(request).not.toHaveProperty('direction')
    expect(buildPatternRequest(selection, ` ${request.address.toUpperCase().replace('0X', '0x')} `, 'outgoing')).toEqual({ ...request, direction: 'outgoing' })
  })
  it.each(['targetAddress', 'startTransferId', 'maxDepth'])('rejects forbidden %s before fetching', async key => {
    const { api, fetcher } = setup()
    await expect(api.searchPatterns({ ...input, request: { ...request, [key]: key === 'maxDepth' ? 2 : request.address } })).rejects.toBeInstanceOf(RangeError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([{}, { address: 'bad' }, { direction: 'both' }, { extra: true }, { filter: { startBlock: '2', endBlock: '1' } }, { limits: { maxCandidates: -1 } }])('rejects invalid request %j', async patch => {
    const { api, fetcher } = setup()
    const req = Object.keys(patch).length ? { ...request, ...patch } : {}
    await expect(api.searchPatterns({ ...input, request: req as PatternRequest })).rejects.toBeInstanceOf(RangeError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['COLLECTING', 'FAILED', 'INVALIDATED'] as const)('rejects %s before fetching', async status => {
    const { api, fetcher } = setup(); const dataset = structuredClone(detail); dataset.data.status = status
    await expect(api.searchPatterns({ ...input, dataset })).rejects.toBeInstanceOf(RangeError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects mismatching selection', async () => {
    await expect(setup().api.searchPatterns({ ...input, selection: { ...selection, datasetVersion: 'v2' } })).rejects.toBeInstanceOf(RangeError)
  })
  it.each([[400, badInput], [503, unavailable]] as const)('preserves HTTP %s error envelope and Retry-After', async (status, envelope) => {
    expect(await setup(envelope, status, { 'Retry-After': '5' }).api.searchPatterns(input)).toEqual({ ok: false, kind: 'api', status, envelope, error: envelope.error, retryAfter: '5' })
  })
  it('rejects malformed JSON and invalid schemas', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>'))
    expect(await createPatternApi(createHttpClient({ fetch: fetcher })).searchPatterns(input)).toMatchObject({ kind: 'invalid-response' })
    expect(await setup({ data: null }).api.searchPatterns(input)).toMatchObject({ kind: 'invalid-response' })
  })
  it('preserves network and body-read errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const api = createPatternApi(createHttpClient({ fetch: fetcher }))
    await expect(api.searchPatterns(input)).rejects.toMatchObject({ stage: 'network' })
    const reply = new Response('{}'); vi.spyOn(reply, 'text').mockRejectedValue(Error('closed')); fetcher.mockResolvedValue(reply)
    await expect(api.searchPatterns(input)).rejects.toMatchObject({ stage: 'response-read' })
  })
  it('cancels before fetch and during transport', async () => {
    const controller = new AbortController(); controller.abort(); const { api, fetcher } = setup()
    await expect(api.searchPatterns({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
    const active = new AbortController()
    const pending = vi.fn<typeof fetch>().mockImplementation(async () => { active.abort(); throw new DOMException('cancelled', 'AbortError') })
    await expect(createPatternApi(createHttpClient({ fetch: pending })).searchPatterns({ ...input, signal: active.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it.each([['', '/api/patterns'], [' https://api.example.test/// ', 'https://api.example.test/api/patterns']])('supports proxy and VITE_API_BASE_URL: %s', async (base, expected) => {
    vi.stubEnv('VITE_API_BASE_URL', base)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(sample))); vi.stubGlobal('fetch', fetcher)
    expect((await createPatternApi().searchPatterns(input)).ok).toBe(true)
    expect(fetcher.mock.calls[0][0]).toBe(expected)
  })
})

