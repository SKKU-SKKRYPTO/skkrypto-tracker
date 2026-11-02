import type { ElementDefinition } from 'cytoscape'
import { formatAmount, shortenHex } from '../format'
import type { Node, Transfer } from '../api/v1Types'

export type TransferGraphData = { nodes: Node[]; transfers: Transfer[]; conditions: { address: string }; layoutRoot?: string }

// 추적 결과를 Cytoscape 그래프 요소로 바꾼다. 주소 = 점, 송금 = 화살표.
// 간선 id는 transfers[].id 그대로라서 표·상세와 같은 키를 쓴다.
export function buildElements(result: TransferGraphData): ElementDefinition[] {
  const startAddress = result.conditions.address.toLowerCase()

  // nodes[]에 빠진 주소가 송금에 있어도 그래프가 깨지지 않도록 송금 양 끝도 모은다.
  const addresses = new Set<string>()
  for (const node of result.nodes) addresses.add(node.id.toLowerCase())
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
        label: `${isStart ? '시작\n' : ''}${result.nodes.find(node => node.id === address)?.label ? `${result.nodes.find(node => node.id === address)?.label}\n` : ''}${shortenHex(address)}`,
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
      label: formatAmount(transfer),
    },
  }))

  return [...nodes, ...edges]
}

