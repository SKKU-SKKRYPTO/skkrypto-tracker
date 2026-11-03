import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import JsonDownloadButton from './JsonDownloadButton'
import { downloadJson } from '../jsonExport'
import type { DatasetSession } from '../state/datasetSession'
import type { AnalysisResult, SuccessEnvelope } from '../api/v1Types'
import sample from '../../mocks/v1/samples/trace-success.json'
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }
    return hooks.slots[index]
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = initial
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value }]
  },
}))
vi.mock('../jsonExport', () => ({ downloadJson: vi.fn() }))
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function setup() {
  let current: SuccessEnvelope<AnalysisResult> | null = sample as SuccessEnvelope<AnalysisResult>
  let mode = 'trace' as 'trace' | 'paths' | 'patterns'
  const getDownloadEnvelope = vi.fn(() => current)
  const session = { getDownloadEnvelope, getSnapshot: () => ({ mode }) } as unknown as Pick<DatasetSession, 'getDownloadEnvelope' | 'getSnapshot'>
  const render = () => {
    hooks.cursor = 0
    const tree = JsonDownloadButton({ session }), nodes = elements(tree)
    return { html: renderToStaticMarkup(tree), button: nodes.find(n => n.type === 'button')! }
  }
  return { session, getDownloadEnvelope, render, change(envelope: typeof current, nextMode = mode) { current = envelope; mode = nextMode } }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; vi.mocked(downloadJson).mockReset().mockResolvedValue(undefined) })
afterEach(() => vi.restoreAllMocks())
describe('common JSON download button', () => {
  it('uses the current lookup for enabled state and accessible action text', () => {
    const f = setup(); expect(f.render().button.props.disabled).toBe(false)
    expect(f.render().html).toContain('검색 결과 JSON 다운로드')
    f.change(null); expect(f.render().button.props.disabled).toBe(true)
  })
  it('rechecks validity on click rather than downloading an old rendered envelope', async () => {
    const f = setup(), stale = f.render().button
    f.change(null); (stale.props.onClick as () => void)(); await flush()
    expect(downloadJson).not.toHaveBeenCalled()
    expect(f.getDownloadEnvelope).toHaveBeenCalledTimes(2)
  })
  it('uses a newer successful envelope and current mode at click time', async () => {
    const f = setup(), stale = f.render().button
    const latest = structuredClone(sample) as SuccessEnvelope<AnalysisResult>
    latest.meta.datasetVersion = 'v2'; f.change(latest, 'patterns')
    ;(stale.props.onClick as () => void)(); await flush()
    expect(downloadJson).toHaveBeenCalledExactlyOnceWith('patterns', latest)
  })
  it('blocks rapid duplicate clicks while preparing and enables retry afterward', async () => {
    const f = setup(); let resolve!: () => void
    vi.mocked(downloadJson).mockReturnValueOnce(new Promise<void>(yes => { resolve = yes }))
    const button = f.render().button
    ;(button.props.onClick as () => void)(); (button.props.onClick as () => void)()
    expect(downloadJson).toHaveBeenCalledTimes(1)
    expect(f.render().button.props.disabled).toBe(true); expect(f.render().button.props['aria-busy']).toBe(true)
    resolve(); await flush(); expect(f.render().button.props.disabled).toBe(false)
    ;(f.render().button.props.onClick as () => void)(); await flush(); expect(downloadJson).toHaveBeenCalledTimes(2)
  })
  it('reports download failure separately, preserves the result and permits retry', async () => {
    const f = setup(); vi.mocked(downloadJson).mockRejectedValueOnce(new Error('prepare'))
    const original = f.session.getDownloadEnvelope()
    ;(f.render().button.props.onClick as () => void)(); await flush()
    expect(f.render().html).toContain('JSON 다운로드를 준비하지 못했습니다')
    expect(f.render().html).toContain('role="alert"'); expect(f.render().button.props.disabled).toBe(false)
    expect(f.session.getDownloadEnvelope()).toBe(original)
    ;(f.render().button.props.onClick as () => void)(); await flush()
    expect(f.render().html).not.toContain('role="alert"')
  })
  it('does not show a late download error against a changed search result', async () => {
    const f = setup(); let reject!: (cause: unknown) => void
    vi.mocked(downloadJson).mockReturnValueOnce(new Promise<void>((_yes, no) => { reject = no }))
    ;(f.render().button.props.onClick as () => void)()
    f.change(structuredClone(sample) as SuccessEnvelope<AnalysisResult>, 'paths')
    reject(new Error('old download')); await flush()
    expect(f.render().html).not.toContain('role="alert"')
    f.change(null); expect(f.render().button.props.disabled).toBe(true)
  })
})

