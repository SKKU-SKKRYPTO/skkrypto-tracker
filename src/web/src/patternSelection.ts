import type { Pattern, Transfer } from './api/v1Types'
import { resolveEvidenceIds } from './pathSelection'

export function resolvePatternSelection(patterns: readonly Pattern[], transfers: readonly Transfer[], selectedPatternId: string | null) {
  const pattern = patterns.find(row => row.patternId === selectedPatternId)
  const transferIds = resolveEvidenceIds(pattern?.evidenceIds ?? [], transfers)
  return { pattern: transferIds.size > 0 ? pattern ?? null : null, transferIds }
}
