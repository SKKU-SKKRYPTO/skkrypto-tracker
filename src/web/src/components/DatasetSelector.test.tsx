import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { isValidElement } from 'react'
import DatasetSelector from './DatasetSelector'
import RequestNotice from './RequestNotice'
import SearchBar from './SearchBar'
import { createDatasetSession, datasetKeyValue } from '../state/datasetSession'
import type { DatasetSessionState } from '../state/datasetSession'
import type { Dataset, SuccessEnvelope } from '../api/v1Types'
import detailJson from '../../mocks/v1/samples/dataset-detail.json'
const detail = detailJson as SuccessEnvelope<Dataset>
function state(patch: Partial<DatasetSessionState> = {}): DatasetSessionState {
  return { ...createDatasetSession().getSnapshot(), ...patch }
}
function render(current: DatasetSessionState) {
  return renderToStaticMarkup(<DatasetSelector state={current} onSelect={() => {}} onReload={() => {}} onRetryDetail={() => {}} />)
}
describe('dataset selection UI', () => {
  it('shows ID/version/status, asset and coverage with nullable fields safely', () => {
    const data = { ...detail.data, collectedAt: null }
    const html = render(state({ datasets: [data], selection: data, detail: { ...detail, data }, detailStatus: 'ready', listStatus: 'ready' }))
    for (const text of ['flow-demo', 'v1', 'READY', 'SKK', '84532', '18204211', '18206309', '해당 없음', '미확인']) expect(html).toContain(text)
    expect(html).not.toContain('Invalid Date')
    expect(html).not.toContain('undefined')
  })
  it.each(['COLLECTING', 'FAILED', 'INVALIDATED'] as const)('shows information and the search restriction for %s', status => {
    const data = { ...detail.data, status }
    expect(render(state({ detail: { ...detail, data }, detailStatus: 'ready' }))).toContain(`현재 상태가 ${status}이므로 검색할 수 없습니다`)
  })
  it('shows distinct list/detail loading and empty states', () => {
    expect(render(state({ listStatus: 'loading' }))).toContain('목록을 불러오는 중')
    expect(render(state({ detailStatus: 'loading' }))).toContain('상세 정보를 불러오는 중')
    expect(render(state({ listStatus: 'ready' }))).toContain('선택 가능한 데이터셋이 없습니다')
  })
  it('keeps versions separate and sends the exact selected ID/version', () => {
    const rows = [detail.data, { ...detail.data, datasetVersion: 'v2' }]
    const onSelect = vi.fn()
    const element = DatasetSelector({ state: state({ datasets: rows }), onSelect, onReload: () => {}, onRetryDetail: () => {} })
    function visit(node: ReactNode): void {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!isValidElement<{ children?: ReactNode; onChange?: (event: { target: { value: string } }) => void }>(node)) return
      if (node.type === 'select') node.props.onChange!({ target: { value: datasetKeyValue(rows[1]) } })
      visit(node.props.children)
    }
    visit(element)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ datasetId: 'flow-demo', datasetVersion: 'v2' })
    const html = render(state({ datasets: rows, selection: rows[1] }))
    expect(html).toContain('v1')
    expect(html).toContain('v2')
  })
  it('shows API failures and a detail retry action', () => {
    const html = render(state({ selection: detail.data, detailStatus: 'error', detailError: { ok: false, kind: 'api', status: 404, error: { code: 'DATASET_NOT_FOUND', message: '없는 버전', retryable: false } } }))
    expect(html).toContain('DATASET_NOT_FOUND')
    expect(html).toContain('없는 버전')
    expect(html).toContain('상세 다시 조회')
  })
  it('disables search before details are ready without changing direction/depth menus', () => {
    const html = renderToStaticMarkup(<SearchBar isSearching={false} disabled conditions={{ direction: 'outgoing', maxDepth: 2 }} onConditionsChange={() => {}} onSearch={() => {}} />)
    expect(html).toMatch(/<button[^>]*disabled/)
    expect(html).toContain('incoming')
    expect(html).toContain('3단계')
  })
})
describe('live request error notices', () => {
  it('labels real API errors without claiming they are Mock samples', () => {
    const html = renderToStaticMarkup(<RequestNotice failure={{ ok: false, kind: 'api', status: 429, error: { code: 'RATE_LIMITED', message: '요청 제한', retryable: true }, retryAfter: '30' }} />)
    expect(html).toContain('HTTP 429')
    expect(html).toContain('Retry-After: 30')
    expect(html).not.toContain('공식 샘플')
  })
  it.each([
    { ok: false, kind: 'request-failed', stage: 'network', error: { message: '연결 실패' } },
    { ok: false, kind: 'invalid-response', error: { message: '잘못된 응답' } },
  ] as const)('distinguishes $kind from API errors', failure => {
    const html = renderToStaticMarkup(<RequestNotice failure={failure} />)
    expect(html).toContain(failure.kind === 'request-failed' ? '요청 실패' : '응답 형식 오류')
    expect(html).not.toContain('API 오류')
  })
})
