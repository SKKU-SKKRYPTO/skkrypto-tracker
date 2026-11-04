// ResizeObserver tracks the actual canvas area, including disclosure and grid changes.
export function watchGraphSize(container: HTMLElement, refresh: () => void): () => void {
  let frame: number | undefined
  let previous = `${container.clientWidth}:${container.clientHeight}`
  const schedule = () => {
    const width = container.clientWidth, height = container.clientHeight
    const next = `${width}:${height}`
    if (width === 0 || height === 0 || next === previous) return
    previous = next
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { frame = undefined; refresh() })
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  observer?.observe(container)
  if (!observer) window.addEventListener('resize', schedule)
  return () => {
    observer?.disconnect()
    if (!observer) window.removeEventListener('resize', schedule)
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}
