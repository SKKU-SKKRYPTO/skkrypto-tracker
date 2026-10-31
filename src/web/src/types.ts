import type { AnalysisRequest, Asset, Coverage, LimitStatus, Node, Transfer } from './api/v1Types'
import type { SearchConditions } from './searchConditions'

// UI model, kept separate from the official API envelopes.
export type TraceResult = {
  sourceMode: 'FIXTURE' | 'SNAPSHOT'
  asset: Asset
  coverage: Coverage
  conditions: AnalysisRequest & SearchConditions
  nodes: Node[]
  transfers: Transfer[]
  limits: LimitStatus
  limitations: string[]
}
export type { Transfer } from './api/v1Types'
