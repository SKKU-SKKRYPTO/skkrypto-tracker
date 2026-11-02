import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildJsonFilename, createJsonFile, downloadJson } from './jsonExport'
import type { AnalysisResult, SuccessEnvelope } from './api/v1Types'
import trace from '../mocks/v1/samples/trace-success.json'
import paths from '../mocks/v1/samples/paths-success.json'
import patterns from '../mocks/v1/samples/patterns-success.json'
import empty from '../mocks/v1/samples/trace-ready-empty.json'
import partial from '../mocks/v1/samples/paths-path-limit.json'
import large from '../mocks/v1/samples/trace-amount-sum.json'
const at = new Date('2026-11-03T10:23:45.678+09:00')
type Envelope = SuccessEnvelope<AnalysisResult>
const asEnvelope = (body: unknown) => body as Envelope
function browser() {
  const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() }
  const appendChild = vi.fn(), createElement = vi.fn().mockReturnValue(anchor)
  vi.stubGlobal('document', { createElement, body: { appendChild } })
  const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  const revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { anchor, appendChild, createElement, createURL, revokeURL }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('JSON export content and filename', () => {
  it.each([['trace', trace], ['paths', paths], ['patterns', patterns], ['trace', empty], ['paths', partial], ['trace', large]] as const)('preserves the entire %s envelope and original object', async (mode, sample) => {
    const envelope = structuredClone(sample) as Envelope, before = structuredClone(envelope)
    const file = createJsonFile(mode, envelope, at)
    expect(file.blob.type).toBe('application/json;charset=utf-8')
    const text = await file.blob.text()
    expect(JSON.parse(text)).toEqual(sample)
    expect(Object.keys(JSON.parse(text))).toEqual(['data', 'meta', 'error'])
    expect(envelope).toEqual(before)
    expect(file.filename).toBe(`skkrypto-${mode}-${sample.meta.datasetId}-${sample.meta.datasetVersion}-20261103T012345678Z.json`)
  })
  it('keeps Path evidence ordering and separate Pattern windows sharing a group', async () => {
    const p = JSON.parse(await createJsonFile('paths', asEnvelope(paths), at).blob.text())
    expect(p.data.paths.map((row: { transferIds: string[] }) => row.transferIds)).toEqual(paths.data.paths.map(row => row.transferIds))
    const pattern = JSON.parse(await createJsonFile('patterns', asEnvelope(patterns), at).blob.text())
    expect(pattern.data.patterns).toHaveLength(2)
    expect(pattern.data.patterns[0].groupId).toBe(pattern.data.patterns[1].groupId)
    expect(pattern.data.patterns).toEqual(patterns.data.patterns)
  })
  it('keeps incomplete, truncated and lower-bound fields without recomputing them', async () => {
    const sample = structuredClone(patterns) as Envelope
    sample.data.patterns[0].incomplete = true
    sample.data.limits.truncated = { reason: 'CANDIDATE_LIMIT', reasons: ['CANDIDATE_LIMIT'] }
    sample.data.limits.foundIsLowerBound = true; sample.meta.limits = structuredClone(sample.data.limits)
    expect(JSON.parse(await createJsonFile('patterns', sample, at).blob.text())).toEqual(sample)
  })
  it('preserves decimal strings beyond JavaScript integer precision', async () => {
    const e = structuredClone(large) as Envelope
    e.data.transfers[0].blockNumber = '900719925474099312345'
    const output = JSON.parse(await createJsonFile('trace', e, at).blob.text())
    expect(output.data.transfers[0].blockNumber).toBe('900719925474099312345')
    expect(output.data.summary.uniqueAmountRaw).toBe(large.data.summary.uniqueAmountRaw)
    expect(typeof output.data.transfers[2].amountRaw).toBe('string')
  })
  it('sanitizes unsafe filename components and uses the response identity with UTC time', () => {
    const e = structuredClone(trace) as Envelope
    e.meta.datasetId = '../a/b\\c:*?"<>|\u0000한글'; e.meta.datasetVersion = 'v1.2 /beta'
    const name = buildJsonFilename('trace', e, at)
    expect(name).toBe('skkrypto-trace-_a_b_c_-v1_2_beta-20261103T012345678Z.json')
    expect(name).toMatch(/^[a-zA-Z0-9_-]+\.json$/)
    expect(e.meta.datasetVersion).toBe('v1.2 /beta')
    e.meta.datasetId = 'x'.repeat(1000); e.meta.datasetVersion = 'y'.repeat(1000)
    expect(buildJsonFilename('patterns', e, at).length).toBeLessThan(255)
  })
  it('rejects missing dataset identity and invalid download time', () => {
    const e = structuredClone(trace) as Envelope; delete e.meta.datasetVersion
    expect(() => buildJsonFilename('trace', e, at)).toThrow()
    expect(() => buildJsonFilename('trace', asEnvelope(trace), new Date('invalid'))).toThrow()
  })
})
describe('browser JSON download lifecycle', () => {
  it('creates Blob, clicks a temporary download link then releases the link and URL', async () => {
    vi.useFakeTimers(); const f = browser()
    const pending = downloadJson('trace', asEnvelope(trace), at)
    expect(f.createElement).toHaveBeenCalledExactlyOnceWith('a')
    expect(f.appendChild).toHaveBeenCalledExactlyOnceWith(f.anchor)
    expect(f.anchor.hidden).toBe(true); expect(f.anchor.href).toBe('blob:test')
    expect(f.anchor.download).toBe('skkrypto-trace-flow-demo-v1-20261103T012345678Z.json')
    expect(f.anchor.click).toHaveBeenCalledTimes(1)
    expect(f.revokeURL).not.toHaveBeenCalled()
    expect(JSON.parse(await (f.createURL.mock.calls[0][0] as Blob).text())).toEqual(trace)
    await vi.runAllTimersAsync(); await pending
    expect(f.anchor.remove).toHaveBeenCalledTimes(1); expect(f.revokeURL).toHaveBeenCalledExactlyOnceWith('blob:test')
  })
  it.each(['create-url', 'create-element', 'append', 'click', 'remove'] as const)('cleans resources when %s fails', async stage => {
    vi.useFakeTimers(); const f = browser(), fail = () => { throw Error(stage) }
    if (stage === 'create-url') f.createURL.mockImplementation(fail)
    if (stage === 'create-element') f.createElement.mockImplementation(fail)
    if (stage === 'append') f.appendChild.mockImplementation(fail)
    if (stage === 'click') f.anchor.click.mockImplementation(fail)
    if (stage === 'remove') f.anchor.remove.mockImplementation(fail)
    const pending = downloadJson('patterns', asEnvelope(patterns), at)
    const rejected = expect(pending).rejects.toThrow(stage)
    await vi.runAllTimersAsync(); await rejected
    if (stage !== 'create-url') expect(f.revokeURL).toHaveBeenCalledExactlyOnceWith('blob:test')
    else expect(f.revokeURL).not.toHaveBeenCalled()
    if (stage !== 'create-url' && stage !== 'create-element') expect(f.anchor.remove).toHaveBeenCalledTimes(1)
  })
  it.each(['serialize', 'blob'] as const)('creates no URL or DOM link after %s failure', async stage => {
    const f = browser(), e = structuredClone(trace) as Envelope
    if (stage === 'serialize') (e as unknown as { cycle: unknown }).cycle = e
    else vi.stubGlobal('Blob', class { constructor() { throw Error('Blob unavailable') } })
    await expect(downloadJson('trace', e, at)).rejects.toThrow()
    expect(f.createURL).not.toHaveBeenCalled(); expect(f.createElement).not.toHaveBeenCalled()
  })
})
