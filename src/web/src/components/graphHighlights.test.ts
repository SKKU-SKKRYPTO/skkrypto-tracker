import { describe, expect, it } from 'vitest'
import cytoscape from 'cytoscape'
import { applyTransferHighlights } from './graphHighlights'
import { buildElements } from './graphElements'
import { uniqueTransfers } from '../pathSelection'
import sample from '../../mocks/v1/samples/paths-success.json'
import type { Transfer } from '../types'

describe('graph evidence classes on real headless Cytoscape', () => {
  it('switches Path highlight sets while preserving real direction and shared edges once', () => {
    const cy = cytoscape({ headless: true, elements: buildElements({ nodes: sample.data.nodes, transfers: uniqueTransfers([...sample.data.transfers as Transfer[], sample.data.transfers[0] as Transfer]), conditions: sample.meta.conditions }) })
    try {
      expect(cy.edges()).toHaveLength(5)
      for (const path of sample.data.paths) {
        applyTransferHighlights(cy, null, new Set([...path.transferIds, 'missing']))
        expect(cy.edges('.path-highlighted').map(edge => edge.id()).sort()).toEqual([...path.transferIds].sort())
        expect(cy.edges('.selected')).toHaveLength(0)
      }
      for (const transfer of sample.data.transfers) {
        expect(cy.getElementById(transfer.id).data('source')).toBe(transfer.from)
        expect(cy.getElementById(transfer.id).data('target')).toBe(transfer.to)
      }
      applyTransferHighlights(cy, null, new Set())
      expect(cy.edges('.path-highlighted')).toHaveLength(0)
    } finally { cy.destroy() }
  })
  it('keeps single-transfer and Path membership independent and ignores nonexistent/non-edge IDs', () => {
    const cy = cytoscape({ headless: true, elements: buildElements({ nodes: sample.data.nodes, transfers: sample.data.transfers as Transfer[], conditions: sample.meta.conditions }) })
    try {
      const single = sample.data.transfers[1].id
      applyTransferHighlights(cy, single, new Set([...sample.data.paths[0].transferIds, sample.data.nodes[0].id, 'missing']))
      expect(cy.edges('.selected').map(edge => edge.id())).toEqual([single])
      expect(cy.edges('.path-highlighted')).toHaveLength(3)
      expect(cy.nodes('.path-highlighted')).toHaveLength(0)
      applyTransferHighlights(cy, null, new Set())
      expect(cy.edges('.selected')).toHaveLength(0)
    } finally { cy.destroy() }
  })
})
