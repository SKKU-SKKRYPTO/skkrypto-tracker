import type { Path, Transfer } from './api/v1Types'

// API validation rejects duplicates; keep presentation safe for independently supplied data too.
export function uniqueTransfers(transfers: readonly Transfer[]): Transfer[] {
  const byId = new Map<string, Transfer>()
  for (const transfer of transfers) if (!byId.has(transfer.id)) byId.set(transfer.id, transfer)
  return [...byId.values()]
}

export function resolvePathSelection(paths: readonly Path[], transfers: readonly Transfer[], selectedPathId: string | null) {
  const path = paths.find(row => row.id === selectedPathId)
  const available = new Set(transfers.map(transfer => transfer.id))
  // A partially resolved path must not look like complete evidence for that path.
  if (!path || path.transferIds.length === 0 || path.transferIds.some(id => !available.has(id))) {
    return { path: null, transferIds: new Set<string>() }
  }
  return { path, transferIds: new Set(path.transferIds) }
}
