// mocks/*.draft.json의 응답 구조. 공식 API 샘플이 나오면 다시 맞춘다.

export type Token = {
  address: string
  symbol: string
  decimals: number
}

export type Dataset = {
  id: string
  version: number
  mode: string
  status: string
  chainId: number
  token: Token
  blockRange: { from: number; to: number }
}

export type Transfer = {
  id: string
  from: string
  to: string
  // 최소 단위 금액 문자열. Number로 바꾸지 않는다.
  amount: string
  blockNumber: number
  blockTimestamp: number
  transactionHash: string
  transactionIndex: number
  logIndex: number
}

export type TraceResult = {
  dataset: Dataset
  query: { address: string; direction: string; depth: number }
  nodes: { id: string; address: string }[]
  transfers: Transfer[]
  truncated: boolean
  truncation: {
    reason: string
    foundCount: number
    isLowerBound: boolean
  } | null
}

// 오류 응답은 구조가 다르다. 예: mocks/trace-error.draft.json
export type ApiError = {
  error: {
    code: string
    message: string
    field: string | null
  }
}
