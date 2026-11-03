import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AnalysisResultHeader from './AnalysisResultHeader'
import { createDatasetSession } from '../state/datasetSession'
import type { AnalysisMode, DatasetSessionState } from '../state/datasetSession'
import type { AnalysisResult, SuccessEnvelope } from '../api/v1Types'
import { adaptTraceResponse } from '../adapters/traceAdapter'
import trace from '../../mocks/v1/samples/trace-success.json'
import paths from '../../mocks/v1/samples/paths-success.json'
import patterns from '../../mocks/v1/samples/patterns-success.json'
import detail from '../../mocks/v1/samples/dataset-detail.json'
const samples = { trace, paths, patterns }
function state(mode: AnalysisMode, sample: unknown = samples[mode]): DatasetSessionState {
  const base = createDatasetSession().getSnapshot()
  if (mode === 'trace') return { ...base, mode, response: adaptTraceResponse(sample, detail) }
  if (mode === 'paths') return { ...base, mode, pathResponse: { ok: true, result: sample as never } }
  return { ...base, mode, patternResponse: { ok: true, envelope: sample as SuccessEnvelope<AnalysisResult> } }
}
const render = (value: DatasetSessionState) => renderToStaticMarkup(<AnalysisResultHeader state={value} />)
describe('applied analysis summary', () => {
  it.each(['trace', 'paths', 'patterns'] as const)('uses the accepted %s response rather than draft controls', mode => {
    const s = state(mode); s.conditions = { direction: 'incoming', maxDepth: 1 }; s.pathConditions.address = 'draft'; s.patternConditions.address = 'draft'
    const html = render(s), sample = samples[mode]
    expect(html).toContain(sample.meta.conditions.address); expect(html).not.toContain('draft')
    expect(html).toContain(`반환 송금 ${sample.data.transfers.length}건`)
    expect(html).toContain('정상 응답'); expect(html).toContain(sample.meta.datasetVersion)
    if (mode !== 'patterns') expect(html).toContain(`최대 깊이: ${mode === 'trace' ? trace.meta.conditions.maxDepth : paths.meta.conditions.maxDepth}단계`)
    else { expect(html).toContain('적용 방향: 전체'); expect(html).not.toContain('최대 깊이') }
  })
  it('distinguishes returned paths, found paths and transfer counts', () => {
    const body = structuredClone(paths); body.data.paths = body.data.paths.slice(0, 1)
    body.data.limits.found = 17; body.data.limits.truncated = { reason: 'PATH_LIMIT', reasons: ['PATH_LIMIT'] } as never
    const html = render(state('paths', body))
    expect(html).toContain('반환 송금 5건'); expect(html).toContain('반환 경로 1개'); expect(html).toContain('찾은 경로 17개 중 1개 표시'); expect(html).toContain('부분 결과')
  })
  it('keeps incomplete independent from truncation and lower bounds', () => {
    const body = structuredClone(patterns); body.data.patterns[0].incomplete = true
    let html = render(state('patterns', body)); expect(html).toContain('정상 응답'); expect(html).toContain('관측 범위가 불완전')
    body.data.limits.foundIsLowerBound = true
    html = render(state('patterns', body)); expect(html).toContain('부분 결과'); expect(html).toContain('최소 발견 건수')
  })
  it.each(['paths', 'patterns'] as const)('shows genuine empty %s response counts', mode => {
    const body = structuredClone(samples[mode]); body.data.transfers = []; body.data.paths = []; body.data.patterns = []; body.data.limits.found = 0
    expect(render(state(mode, body))).toContain('반환 송금 0건')
  })
  it('does not show invented success counts before search or after an error', () => {
    const base = createDatasetSession().getSnapshot()
    expect(render(base)).not.toContain('반환 송금')
    base.response = { ok: false, kind: 'invalid-response', error: { message: 'invalid' } }
    expect(render(base)).not.toContain('정상 응답')
  })
})
