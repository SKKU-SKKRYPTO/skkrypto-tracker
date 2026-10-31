import type { ElementDefinition } from 'cytoscape'
import { formatUnits, shortenHex } from '../format'
import type { Token, TraceResult } from '../types'

// 추적 결과를 Cytoscape 그래프 요소로 바꾼다. 주소 = 점, 송금 = 화살표.
// 간선 id는 transfers[].id 그대로라서 표·상세와 같은 키를 쓴다.
export function buildElements(result: TraceResult, token: Token): ElementDefinition[] {
  const startAddress = result.query.address.toLowerCase()

  // nodes[]에 빠진 주소가 송금에 있어도 그래프가 깨지지 않도록 송금 양 끝도 모은다.
  const addresses = new Set<string>()
  for (const node of result.nodes) addresses.add(node.address.toLowerCase())
  for (const transfer of result.transfers) {
    addresses.add(transfer.from.toLowerCase())
    addresses.add(transfer.to.toLowerCase())
  }

  const nodes: ElementDefinition[] = [...addresses].map((address) => {
    const isStart = address === startAddress
    return {
      group: 'nodes',
      data: {
        id: address,
        label: isStart ? `시작\n${shortenHex(address)}` : shortenHex(address),
      },
      classes: isStart ? 'start' : undefined,
    }
  })

  const edges: ElementDefinition[] = result.transfers.map((transfer) => ({
    group: 'edges',
    data: {
      id: transfer.id,
      source: transfer.from.toLowerCase(),
      target: transfer.to.toLowerCase(),
      label: `${formatUnits(transfer.amount, token.decimals)} ${token.symbol}`,
    },
  }))

  return [...nodes, ...edges]
}
