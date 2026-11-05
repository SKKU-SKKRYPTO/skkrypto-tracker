// Reveal a focused result card inside its own list; never scroll the page or
// move focus. Expanded cards taller than the panel keep the control visible.
export function revealResultCard(button: HTMLElement): void {
  const card = button.closest('li')
  const list = card?.closest<HTMLElement>('.result-list')
  if (!card || !list) return
  const panel = list.getBoundingClientRect()
  const target = card.getBoundingClientRect()
  const headingHeight = list.querySelector('.panel-heading')?.getBoundingClientRect().height ?? 0
  if (target.height > list.clientHeight - headingHeight - 24) return
  if (target.top < panel.top + headingHeight + 12) list.scrollTop += target.top - panel.top - headingHeight - 12
  else if (target.bottom > panel.bottom - 12) list.scrollTop += target.bottom - panel.bottom + 12
}
