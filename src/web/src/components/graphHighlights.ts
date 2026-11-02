import type { Core } from 'cytoscape'

// Separate path membership from the existing single-transfer selection class.
export function applyTransferHighlights(cy: Core, selectedTransferId: string | null, pathTransferIds: ReadonlySet<string>) {
  cy.edges().removeClass('selected path-highlighted')
  for (const id of pathTransferIds) cy.getElementById(id).filter('edge').addClass('path-highlighted')
  if (selectedTransferId !== null) cy.getElementById(selectedTransferId).filter('edge').addClass('selected')
}
