import PatternResults from './components/PatternResults'
import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import LiveApp from './LiveApp'
import PatternSearchBar from './components/PatternSearchBar'
import { createDatasetSession } from './state/datasetSession'
import type { PatternConditions } from './patternConditions'
import type { PatternEnvelope, PatternResponse } from './api/patterns'
import { SearchRequestError } from './api/searchFailure'
import detail from '../mocks/v1/samples/dataset-detail.json'
import sample from '../mocks/v1/samples/patterns-success.json'

// Same callback/SSR harness as Path integration; no extra DOM dependency.
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
const conditions: PatternConditions = { address: sample.meta.conditions.address, direction: 'all' }
async function setup() {
  const patterns = { searchPatterns: vi.fn().mockResolvedValue({ ok: true, envelope: sample }) }
  const datasets = {
    listDatasets: vi.fn().mockResolvedValue({ ok: true, envelope: { ...detail, data: [detail.data] } }),
    getDataset: vi.fn().mockResolvedValue({ ok: true, envelope: detail }),
  }
  const session = createDatasetSession({ datasets, patterns }); await session.loadDatasets(); session.setMode('patterns')
  function render() {
    const tree = LiveApp({ session }), nodes = elements(tree)
    const form = nodes.find(n => n.type === PatternSearchBar)
    return { html: renderToStaticMarkup(tree), form: form?.props,
      mode(value: string) { (nodes.find(n => n.props.id === 'analysis-mode-' + value)!.props.onClick as () => void)() } }
  }
  return { session, patterns, datasets, render }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
describe('live Pattern UI integration', () => {
  it.each(['all', 'outgoing', 'incoming'] as const)('connects form changes, submit and window list (%s)', async direction => {
    const { render, patterns } = await setup()
    ;(render().form!.onChange as (c: PatternConditions) => void)({ ...conditions, direction })
    ;(render().form!.onSearch as () => void)(); await flush()
    expect(patterns.searchPatterns).toHaveBeenCalledWith(expect.objectContaining({ request: { datasetId: detail.data.datasetId, datasetVersion: detail.data.datasetVersion, address: conditions.address, ...(direction === 'all' ? {} : { direction }) } }))
    const html = render().html
    expect(html).toContain('패턴 1 ·'); expect(html).toContain('패턴 2 ·')
    expect(html).toContain('발견된 패턴 창 2개'); expect(html).toContain('graph-canvas'); expect(html).toContain('송금 상세 보기')
  })
  it('renders validation without sending and clears it after edits', async () => {
    const { render, patterns } = await setup(); (render().form!.onSearch as () => void)(); await flush()
    expect(render().html).toContain('기준 주소는 0x'); expect(patterns.searchPatterns).not.toHaveBeenCalled()
    ;(render().form!.onChange as (c: PatternConditions) => void)(conditions)
    expect(render().html).not.toContain('기준 주소는 0x')
  })
  it('shows loading, cancellation and discards late responses', async () => {
    const { render, session, patterns } = await setup(); let resolve!: (r: PatternResponse) => void
    patterns.searchPatterns.mockReturnValueOnce(new Promise<PatternResponse>(yes => { resolve = yes }))
    session.setPatternConditions(conditions); (render().form!.onSearch as () => void)()
    expect(render().form!.isSearching).toBe(true); expect(render().html).toContain('검색 취소')
    ;(render().form!.onCancel as () => void)(); resolve({ ok: true, envelope: sample as PatternEnvelope }); await flush()
    expect(render().form!.isSearching).toBe(false); expect(render().html).not.toContain('패턴 1 ·')
  })
  it('shows API, invalid-response and network failures with no stale list', async () => {
    const { render, session, patterns } = await setup(); session.setPatternConditions(conditions)
    patterns.searchPatterns.mockResolvedValueOnce({ ok: false, kind: 'api', status: 429, error: { code: 'RATE_LIMITED', message: '요청 제한', retryable: true }, retryAfter: '10' })
    ;(render().form!.onSearch as () => void)(); await flush(); expect(render().html).toContain('HTTP 429'); expect(render().html).toContain('Retry-After: 10')
    patterns.searchPatterns.mockResolvedValueOnce({ ok: false, kind: 'invalid-response', status: 200, error: { message: '규격 오류' } })
    ;(render().form!.onSearch as () => void)(); await flush(); expect(render().html).toContain('응답 형식 오류')
    patterns.searchPatterns.mockRejectedValueOnce(new SearchRequestError('network'))
    ;(render().form!.onSearch as () => void)(); await flush(); expect(render().html).toContain('네트워크 연결에 실패'); expect(render().html).not.toContain('패턴 1 ·')
  })
  it('clears displayed results when changing modes or datasets', async () => {
    const { render, session } = await setup(); session.setPatternConditions(conditions); await session.searchPatterns()
    render().mode('paths'); expect(render().html).toContain('경로 검색'); expect(render().html).not.toContain('패턴 1 ·')
    render().mode('trace'); expect(render().html).not.toContain('패턴 검색 결과')
    render().mode('patterns'); expect(render().form!.conditions).toEqual(conditions)
    await session.searchPatterns(); const pending = session.selectDataset({ datasetId: detail.data.datasetId, datasetVersion: 'v2' })
    expect(render().form!.disabled).toBe(true); expect(render().html).not.toContain('패턴 1 ·'); await pending
  })
  it('blocks non-READY search and explains why', async () => {
    const { render, session, datasets } = await setup()
    datasets.getDataset.mockResolvedValueOnce({ ok: true, envelope: { ...detail, data: { ...detail.data, status: 'COLLECTING' } } })
    await session.selectDataset({ datasetId: detail.data.datasetId, datasetVersion: 'v1' })
    expect(render().form!.disabled).toBe(true); expect(render().html).toContain('READY 데이터셋의 상세 정보를 확인한 뒤')
  })
})



describe('Live Pattern selection wiring', () => {
  it('connects stable Pattern and transfer callbacks to the session and rendered details', async () => {
    const { session, render } = await setup(); session.setPatternConditions(conditions); await session.searchPatterns()
    function resultProps() {
      return elements(LiveApp({ session })).find(n => n.type === PatternResults)!.props
    }
    ;(resultProps().onSelectPattern as (id: string) => void)(sample.data.patterns[0].patternId)
    ;(resultProps().onSelectTransfer as (id: string) => void)(sample.data.transfers[0].id)
    expect(resultProps().selectedPatternId).toBe(sample.data.patterns[0].patternId)
    expect(resultProps().selectedTransferId).toBe(sample.data.transfers[0].id)
    expect(render().html).toContain('근거 송금 3건')
    expect(render().html).toContain(sample.data.transfers[0].blockHash)
    ;(resultProps().onSelectPattern as (id: string) => void)(sample.data.patterns[1].patternId)
    expect(resultProps().selectedTransferId).toBeNull()
    expect(render().html).toContain('근거 송금 4건')
    render().mode('trace'); expect(session.getSnapshot().selectedPatternId).toBeNull()
  })
})
