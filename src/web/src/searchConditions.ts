// 검색창 옆에서 고르는 탐색 조건. 이름은 API 규격(direction, maxDepth)에 맞춘다.

export type Direction = 'outgoing' | 'incoming'
export type MaxDepth = 1 | 2 | 3

export type SearchConditions = {
  direction: Direction
  maxDepth: MaxDepth
}

export const DEFAULT_SEARCH_CONDITIONS: SearchConditions = {
  direction: 'outgoing',
  maxDepth: 2,
}

export const DIRECTION_LABELS: Record<Direction, string> = {
  outgoing: '보낸 쪽',
  incoming: '받은 쪽',
}

export const DIRECTIONS: Direction[] = ['outgoing', 'incoming']
export const MAX_DEPTHS: MaxDepth[] = [1, 2, 3]

// 결과 위에 붙는 안내 문구. 예: "보낸 쪽 · 2단계"
export function formatConditions({ direction, maxDepth }: SearchConditions): string {
  return `${DIRECTION_LABELS[direction]} · ${maxDepth}단계`
}
