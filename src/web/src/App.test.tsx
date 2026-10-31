import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'
import SearchBar from './components/SearchBar'
import { searchTrace } from './api/trace'
import type { MockScenario, TraceResponse } from './api/trace'
import type { SearchConditions } from './searchConditions'
import { DEFAULT_SEARCH_CONDITIONS } from './searchConditions'
import { SearchRequestError } from './api/searchFailure'
import { adaptTraceResponse } from './adapters/traceAdapter'
import dataset from '../mocks/v1/samples/dataset-detail.json'
import success from '../mocks/v1/samples/trace-success.json'
import empty from '../mocks/v1/samples/trace-ready-empty.json'
import limited from '../mocks/v1/samples/trace-candidate-limit.json'

// A small hook harness exercises App's actual asynchronous event handler without adding a DOM package.
// React rendering/layout is outside this unit test; result/alert elements are checked after each transition.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = initial
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(hooks.slots[index]) : next
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }
    return hooks.slots[index]
  },
}))
vi.mock('./api/trace', async importOriginal => ({
  ...await importOriginal<typeof import('./api/trace')>(), searchTrace: vi.fn(),
}))
const S = '0x0000000000000000000000000000000000000001'
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function render() {
  hooks.cursor = 0
  const tree = elements(App())
  const search = tree.find(node => node.type === SearchBar)!
  const result = tree.find(node => typeof node.type === 'function' && node.type.name === 'TraceView')
  const alert = tree.find(node => node.type === 'p' && node.props.role === 'alert')
  const scenario = tree.find(node => node.type === 'select' && node.props.id === 'mock-scenario')!
  return {
    search: search.props.onSearch as (address: string) => Promise<void>,
    isSearching: search.props.isSearching,
    changeConditions: search.props.onConditionsChange as (conditions: SearchConditions) => void,
    changeScenario: (value: MockScenario) => (scenario.props.onChange as (event: { target: { value: MockScenario } }) => void)({ target: { value } }),
    result: result?.props,
    alert: alert ? renderToStaticMarkup(alert) : '',
  }
}
function deferred() {
  let resolve!: (response: TraceResponse) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<TraceResponse>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const normal = adaptTraceResponse(success, dataset)
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; vi.mocked(searchTrace).mockReset() })

describe('App asynchronous search failures', () => {
  it.each(['network', 'response-read'] as const)('clears old results and selection on %s failure', async stage => {
    vi.mocked(searchTrace).mockResolvedValueOnce(normal)
    await render().search(S)
    expect(render().result?.result).toEqual(normal.ok ? normal.result : null)
    const select = render().result?.onSelect as (id: string) => void
    select('fx:flow-demo-v1:e1')
    expect(render().result?.selectedTransferId).toBe('fx:flow-demo-v1:e1')
    const next = deferred()
    vi.mocked(searchTrace).mockReturnValueOnce(next.promise)
    const pending = render().search(S)
    expect(render().isSearching).toBe(true)
    expect(render().result).toBeUndefined()
    next.reject(new SearchRequestError(stage))
    await expect(pending).resolves.toBeUndefined()
    expect(render().isSearching).toBe(false)
    expect(render().result).toBeUndefined()
    expect(render().alert).toContain(stage === 'network' ? '네트워크 연결에 실패' : '응답을 끝까지 읽지 못')
    expect(render().alert).not.toContain('API 오류')
    expect(render().alert).not.toContain('응답 형식 오류')
    vi.mocked(searchTrace).mockResolvedValueOnce(normal)
    await render().search(S)
    expect(render().result?.selectedTransferId).toBeNull()
    expect(render().alert).toBe('')
  })
  it('handles unknown promise rejection with a generic request failure', async () => {
    vi.mocked(searchTrace).mockRejectedValueOnce(new Error('private detail'))
    await expect(render().search(S)).resolves.toBeUndefined()
    expect(render().alert).toContain('요청 실패')
    expect(render().alert).not.toContain('private detail')
    expect(render().isSearching).toBe(false)
  })
  it('does not let a late failure overwrite a newer successful response', async () => {
    const old = deferred()
    vi.mocked(searchTrace).mockReturnValueOnce(old.promise).mockResolvedValueOnce(normal)
    const pending = render().search(S)
    await render().search(S)
    old.reject(new SearchRequestError('network'))
    await pending
    expect(render().result?.result).toEqual(normal.ok ? normal.result : null)
    expect(render().alert).toBe('')
    expect(render().isSearching).toBe(false)
  })
  it('does not let a late success overwrite a newer failed request', async () => {
    const old = deferred()
    vi.mocked(searchTrace).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new SearchRequestError('response-read'))
    const pending = render().search(S)
    await render().search(S)
    old.resolve(normal)
    await pending
    expect(render().result).toBeUndefined()
    expect(render().alert).toContain('응답을 끝까지 읽지 못')
  })
  it.each([
    { kind: 'invalid-response', error: { message: 'invalid JSON' }, ok: false },
    { kind: 'mock-unsupported', error: { message: 'unsupported Mock' }, ok: false },
    { kind: 'api', status: 400, error: { code: 'INVALID_INPUT', message: 'invalid input', retryable: false }, ok: false },
  ] as const)('keeps $kind distinct from thrown request failures', async response => {
    vi.mocked(searchTrace).mockResolvedValueOnce(response)
    await render().search(S)
    expect(render().alert).toContain(response.kind === 'api' ? 'API 오류' : response.kind === 'invalid-response' ? '응답 형식 오류' : 'Mock 미지원')
    expect(render().alert).not.toContain('요청 실패')
  })
  it.each([success, empty, limited])('still passes official normal, empty and partial results to the existing view', async sample => {
    const response = adaptTraceResponse(sample, dataset)
    expect(response.ok).toBe(true)
    vi.mocked(searchTrace).mockResolvedValueOnce(response)
    await render().search(S)
    expect(render().result?.result).toEqual(response.ok ? response.result : null)
    expect(render().alert).toBe('')
  })
})

