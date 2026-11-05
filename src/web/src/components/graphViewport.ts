import type { Core } from 'cytoscape'
import { watchGraphSize } from './graphResize'

// Fit after layout and browser sizing have settled. Once the user changes the
// viewport (including the fit button), resizing must not undo that choice.
export function watchGraphViewport(cy: Core, container: HTMLElement): () => void {
  let frame: number | undefined
  let disposed = false
  let userViewport = false
  let automatic = false
  const preserveViewport = () => { if (!automatic) userViewport = true }
  const scheduleFit = () => {
    if (disposed || userViewport) return
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (disposed || userViewport || container.clientWidth === 0 || container.clientHeight === 0) return
      automatic = true
      try { cy.resize(); cy.fit(undefined, 32) } finally { automatic = false }
    })
  }
  cy.on('pan zoom', preserveViewport)
  cy.on('layoutstop', scheduleFit)
  // Also handles synchronous layouts that stopped inside the constructor.
  cy.ready(scheduleFit)
  const stopResize = watchGraphSize(container, () => {
    automatic = true
    try { cy.resize() } finally { automatic = false }
    scheduleFit()
  })
  return () => {
    disposed = true
    if (frame !== undefined) cancelAnimationFrame(frame)
    cy.off('pan zoom', preserveViewport)
    cy.off('layoutstop', scheduleFit)
    stopResize()
  }
}
