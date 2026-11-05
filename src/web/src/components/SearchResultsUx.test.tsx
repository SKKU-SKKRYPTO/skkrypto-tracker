import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AddressValue from './AddressValue'
import PathResults from './PathResults'
import PatternResults from './PatternResults'
import PathSearchBar from './PathSearchBar'
import PatternSearchBar from './PatternSearchBar'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PatternEnvelope } from '../api/patterns'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import paths from '../../mocks/v1/samples/paths-success.json'
import patterns from '../../mocks/v1/samples/patterns-success.json'

describe('readable addresses and technical disclosures', () => {
  it('offers shortened address, native full-value disclosure and full-value copy', () => {
    const address = paths.meta.conditions.address
    const html = renderToStaticMarkup(<AddressValue value={address} label="기준 주소" />)
    expect(html).toContain('0x0000…0001')
    expect(html).toContain('기준 주소 전체 주소 보기'); expect(html).toContain('기준 주소 복사')
    expect(html).toContain(address); expect(html).not.toMatch(/<details[^>]*\sopen/)
  })
  it('keeps Path identifiers inside technical details with a separate concise connection', () => {
    const response = adaptPathsResponse(paths, detail, { datasetId: 'flow-demo', datasetVersion: 'v1' })
    if (!response.ok) throw Error('sample')
    const html = renderToStaticMarkup(<PathResults result={response.result} />)
    expect(html).toContain('0x0000…0001 → 0x0000…0002 → 0x0000…0005 → 0x0000…0007')
    expect(html.indexOf('기술 상세 · 경로 1')).toBeLessThan(html.indexOf(paths.data.paths[0].id))
    expect(html).toContain('경로 ID 복사'); expect(html).toContain('근거 송금 3건')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
  })
  it('retains separate Pattern windows and visible incomplete warnings while folding IDs', () => {
    const sample = structuredClone(patterns) as PatternEnvelope; sample.data.patterns[0].incomplete = true
    const html = renderToStaticMarkup(<PatternResults envelope={sample} />)
    expect(html).toContain('패턴 1 ·'); expect(html).toContain('패턴 2 ·')
    const technical = html.match(/<details class="technical-details">[\s\S]*?<\/details>/g)!
    expect(technical).toHaveLength(2)
    sample.data.patterns.forEach((p, i) => { expect(technical[i]).toContain(p.patternId); expect(technical[i]).toContain(p.groupId); expect(technical[i]).toContain(p.ruleVersion) })
    const outside = html.replace(/<details class="technical-details">[\s\S]*?<\/details>/g, '')
    expect(outside).toContain('관측 범위 불완전'); expect(outside).toContain('고유 상대 주소 3개')
    expect(html).toContain('패턴 ID 복사'); expect(html).toContain('groupId 복사')
  })
  it('groups each label with its control in both multi-address and Pattern forms', () => {
    const path = renderToStaticMarkup(<PathSearchBar conditions={{ address: '', targetAddress: '', direction: 'outgoing', maxDepth: 2 }} disabled={false} isSearching={false} onChange={() => {}} onSearch={() => {}} onCancel={() => {}} />)
    const pattern = renderToStaticMarkup(<PatternSearchBar conditions={{ address: '', direction: 'all' }} disabled={false} isSearching={false} onChange={() => {}} onSearch={() => {}} onCancel={() => {}} />)
    expect(path.match(/class="search-field/g)).toHaveLength(4)
    expect(pattern.match(/class="search-field/g)).toHaveLength(2)
    expect(path).toContain('class="search-actions"'); expect(pattern).toContain('class="search-actions"')
  })
})
