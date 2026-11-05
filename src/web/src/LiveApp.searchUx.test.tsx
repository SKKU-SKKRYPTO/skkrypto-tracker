import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import LiveApp from './LiveApp'
import SearchBar from './components/SearchBar'
import { createDatasetSession } from './state/datasetSession'
import { adaptTraceResponse } from './adapters/traceAdapter'
import detail from '../mocks/v1/samples/dataset-detail.json'
import trace from '../mocks/v1/samples/trace-success.json'
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: () => {}, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = value }]
  },
}))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
describe('mode buttons and persistent Trace draft', () => {
  it('preserves Trace draft across modes while clearing results, selection and downloads', async () => {
    hooks.slots = []
    const session = createDatasetSession({ datasets: {
      listDatasets: vi.fn().mockResolvedValue({ ok: true, envelope: { ...detail, data: [detail.data] } }),
      getDataset: vi.fn().mockResolvedValue({ ok: true, envelope: detail }),
    }, trace: { searchTrace: vi.fn().mockResolvedValue(adaptTraceResponse(trace, detail)) } })
    await session.loadDatasets()
    const render = () => { hooks.cursor = 0; return elements(LiveApp({ session })) }
    const change = (mode: string) => (render().find(n => n.props.id === 'analysis-mode-' + mode)!.props.onClick as () => void)()
    const field = () => render().find(n => n.type === SearchBar)!.props
    ;(field().onAddressChange as (s: string) => void)(trace.meta.conditions.address)
    expect(field().address).toBe(trace.meta.conditions.address)
    await session.search(trace.meta.conditions.address); session.selectTransfer(trace.data.transfers[0].id)
    expect(session.getDownloadEnvelope()).not.toBeNull()
    const modeButtons = render().filter(n => String(n.props.id).startsWith('analysis-mode-'))
    expect(modeButtons).toHaveLength(3)
    expect(modeButtons.every(n => n.type === 'button' && n.props.type === 'button' && n.props['aria-describedby'])).toBe(true)
    expect(modeButtons[0].props['aria-pressed']).toBe(true)
    change('paths'); expect(session.getDownloadEnvelope()).toBeNull()
    expect(session.getSnapshot().selectedTransferId).toBeNull()
    change('patterns'); change('trace')
    expect(field().address).toBe(trace.meta.conditions.address)
    expect(session.getSnapshot().response).toBeNull()
    ;(field().onAddressChange as (s: string) => void)('edited draft')
    expect(session.getDownloadEnvelope()).toBeNull()
    expect(field().address).toBe('edited draft')
  })
})