const conditionChanges = [
  ['direction', () => render().changeConditions({ ...DEFAULT_SEARCH_CONDITIONS, direction: 'incoming' })],
  ['depth', () => render().changeConditions({ ...DEFAULT_SEARCH_CONDITIONS, maxDepth: 3 })],
  ['Mock scenario', () => render().changeScenario('candidate-limit')],
] as const

describe('search invalidation when conditions change', () => {
  it.each(conditionChanges)('immediately stops loading and ignores late success after changing %s', async (_label, change) => {
    const old = deferred()
    vi.mocked(searchTrace).mockReturnValueOnce(old.promise)
    const pending = render().search(S)
    expect(render().isSearching).toBe(true)
    change()
    expect(render().isSearching).toBe(false)
    expect(render().result).toBeUndefined()
    old.resolve(normal)
    await pending // Includes the invalidated request's finally.
    expect(render().isSearching).toBe(false)
    expect(render().result).toBeUndefined()
    expect(render().alert).toBe('')
  })

  it.each(conditionChanges)('ignores late failure and its finally after changing %s', async (_label, change) => {
    const old = deferred()
    vi.mocked(searchTrace).mockReturnValueOnce(old.promise)
    const pending = render().search(S)
    change()
    expect(render().isSearching).toBe(false)
    old.reject(new SearchRequestError('network'))
    await expect(pending).resolves.toBeUndefined()
    expect(render().alert).toBe('')
    expect(render().result).toBeUndefined()
    expect(render().isSearching).toBe(false)
  })

  it.each(conditionChanges.flatMap(([label, change]) => (['resolve', 'reject'] as const).map(outcome => ({ label, change, outcome }))))(
    'keeps a newer search loading when the invalidated $label request finishes with $outcome',
    async ({ change, outcome }) => {
      const old = deferred()
      const latest = deferred()
      vi.mocked(searchTrace).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
      const oldPending = render().search(S)
      change()
      expect(render().isSearching).toBe(false)
      const latestPending = render().search(S)
      expect(render().isSearching).toBe(true)
      if (outcome === 'resolve') old.resolve(normal)
      else old.reject(new SearchRequestError('response-read'))
      await oldPending
      expect(render().isSearching).toBe(true) // The old finally must not clear this flag.
      expect(render().result).toBeUndefined()
      expect(render().alert).toBe('')
      const newest: TraceResponse = { ok: false, kind: 'mock-unsupported', error: { message: 'newer conditions result' } }
      latest.resolve(newest)
      await latestPending
      expect(render().isSearching).toBe(false)
      expect(render().result).toBeUndefined()
      expect(render().alert).toContain('newer conditions result')
    },
  )

  it.each(conditionChanges)('preserves an already displayed result but clears selection on %s change', async (_label, change) => {
    vi.mocked(searchTrace).mockResolvedValueOnce(normal)
    await render().search(S)
    const displayed = render().result?.result
    const select = render().result?.onSelect as (id: string) => void
    select('fx:flow-demo-v1:e1')
    expect(render().result?.selectedTransferId).toBe('fx:flow-demo-v1:e1')
    change()
    expect(render().result?.result).toBe(displayed)
    expect(render().result?.selectedTransferId).toBeNull()
    expect(render().isSearching).toBe(false)
    expect(vi.mocked(searchTrace)).toHaveBeenCalledTimes(1)
  })
})
