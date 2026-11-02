import type { SearchConditions } from './searchConditions'
import { matchesV1 } from './api/validateV1'

export type PathConditions = SearchConditions & { address: string; targetAddress: string }
export const DEFAULT_PATH_CONDITIONS: PathConditions = { address: '', targetAddress: '', direction: 'outgoing', maxDepth: 2 }

export function validatePathAddresses(address: string, targetAddress: string): string | null {
  const start = address.trim(), target = targetAddress.trim()
  if (!matchesV1(start, 'Address')) return '시작 주소는 0x로 시작하는 40자리 16진수 주소여야 합니다.'
  if (!matchesV1(target, 'Address')) return '대상 주소는 0x로 시작하는 40자리 16진수 주소여야 합니다.'
  if (start.toLowerCase() === target.toLowerCase()) return '시작 주소와 대상 주소는 서로 달라야 합니다.'
  return null
}
