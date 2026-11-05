// 가장 최근 요청의 결과만 반영한다. 조건(답안)이 바뀌거나 새 요청을 보내면 그 전 요청의 결과는 버린다.
export function createLatestOnly() {
  let generation = 0
  return {
    start: () => ++generation,
    invalidate: () => { generation++ },
    isCurrent: (ticket: number) => ticket === generation,
  }
}
