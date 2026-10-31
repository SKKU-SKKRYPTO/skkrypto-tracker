import manifest from '../../mocks/v1/sample-requests.json'
import traceSuccess from '../../mocks/v1/samples/trace-success.json'
import traceEmpty from '../../mocks/v1/samples/trace-ready-empty.json'
import traceLimited from '../../mocks/v1/samples/trace-candidate-limit.json'
import badInput from '../../mocks/v1/samples/error-bad-input.json'
import type { TraceRequest } from './trace'

export const MOCK_UNSUPPORTED_MESSAGE = '현재 공식 샘플 Mock에서 지원하지 않는 주소·방향·깊이·상한 조합입니다. 실제 백엔드 API의 기능 제한은 아닙니다.'
export type MockReply = { supported: true; status: number; body: unknown } | { supported: false }
const traceSamples: Record<string, unknown> = {
  'trace-success.json': traceSuccess,
  'trace-ready-empty.json': traceEmpty,
  'trace-candidate-limit.json': traceLimited,
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Match full request conditions; never run an imitation of the backend's trace algorithm.
export async function mockTrace(request: TraceRequest): Promise<MockReply> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(request.address)) {
    // Shared INVALID_INPUT error shape is valid for POST /api/trace as well as /api/paths.
    return { supported: true, status: 400, body: structuredClone(badInput) }
  }
  const normalized = { ...request, address: request.address.toLowerCase() }
  for (const entry of manifest) {
    if (entry.path !== '/api/trace' || !entry.body || !(entry.sample in traceSamples)) continue
    const expected = { direction: 'outgoing', maxDepth: 2, ...entry.body }
    if (canonical(normalized) === canonical(expected)) {
      return { supported: true, status: entry.status, body: structuredClone(traceSamples[entry.sample]) }
    }
  }
  return { supported: false }
}
