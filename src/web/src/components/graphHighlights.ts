import type { Core } from 'cytoscape'

// Separate evidence membership from the existing single-transfer selection class.
export function applyTransferHighlights(cy: Core, selectedTransferId: string | null, evidenceTransferIds: ReadonlySet<string>) {
  cy.edges().removeClass('selected path-highlighted')
  for (const id of evidenceTransferIds) cy.getElementById(id).filter('edge').addClass('path-highlighted')
  if (selectedTransferId !== null) cy.getElementById(selectedTransferId).filter('edge').addClass('selected')
}
