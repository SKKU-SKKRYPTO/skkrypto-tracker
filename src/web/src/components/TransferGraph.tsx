import cytoscape from 'cytoscape'
import type { Core, StylesheetJson } from 'cytoscape'
import { useEffect, useRef } from 'react'
import { buildElements } from './graphElements'
import type { TransferGraphData } from './graphElements'
import { applyTransferHighlights } from './graphHighlights'

const NO_PATH_HIGHLIGHTS: ReadonlySet<string> = new Set()

type Props = {
  result: TransferGraphData
  selectedTransferId: string | null
  onSelect?: (transferId: string) => void
  highlightedTransferIds?: ReadonlySet<string>
}

// 주소 = 점, 송금 = 화살표. 간선 id는 transfers[].id 그대로라서 표·상세와 같은 키를 쓴다.
// 그래프는 보조 화면이다. 모든 정보는 표와 상세에도 있다.
function TransferGraph({ result, selectedTransferId, onSelect, highlightedTransferIds = NO_PATH_HIGHLIGHTS }: Props) {
  const isPathView = highlightedTransferIds !== NO_PATH_HIGHLIGHTS
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  // 그래프는 결과가 바뀔 때만 새로 그린다. 클릭 처리 함수는 ref로 최신 것을 쓴다.
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const cy = cytoscape({
      container,
      elements: buildElements(result),
      style: buildStyle(container),
      layout: {
        name: 'breadthfirst',
        directed: true,
        // Trace retains its existing root. Incoming Path can place the money-flow source
        // at the top without changing the searched-address marker or reversing edges.
        roots: [(result.layoutRoot ?? result.conditions.address).toLowerCase()],
        spacingFactor: 1.1,
        padding: 24,
      },
      // 마우스 휠은 페이지 스크롤에 쓰도록 확대는 끈다. 끌어서 옮기기는 된다.
      userZoomingEnabled: false,
      boxSelectionEnabled: false,
      // 선택 상태는 Cytoscape가 아니라 React의 selectedTransferId가 가진다.
      autounselectify: true,
    })
    cyRef.current = cy

    cy.on('tap', 'edge', (event) => onSelectRef.current?.(event.target.id()))
    cy.on('mouseover', 'edge', () => {
      container.style.cursor = onSelectRef.current ? 'pointer' : ''
    })
    cy.on('mouseout', 'edge', () => {
      container.style.cursor = ''
    })

    // Cytoscape는 CSS 변수를 못 읽어서, 밝은/어두운 화면이 바뀌면 색을 다시 읽어 넣는다.
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyColors = () => cy.style(buildStyle(container))
    colorScheme.addEventListener('change', applyColors)

    return () => {
      colorScheme.removeEventListener('change', applyColors)
      cy.destroy()
      cyRef.current = null
    }
  }, [result])

  useEffect(() => {
    const cy = cyRef.current
    if (cy === null) return
    applyTransferHighlights(cy, selectedTransferId, highlightedTransferIds)
  }, [result, selectedTransferId, highlightedTransferIds])

  return (
    <figure className="graph">
      <div
        ref={containerRef}
        className="graph-canvas"
        role="img"
        aria-label={isPathView ? '경로 근거 송금 그래프. 경로는 굵은 점선, 선택한 송금은 굵은 실선으로 구분합니다.' : '송금 흐름 그래프. 같은 정보가 송금 목록 표와 상세에 모두 있습니다.'}
      />
      <figcaption className="graph-caption">
        <span className="graph-start-sample">시작</span> 이중 테두리 = 검색한 시작 주소 ·
        {isPathView && '굵은 점선 = 후보 경로 근거 · 굵은 실선 = 선택한 송금 · '}
        {onSelect ? '화살표를 누르면 표와 상세에서 같은 송금을 보여 줍니다.' : '경로의 근거 송금이 표에도 함께 표시됩니다.'}
      </figcaption>
    </figure>
  )
}

function buildStyle(container: HTMLElement): StylesheetJson {
  const css = getComputedStyle(container)
  const color = (name: string) => css.getPropertyValue(name).trim()
  const text = color('--text-h')
  const muted = color('--text')
  const bg = color('--bg')
  const border = color('--border')
  const accent = color('--accent')
  const mono = color('--mono')

  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: 'label',
        height: 'label',
        padding: '8px',
        label: 'data(label)',
        'text-wrap': 'wrap',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-family': mono,
        'font-size': 12,
        color: text,
        'background-color': bg,
        'border-width': 1,
        'border-color': muted,
      },
    },
    // 시작 주소: 색이 아니라 이중 테두리·굵은 글자·"시작" 글자로도 구분된다.
    {
      selector: 'node.start',
      style: {
        'border-width': 6,
        'border-style': 'double',
        'border-color': text,
        'font-weight': 'bold',
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        width: 2,
        'line-color': muted,
        'target-arrow-color': muted,
        'target-arrow-shape': 'triangle',
        label: 'data(label)',
        // 금액 글자를 눌러도 화살표를 누른 것으로 친다. 가는 선만 누르기는 어렵다.
        'text-events': 'yes',
        'font-size': 11,
        color: text,
        'text-background-color': bg,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'text-border-width': 1,
        'text-border-color': border,
        'text-border-opacity': 1,
      },
    },
    // Path evidence uses a dashed stroke, distinct from single-transfer selection.
    {
      selector: 'edge.path-highlighted',
      style: {
        width: 5,
        'line-style': 'dashed',
        'line-color': accent,
        'target-arrow-color': accent,
        'font-weight': 'bold',
        'text-border-width': 2,
        'text-border-color': accent,
        'z-index': 9,
      },
    },
    // 선택한 송금: 색 + 굵은 선 + 굵은 글자 + 진한 금액 테두리
    {
      selector: 'edge.selected',
      style: {
        width: 6,
        'line-style': 'solid',
        'line-color': accent,
        'target-arrow-color': accent,
        'font-weight': 'bold',
        'text-border-width': 2,
        'text-border-color': accent,
        'z-index': 10,
      },
    },
  ]
}

export default TransferGraph

