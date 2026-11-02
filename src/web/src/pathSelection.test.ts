import { describe, expect, it } from 'vitest'
import { resolvePathSelection, uniqueTransfers } from './pathSelection'
import sample from '../mocks/v1/samples/paths-success.json'
import type { Transfer } from './api/v1Types'

const transfers = sample.data.transfers as Transfer[]
describe('Path evidence selection', () => {
  it.each([0, 1])('resolves path %s to its exact evidence IDs without duplicating shared transfers', index => {
    const before = structuredClone(sample)
    const selected = resolvePathSelection(sample.data.paths, transfers, sample.data.paths[index].id)
    expect([...selected.transferIds]).toEqual(sample.data.paths[index].transferIds)
    expect(selected.path).toBe(sample.data.paths[index])
    expect(sample).toEqual(before)
  })
  it.each([null, 'missing'])('does not highlight anything for selection %s', id => {
    expect(resolvePathSelection(sample.data.paths, transfers, id).transferIds.size).toBe(0)
  })
  it('rejects a partially resolved or empty path instead of highlighting partial evidence', () => {
    const path = sample.data.paths[0]
    expect(resolvePathSelection([{ ...path, transferIds: [...path.transferIds, 'missing'] }], transfers, path.id).path).toBeNull()
    expect(resolvePathSelection([{ ...path, transferIds: [] }], transfers, path.id).transferIds.size).toBe(0)
  })
  it('deduplicates repeated evidence IDs defensively', () => {
    const path = sample.data.paths[0]
    expect([...resolvePathSelection([{ ...path, transferIds: [...path.transferIds, path.transferIds[0]] }], transfers, path.id).transferIds]).toEqual(path.transferIds)
  })
  it('preserves first occurrence order when presentation receives duplicate transfers', () => {
    expect(uniqueTransfers([...transfers, transfers[0]])).toEqual(transfers)
    expect(uniqueTransfers([])).toEqual([])
  })
})
