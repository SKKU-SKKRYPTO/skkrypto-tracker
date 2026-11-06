import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DatasetSelector from './DatasetSelector'
import TraceView from './TraceView'
import PathResults from './PathResults'
import PatternResults from './PatternResults'
import { createDatasetSession, type DatasetSessionState } from '../state/datasetSession'
import { adaptTraceResponse } from '../adapters/traceAdapter'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PatternEnvelope } from '../api/patterns'
import type { Dataset, SuccessEnvelope } from '../api/v1Types'
import detailJson from '../../mocks/v1/samples/dataset-detail.json'
import traceJson from '../../mocks/v1/samples/trace-success.json'
import pathsJson from '../../mocks/v1/samples/paths-success.json'
import patternsJson from '../../mocks/v1/samples/patterns-success.json'

const detail = detailJson as SuccessEnvelope<Dataset>
const trace = adaptTraceResponse(traceJson, detail)
const paths = adaptPathsResponse(pathsJson, detail, detail.data)
if (!trace.ok || !paths.ok) throw Error('Invalid fixture')
const pattern = patternsJson as PatternEnvelope
function renderDataset(state: DatasetSessionState) {
  return <DatasetSelector state={state} onSelect={() => {}} onReload={() => {}} onRetryDetail={() => {}} />
}
function state(mode: DatasetSessionState['mode']): DatasetSessionState {
  return { ...createDatasetSession().getSnapshot(), mode, detail: {
    ...detail, data: { ...detail.data, datasetId: mode === 'patterns' ? 'patterns-demo' : 'flow-demo' },
    meta: { ...detail.meta, limitations: [...detail.meta.limitations, '이 데이터셋만의 별도 제한'] },
  }, response: trace, pathResponse: paths, patternResponse: { ok: true, envelope: pattern } }
}
describe('analysis limitation placement', () => {
  it.each(['trace', 'paths', 'patterns'] as const)('shows each API notice once alongside %s results, keeping dataset-only restrictions', mode => {
    const current = state(mode), before = JSON.stringify(current)
    const result = mode === 'trace' ? <TraceView result={trace.result} selectedTransferId={null} onSelect={() => {}} />
      : mode === 'paths' ? <PathResults result={paths.result} /> : <PatternResults envelope={pattern} />
    const html = renderToStaticMarkup(<>{renderDataset(current)}{result}</>)
    for (const text of detail.meta.limitations) expect(html.split(text)).toHaveLength(2)
    expect(html).toContain('이 데이터셋만의 별도 제한')
    expect(html).toContain('aria-label="분석 한계 및 주의사항"')
    expect(JSON.stringify(current)).toBe(before)
  })
  it.each(['trace', 'paths', 'patterns'] as const)('restores dataset notices without a successful %s result', mode => {
    const current = state(mode)
    current.response = null; current.pathResponse = null; current.patternResponse = null
    for (const text of detail.meta.limitations) expect(renderToStaticMarkup(renderDataset(current))).toContain(text)
    current.response = { ok: false, kind: 'invalid-response', error: { message: 'bad response' } }
    for (const text of detail.meta.limitations) expect(renderToStaticMarkup(renderDataset(current))).toContain(text)
  })
  it('does not suppress notices for a different dataset version', () => {
    const current = state('trace')
    current.detail = { ...current.detail!, data: { ...current.detail!.data, datasetVersion: 'v2' } }
    for (const text of detail.meta.limitations) expect(renderToStaticMarkup(renderDataset(current))).toContain(text)
  })
})
