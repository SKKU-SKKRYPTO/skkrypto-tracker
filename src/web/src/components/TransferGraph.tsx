import { watchGraphViewport } from './graphViewport'
import cytoscape from 'cytoscape'
import type { Core, StylesheetJson, LayoutOptions } from 'cytoscape'
import { useEffect, useRef } from 'react'
import { buildElements } from './graphElements'
import type { TransferGraphData } from './graphElements'
import { applyTransferHighlights } from './graphHighlights'
import { formatAmount } from '../format'

const NO_PATH_HIGHLIGHTS: ReadonlySet<string> = new Set()
const PATH_LAYOUT_WIDTH = 700

type Props = {
  result: TransferGraphData
  selectedTransferId: string | null
  onSelect?: (transferId: string) => void
  highlightedTransferIds?: ReadonlySet<string>
  evidenceKind?: 'path' | 'pattern'
  controls?: boolean
  selectionLabel?: string | null
  onClearSelection?: () => void
}

// 주소 = 점, 송금 = 화살표. 간선 id는 transfers[].id 그대로라서 표·상세와 같은 키를 쓴다.
// 그래프는 보조 화면이다. 모든 정보는 표와 상세에도 있다.
function TransferGraph({ result, selectedTransferId, onSelect, highlightedTransferIds = NO_PATH_HIGHLIGHTS, evidenceKind = 'path', controls = false, selectionLabel, onClearSelection }: Props) {
  const evidenceLabel = evidenceKind === 'pattern' ? '패턴' : '경로'
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

    const layout: LayoutOptions = result.startLabel === '기준' ? {
      name: 'concentric', concentric: node => node.id() === result.conditions.address.toLowerCase() ? 2 : 1,
      levelWidth: () => 1, minNodeSpacing: 48, avoidOverlap: true, padding: 40,
    } : {
      name: 'breadthfirst', directed: true, roots: [(result.layoutRoot ?? result.conditions.address).toLowerCase()],
      spacingFactor: controls && isPathView ? 1 : 1.35, avoidOverlap: true, padding: 40,
      // Keep path levels horizontal with room for node and amount labels.
      ...(controls && isPathView ? { direction: 'rightward', boundingBox: { x1: 0, y1: 0, w: PATH_LAYOUT_WIDTH, h: 400 } } : {}),
    }
    const cy = cytoscape({
      container,
      elements: buildElements(result),
      style: buildStyle(container, controls),
      layout,
      // 마우스 휠은 페이지 스크롤에 쓰도록 확대는 끈다. 끌어서 옮기기는 된다.
      userZoomingEnabled: false,
      boxSelectionEnabled: false,
      // 선택 상태는 Cytoscape가 아니라 React의 selectedTransferId가 가진다.
      autounselectify: true,
    })
    cyRef.current = cy
    const stopViewport = watchGraphViewport(cy, container)

    cy.on('tap', 'edge', (event) => onSelectRef.current?.(event.target.id()))
    cy.on('mouseover', 'edge', () => {
      container.style.cursor = onSelectRef.current ? 'pointer' : ''
    })
    cy.on('mouseout', 'edge', () => {
      container.style.cursor = ''
    })

    // Cytoscape는 CSS 변수를 못 읽어서, 밝은/어두운 화면이 바뀌면 색을 다시 읽어 넣는다.
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyColors = () => cy.style(buildStyle(container, controls))
    colorScheme.addEventListener('change', applyColors)

    return () => {
      colorScheme.removeEventListener('change', applyColors)
      stopViewport()
      cy.destroy()
      cyRef.current = null
    }
  }, [result, controls, isPathView])

  useEffect(() => {
    const cy = cyRef.current
    if (cy === null) return
    applyTransferHighlights(cy, selectedTransferId, highlightedTransferIds)
  }, [result, selectedTransferId, highlightedTransferIds])

  const zoomBy = (factor: number) => {
    const cy = cyRef.current
    if (cy) cy.zoom({ level: Math.max(0.05, Math.min(4, cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
  }
  const selectedTransfer = controls ? result.transfers.find(transfer => transfer.id === selectedTransferId) : null
  return (
    <figure className={controls ? 'graph trace-graph' : 'graph'} aria-labelledby={controls ? 'trace-graph-title' : undefined}>
      {controls && <div className="panel-heading"><div className="graph-heading"><h3 id="trace-graph-title">{isPathView ? `${evidenceLabel} 근거 송금` : '송금 흐름'}</h3>
        <div className="graph-selection" role="status">
          {selectionLabel !== undefined && <span><span className="visually-hidden">선택한 분석 결과: </span><strong>{selectionLabel ?? `${evidenceLabel} 선택 없음`}</strong>{selectionLabel && <> · 근거 송금 {highlightedTransferIds.size}건</>}</span>}
          <span>{isPathView && <><span className="visually-hidden">선택한 개별 송금: </span>송금 </>}{selectedTransfer ? <>
            {!isPathView && '선택 송금 '}<strong>{formatAmount(selectedTransfer)}</strong>
            {onSelect && <> · <a href="#detail-title" aria-label="선택한 송금 상세로 이동">상세로 이동</a></>}
          </> : isPathView ? '없음' : '선택한 송금 없음'}</span>
        </div>
        </div>
        <div className="graph-controls" role="group" aria-label="그래프 보기 조절">
          {selectionLabel && onClearSelection && <button type="button" className="select-button" aria-label={`${evidenceLabel} 선택 해제`} onClick={onClearSelection}>선택 해제</button>}
          <button type="button" className="select-button" aria-label="그래프 축소" onClick={() => zoomBy(1 / 1.25)}>−</button>
          <button type="button" className="select-button" aria-label="그래프 확대" onClick={() => zoomBy(1.25)}>+</button>
          <button type="button" className="select-button" onClick={() => cyRef.current?.fit(undefined, 32)}>화면 맞춤</button>
        </div>
      </div>}
      <div
        ref={containerRef}
        className="graph-canvas"
        role="img"
        aria-label={isPathView ? `${evidenceLabel} 근거 송금 그래프. ${evidenceLabel}${evidenceKind === 'pattern' ? '은' : '는'} 굵은 점선, 선택한 송금은 굵은 실선으로 구분합니다.` : '송금 흐름 그래프. 같은 정보가 송금 목록 표와 상세에 모두 있습니다.'}
      />
      {controls ? <figcaption className="graph-caption">
        <span className="graph-start-sample">{result.startLabel ?? '시작'}</span> 이중 테두리 = {result.startLabel === '기준' ? '패턴 분석 기준 주소' : '시작 주소'} · 화살표 = 실제 송금 방향 ·
        {isPathView && ` 굵은 점선 = ${evidenceLabel} 근거 ·`} 굵은 실선 = 선택한 송금
        <p>+/−로 확대·축소하고 빈 공간을 드래그해 이동하세요. 화면 맞춤을 누르면 전체 송금이 다시 보입니다.</p>
      </figcaption> : <figcaption className="graph-caption">
        <span className="graph-start-sample">{result.startLabel ?? '시작'}</span> 이중 테두리 = {result.startLabel === '기준' ? '패턴 분석 기준 주소' : '검색한 시작 주소'} ·
        {isPathView && `굵은 점선 = ${evidenceKind === 'pattern' ? '패턴' : '후보 경로'} 근거 · 굵은 실선 = 선택한 송금 · `}
        {onSelect ? '화살표를 누르면 표와 상세에서 같은 송금을 보여 줍니다.' : `${evidenceLabel}의 근거 송금이 표에도 함께 표시됩니다.`}
      </figcaption>}
    </figure>
  )
}

function buildStyle(container: HTMLElement, trace = false): StylesheetJson {
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
        // Numeric dimensions replace deprecated width/height: 'label'. Keep every
        // label (including long names) wrapped inside the node, without truncating.
        width: trace ? 108 : 96,
        height: node => String(node.data('label')).split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil([...line].reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 2 : 1), 0) / 12)), 0) * (trace ? 19 : 17),
        padding: '8px',
        label: 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': trace ? '108px' : '96px',
        'text-overflow-wrap': 'anywhere',
        'line-height': 1.3,
        'text-valign': 'center',
        'text-halign': 'center',
        'font-family': mono,
        'font-size': trace ? 14 : 12,
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
        'control-point-step-size': 64,
        'text-rotation': 'none',
        width: 2,
        'line-color': muted,
        'target-arrow-color': muted,
        'target-arrow-shape': 'triangle',
        label: 'data(label)',
        // 금액 글자를 눌러도 화살표를 누른 것으로 친다. 가는 선만 누르기는 어렵다.
        'text-events': 'yes',
        'font-size': trace ? 14 : 12,
        color: text,
        'text-background-color': bg,
        'text-background-opacity': 1,
        'text-background-padding': '3px',
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
