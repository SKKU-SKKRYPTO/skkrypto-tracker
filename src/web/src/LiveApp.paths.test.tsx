import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import LiveApp from './LiveApp'
import SearchBar from './components/SearchBar'
import PathSearchBar from './components/PathSearchBar'
import { createDatasetSession } from './state/datasetSession'
import { adaptPathsResponse } from './adapters/pathsAdapter'
import { adaptSelectedTraceResponse } from './adapters/traceAdapter'
import type { PathConditions } from './pathConditions'
import { SearchRequestError } from './api/searchFailure'
import detail from '../mocks/v1/samples/dataset-detail.json'
import pathsJson from '../mocks/v1/samples/paths-success.json'
import traceJson from '../mocks/v1/samples/trace-success.json'

// Exercise actual UI callbacks and the real session store without adding a DOM package.
// Layout, browser effect scheduling and native clipboard behavior are outside this harness.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))
const selection = { datasetId: 'flow-demo', datasetVersion: 'v1' }
const pathConditions: PathConditions = { address: pathsJson.meta.conditions.address, targetAddress: pathsJson.meta.conditions.targetAddress, direction: 'outgoing', maxDepth: 3 }
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
async function setup() {
  const paths = { searchPaths: vi.fn().mockResolvedValue(adaptPathsResponse(pathsJson, detail, selection)) }
  const trace = { searchTrace: vi.fn().mockResolvedValue(adaptSelectedTraceResponse(traceJson, detail, selection)) }
  const session = createDatasetSession({ paths, trace, datasets: {
    listDatasets: vi.fn().mockResolvedValue({ ok: true, envelope: { ...detail, data: [detail.data] } }),
    getDataset: vi.fn().mockResolvedValue({ ok: true, envelope: detail }),
  } })
  await session.loadDatasets()
  function render() {
    const tree = LiveApp({ session }), nodes = elements(tree)
    const mode = nodes.find(node => node.props.id === 'analysis-mode')!
    const input = nodes.find(node => node.type === PathSearchBar || node.type === SearchBar)!
    return { html: renderToStaticMarkup(tree), input: input.props,
      changeMode(value: string) { (mode.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }) } }
  }
  return { session, paths, trace, render }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('live Trace and Path UI integration', () => {
  it('defaults to the existing Trace form and exposes no Pattern option', async () => {
    const { render } = await setup(), ui = render()
    expect(ui.html).toContain('추적(Trace)')
    expect(ui.html).toContain('경로(Path)')
    expect(ui.html).not.toContain('Pattern')
    expect(ui.html).not.toContain('대상 주소')
    expect(ui.html).toContain('송금 목록')
  })
  it('connects Path form edits and submit to the phase-one API and ordered results', async () => {
    const { render, paths, trace } = await setup()
    render().changeMode('paths')
    ;(render().input.onChange as (value: PathConditions) => void)(pathConditions)
    ;(render().input.onSearch as () => void)(); await flush()
    expect(paths.searchPaths).toHaveBeenCalledWith(expect.objectContaining({ selection, request: { ...selection, ...pathConditions } }))
    expect(trace.searchTrace).not.toHaveBeenCalled()
    const html = render().html
    expect(html).toContain('경로 1 · 3단계')
    expect(html).toContain('찾은 경로 2개 중 2개 표시')
    expect(html).toContain('송금 상세')
    expect(html).toContain('표나 그래프에서 송금을 선택하면')
  })
  it('shows endpoint validation before an HTTP request', async () => {
    const { render, paths } = await setup(); render().changeMode('paths')
    ;(render().input.onSearch as () => void)(); await flush()
    expect(render().html).toContain('시작 주소는 0x로 시작하는')
    expect(render().html).toContain('role="alert"')
    expect(paths.searchPaths).not.toHaveBeenCalled()
  })
  it('shows loading, disables duplicate submit and exposes cancellation', async () => {
    const { render, paths } = await setup(); render().changeMode('paths')
    paths.searchPaths.mockImplementationOnce(() => new Promise(() => {}))
    ;(render().input.onChange as (value: PathConditions) => void)(pathConditions)
    ;(render().input.onSearch as () => void)()
    expect(render().input.isSearching).toBe(true)
    expect(render().html).toContain('검색 취소')
    ;(render().input.onCancel as () => void)()
    expect(render().input.isSearching).toBe(false)
    expect(render().html).not.toContain('경로 1 ·')
  })
  it('displays real API errors separately from format and network failures', async () => {
    const { render, paths } = await setup(); render().changeMode('paths')
    ;(render().input.onChange as (value: PathConditions) => void)(pathConditions)
    paths.searchPaths.mockResolvedValueOnce({ ok: false, kind: 'api', status: 429, error: { code: 'RATE_LIMITED', message: '요청 제한', retryable: true }, retryAfter: '10' })
    ;(render().input.onSearch as () => void)(); await flush()
    expect(render().html).toContain('HTTP 429')
    expect(render().html).toContain('Retry-After: 10')
    paths.searchPaths.mockResolvedValueOnce({ ok: false, kind: 'invalid-response', error: { message: '잘못된 JSON' } })
    ;(render().input.onSearch as () => void)(); await flush()
    expect(render().html).toContain('응답 형식 오류')
    paths.searchPaths.mockRejectedValueOnce(new SearchRequestError('network'))
    ;(render().input.onSearch as () => void)(); await flush()
    expect(render().html).toContain('네트워크 연결에 실패')
    expect(render().html).not.toContain('경로 1 ·')
  })
  it('clears results on mode change and reconnects the existing Trace view', async () => {
    const { render, session, trace } = await setup()
    render().changeMode('paths'); session.setPathConditions(pathConditions); await session.searchPaths()
    render().changeMode('trace')
    expect(render().html).not.toContain('경로 1 ·')
    ;(render().input.onSearch as (value: string) => void)(traceJson.meta.conditions.address); await flush()
    expect(trace.searchTrace).toHaveBeenCalledTimes(1)
    expect(render().html).toContain('송금 상세')
    expect(render().html).not.toContain('대상 주소')
  })
  it('blocks the form while detail reloads and clears Path results on dataset change', async () => {
    const { render, session } = await setup()
    render().changeMode('paths'); session.setPathConditions(pathConditions); await session.searchPaths()
    const pending = session.selectDataset(selection)
    expect(render().input.disabled).toBe(true)
    expect(render().html).not.toContain('경로 1 ·')
    await pending
    expect(render().input.disabled).toBe(false)
  })
})
