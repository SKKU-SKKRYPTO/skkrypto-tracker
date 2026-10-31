import dataset from '../../mocks/v1/samples/dataset-detail.json'
import { adaptTraceResponse } from '../adapters/traceAdapter'
import type { SearchConditions } from '../searchConditions'
import type { AnalysisRequest } from './v1Types'
import { mockTrace, MOCK_UNSUPPORTED_MESSAGE } from './mockApi'
export type { TraceResponse } from '../adapters/traceAdapter'

export type MockScenario = 'default' | 'candidate-limit'
export type TraceRequest = Omit<AnalysisRequest, 'targetAddress' | 'maxDepth' | 'direction'> & SearchConditions

export function buildTraceRequest(address: string, conditions: SearchConditions, scenario: MockScenario = 'default'): TraceRequest {
  return {
    datasetId: 'flow-demo',
    datasetVersion: 'v1',
    address: address.trim().toLowerCase(),
    direction: conditions.direction,
    maxDepth: conditions.maxDepth,
    ...(scenario === 'candidate-limit' ? { limits: { maxCandidates: 4 } } : {}),
  }
}

export async function searchTrace(request: TraceRequest) {
  const reply = await mockTrace(request)
  if (!reply.supported) {
    return { ok: false as const, kind: 'mock-unsupported' as const, error: { message: MOCK_UNSUPPORTED_MESSAGE } }
  }
  return adaptTraceResponse(reply.body, dataset, reply.status, request)
}
