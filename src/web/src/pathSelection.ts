import type { Path, Transfer } from './api/v1Types'

// API validation rejects duplicates; keep presentation safe for independently supplied data too.
export function uniqueTransfers(transfers: readonly Transfer[]): Transfer[] {
  const byId = new Map<string, Transfer>()
  for (const transfer of transfers) if (!byId.has(transfer.id)) byId.set(transfer.id, transfer)
  return [...byId.values()]
}

// Missing evidence invalidates the whole selection; never fabricate a partial match.
export function resolveEvidenceIds(ids: readonly string[], transfers: readonly Transfer[]): Set<string> {
  const available = new Set(transfers.map(transfer => transfer.id))
  return ids.length === 0 || ids.some(id => !available.has(id)) ? new Set() : new Set(ids)
}
export function resolvePathSelection(paths: readonly Path[], transfers: readonly Transfer[], selectedPathId: string | null) {
  const path = paths.find(row => row.id === selectedPathId)
  const transferIds = resolveEvidenceIds(path?.transferIds ?? [], transfers)
  return { path: transferIds.size > 0 ? path ?? null : null, transferIds }
}
