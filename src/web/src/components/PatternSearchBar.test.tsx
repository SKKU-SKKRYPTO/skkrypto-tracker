import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import type { ReactNode, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PatternSearchBar from './PatternSearchBar'
import { DEFAULT_PATTERN_CONDITIONS, validatePatternConditions } from '../patternConditions'
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function setup(disabled = false, isSearching = false) {
  const props = { conditions: DEFAULT_PATTERN_CONDITIONS, disabled, isSearching, onChange: vi.fn(), onSearch: vi.fn(), onCancel: vi.fn() }
  const tree = PatternSearchBar(props); return { props, tree, nodes: elements(tree) }
}
describe('Pattern form', () => {
  it('exposes only center address and all/outgoing/incoming choices', () => {
    const html = renderToStaticMarkup(setup().tree)
    for (const text of ['기준 주소', '전체', '분산(FAN_OUT)', '합류(FAN_IN)']) expect(html).toContain(text)
    for (const text of ['대상 주소', '최대 깊이', 'targetAddress', 'startTransferId', 'maxDepth']) expect(html).not.toContain(text)
  })
  it.each([['pattern-address', 'address', '0x123'], ['pattern-direction', 'direction', 'incoming']])('forwards controlled %s edits', (id, key, value) => {
    const { nodes, props } = setup(); const field = nodes.find(n => n.props.id === id)!
    ;(field.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } })
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_PATTERN_CONDITIONS, [key]: value })
  })
  it.each([[false, false, 1], [true, false, 0], [false, true, 0]])('guards submit disabled=%s searching=%s', (disabled, searching, count) => {
    const { props, tree } = setup(disabled as boolean, searching as boolean)
    tree.props.onSubmit({ preventDefault: vi.fn() } as never); expect(props.onSearch).toHaveBeenCalledTimes(count as number)
    if (disabled || searching) expect(renderToStaticMarkup(tree)).toMatch(/<button[^>]*disabled/)
  })
  it('allows cancel and keeps inputs editable while pending', () => {
    const { nodes, props } = setup(false, true); const cancel = nodes.find(n => n.type === 'button' && n.props.type === 'button')!
    ;(cancel.props.onClick as () => void)(); expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(nodes.filter(n => n.type === 'input' || n.type === 'select').every(n => !n.props.disabled)).toBe(true)
  })
  it('validates with official address schema', () => {
    expect(validatePatternConditions({ address: ` 0x${'A'.repeat(40)} `, direction: 'all' })).toBeNull()
    expect(validatePatternConditions(DEFAULT_PATTERN_CONDITIONS)).toContain('기준 주소')
  })
})
