// 테스트용 문제. 공개 예시 데이터(flow-demo·patterns-demo)만 쓰고 실제 실습 문제·정답은 넣지 않는다.
export const S = '0x0000000000000000000000000000000000000001'
export const A = '0x0000000000000000000000000000000000000002'
export const T = '0x0000000000000000000000000000000000000007'
export const E = '0x0000000000000000000000000000000000000005'
export const HUB = '0x0000000000000000000000000000000000000069'

export const testProblemsFile = {
  version: 3,
  problems: [
    {
      id: 'T1', title: '연습 1 · 경로', level: '기본',
      prompt: ['S에서 나간 돈이 A를 거쳐 E에 도착했습니다.', 'S에서 E까지의 경로를 찾습니다.'],
      datasetId: 'flow-demo', datasetVersion: 'v1', startAddress: S, targetAddress: E, viaAddress: A, maxDepth: 2,
      hints: [], notes: ['정답이 아닌 경로를 내면 감점입니다.'],
    },
    {
      id: 'T2', title: '연습 2 · 힌트', level: '중급',
      prompt: ['여러 주소가 한 주소로 보냈습니다.'],
      datasetId: 'patterns-demo', datasetVersion: 'v1', startAddress: S, targetAddress: HUB, maxDepth: 2,
      hints: [{ title: '첫 힌트', text: '나가는 연결부터 보세요.' }, { title: '둘째 힌트', text: '블록 순서를 비교하세요.' }],
      notes: [],
    },
  ],
}
