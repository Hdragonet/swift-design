<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  useProjectStore,
  type FlowEdge,
  type FlowNode,
  type FlowNodeType,
} from '@/stores/project'

interface DiagramSnapshot {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface EdgePath {
  sx: number
  sy: number
  bx: number
  by: number
  tx: number
  ty: number
}

const store = useProjectStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapperRef = ref<HTMLDivElement | null>(null)
const miniCanvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null

const selectedTool = ref<'select' | 'connect' | FlowNodeType>('select')
const selectedNodeId = ref('')
const selectedNodeIds = ref<string[]>([])
const selectedEdgeId = ref('')
const connectFromId = ref('')
const draggingNodeId = ref('')
const draggingBendEdgeId = ref('')
const draggingMoved = ref(false)
const draggingGroupIds = ref<string[]>([])
const groupDragStart = ref<Record<string, { x: number; y: number }>>({})
const dragStartPoint = ref({ x: 0, y: 0 })
const panning = ref(false)
const panStart = ref({ x: 0, y: 0 })
const pan = ref({ x: 0, y: 0 })
const scale = ref(1)
const marquee = ref({ active: false, startX: 0, startY: 0, endX: 0, endY: 0, append: false })
const canvasBackground = ref('#ffffff')

const nodes = ref<FlowNode[]>([])
const edges = ref<FlowEdge[]>([])

const history = ref<DiagramSnapshot[]>([])
const historyIndex = ref(-1)
const historyReady = ref(false)
const clipboardData = ref<DiagramSnapshot | null>(null)
const pasteCount = ref(0)

const selectedNode = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value) || null)
const selectedEdge = computed(() => edges.value.find((e) => e.id === selectedEdgeId.value) || null)
const canDelete = computed(() => selectedNodeIds.value.length > 0 || !!selectedEdge.value)
const canAlign = computed(() => selectedNodeIds.value.length >= 2)
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value >= 0 && historyIndex.value < history.value.length - 1)
const zoomText = computed(() => `${Math.round(scale.value * 100)}%`)

watch(
  () => store.activeProject,
  (proj) => {
    if (!proj) return
    nodes.value = proj.flow.nodes
    edges.value = proj.flow.edges
    selectedNodeId.value = ''
    selectedNodeIds.value = []
    selectedEdgeId.value = ''
    connectFromId.value = ''
    nextTick(() => {
      resizeCanvas()
      draw()
      resetHistory()
    })
  },
  { immediate: true }
)

function generateId(prefix = 'flow') {
  return store.generateId(prefix)
}

function cloneDiagram(): DiagramSnapshot {
  return JSON.parse(JSON.stringify({ nodes: nodes.value, edges: edges.value })) as DiagramSnapshot
}

function syncFlowRefs() {
  if (!store.activeProject) return
  store.activeProject.flow.nodes = nodes.value
  store.activeProject.flow.edges = edges.value
}

function replaceDiagram(nextNodes: FlowNode[], nextEdges: FlowEdge[]) {
  nodes.value = nextNodes
  edges.value = nextEdges
  syncFlowRefs()
}

function applySnapshot(snapshot: DiagramSnapshot) {
  if (!store.activeProject) return
  const nextNodes = JSON.parse(JSON.stringify(snapshot.nodes)) as FlowNode[]
  const nextEdges = JSON.parse(JSON.stringify(snapshot.edges)) as FlowEdge[]
  store.activeProject.flow.nodes = nextNodes
  store.activeProject.flow.edges = nextEdges
  nodes.value = store.activeProject.flow.nodes
  edges.value = store.activeProject.flow.edges
  selectedNodeId.value = ''
  selectedNodeIds.value = []
  selectedEdgeId.value = ''
  connectFromId.value = ''
  draw()
}

function setSingleNodeSelection(id: string) {
  selectedNodeId.value = id
  selectedNodeIds.value = [id]
  selectedEdgeId.value = ''
}

function setNodeSelection(ids: string[]) {
  selectedNodeIds.value = ids
  selectedNodeId.value = ids[0] || ''
  selectedEdgeId.value = ''
}

function toggleNodeSelection(id: string) {
  if (selectedNodeIds.value.includes(id)) {
    const next = selectedNodeIds.value.filter((n) => n !== id)
    setNodeSelection(next)
  } else {
    setNodeSelection([...selectedNodeIds.value, id])
  }
}

function ensureEdgeDefaults(edge: FlowEdge) {
  if (!edge.lineStyle) edge.lineStyle = 'solid'
  if (!edge.lineColor) edge.lineColor = '#334155'
  if (!edge.lineWidth) edge.lineWidth = 1.4
  if (!edge.labelColor) edge.labelColor = '#94a3b8'
  if (!edge.labelFontSize) edge.labelFontSize = 12
  if (typeof edge.labelBold !== 'boolean') edge.labelBold = false
}

function resetHistory() {
  history.value = [cloneDiagram()]
  historyIndex.value = 0
  historyReady.value = true
}

function commitHistory() {
  if (!historyReady.value) return
  const snap = cloneDiagram()
  history.value = history.value.slice(0, historyIndex.value + 1)
  history.value.push(snap)
  if (history.value.length > 80) history.value.shift()
  historyIndex.value = history.value.length - 1
}

function undo() {
  if (!canUndo.value) return
  historyIndex.value -= 1
  applySnapshot(history.value[historyIndex.value]!)
}

function redo() {
  if (!canRedo.value) return
  historyIndex.value += 1
  applySnapshot(history.value[historyIndex.value]!)
}

function resizeCanvas() {
  if (!canvasRef.value || !wrapperRef.value) return
  const rect = wrapperRef.value.getBoundingClientRect()
  canvasRef.value.width = Math.max(200, Math.floor(rect.width))
  canvasRef.value.height = Math.max(200, Math.floor(rect.height))
}

function toCanvasPoint(clientX: number, clientY: number) {
  if (!canvasRef.value) return { x: 0, y: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: (clientX - rect.left - pan.value.x) / scale.value,
    y: (clientY - rect.top - pan.value.y) / scale.value,
  }
}

function getDiagramBounds() {
  if (nodes.value.length === 0) {
    return { minX: -400, minY: -300, maxX: 400, maxY: 300 }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  nodes.value.forEach((n) => {
    minX = Math.min(minX, n.x - n.width / 2)
    minY = Math.min(minY, n.y - n.height / 2)
    maxX = Math.max(maxX, n.x + n.width / 2)
    maxY = Math.max(maxY, n.y + n.height / 2)
  })
  const padding = 80
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  }
}

function centerView(fit = false) {
  if (!canvasRef.value) return
  const bounds = getDiagramBounds()
  const W = canvasRef.value.width
  const H = canvasRef.value.height
  const contentW = Math.max(1, bounds.maxX - bounds.minX)
  const contentH = Math.max(1, bounds.maxY - bounds.minY)
  if (fit) {
    const sx = (W * 0.9) / contentW
    const sy = (H * 0.9) / contentH
    scale.value = Math.max(0.5, Math.min(2, Number(Math.min(sx, sy).toFixed(2))))
  }
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  pan.value.x = W / 2 - cx * scale.value
  pan.value.y = H / 2 - cy * scale.value
  draw()
}

function nodeSize(type: FlowNodeType) {
  if (type === 'decision') return { width: 140, height: 90 }
  if (type === 'io') return { width: 150, height: 70 }
  return { width: 140, height: 64 }
}

function defaultText(type: FlowNodeType) {
  const map: Record<FlowNodeType, string> = {
    start: '开始',
    process: '处理步骤',
    decision: '条件判断',
    io: '输入/输出',
    end: '结束',
  }
  return map[type]
}

function createNode(type: FlowNodeType, x: number, y: number) {
  const { width, height } = nodeSize(type)
  const node: FlowNode = { id: generateId('node'), type, text: defaultText(type), x, y, width, height }
  nodes.value.push(node)
  setSingleNodeSelection(node.id)
  draw()
  commitHistory()
}

function getNodeAt(x: number, y: number): FlowNode | null {
  for (let i = nodes.value.length - 1; i >= 0; i -= 1) {
    const node = nodes.value[i]!
    if (containsPoint(node, x, y)) return node
  }
  return null
}

function containsPoint(node: FlowNode, x: number, y: number) {
  const dx = x - node.x
  const dy = y - node.y
  const hw = node.width / 2
  const hh = node.height / 2
  if (node.type === 'start' || node.type === 'end') return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1
  if (node.type === 'decision') return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1
  if (node.type === 'io') {
    const slant = 20
    const points = [
      { x: node.x - hw + slant, y: node.y - hh },
      { x: node.x + hw, y: node.y - hh },
      { x: node.x + hw - slant, y: node.y + hh },
      { x: node.x - hw, y: node.y + hh },
    ]
    return pointInPolygon({ x, y }, points)
  }
  return Math.abs(dx) <= hw && Math.abs(dy) <= hh
}

function pointInPolygon(point: { x: number; y: number }, points: Array<{ x: number; y: number }>) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i]!.x
    const yi = points[i]!.y
    const xj = points[j]!.x
    const yj = points[j]!.y
    const intersect = (yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const A = px - x1
  const B = py - y1
  const C = x2 - x1
  const D = y2 - y1
  const dot = A * C + B * D
  const lenSq = C * C + D * D
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, dot / lenSq))
  const ex = x1 + t * C
  const ey = y1 + t * D
  return Math.hypot(px - ex, py - ey)
}

function raySegmentIntersection(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) {
  const sx = bx - ax
  const sy = by - ay
  const cross = dx * sy - dy * sx
  if (Math.abs(cross) < 1e-7) return null
  const qpx = ax - ox
  const qpy = ay - oy
  const t = (qpx * sy - qpy * sx) / cross
  const u = (qpx * dy - qpy * dx) / cross
  if (t >= 0 && u >= 0 && u <= 1) return { x: ox + dx * t, y: oy + dy * t, t }
  return null
}

function nodeBoundaryPoint(node: FlowNode, towardX: number, towardY: number) {
  const vx = towardX - node.x
  const vy = towardY - node.y
  const len = Math.hypot(vx, vy)
  if (len < 1e-6) return { x: node.x, y: node.y }
  const dx = vx / len
  const dy = vy / len
  const hw = node.width / 2
  const hh = node.height / 2

  if (node.type === 'start' || node.type === 'end') {
    // Ellipse boundary intersection
    const d = (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh)
    const t = d > 0 ? 1 / Math.sqrt(d) : 0
    return { x: node.x + dx * t, y: node.y + dy * t }
  }

  if (node.type === 'decision') {
    // Diamond boundary: |x/hw| + |y/hh| = 1
    const d = Math.abs(dx) / hw + Math.abs(dy) / hh
    const t = d > 0 ? 1 / d : 0
    return { x: node.x + dx * t, y: node.y + dy * t }
  }

  if (node.type === 'io') {
    const slant = 20
    const points = [
      { x: node.x - hw + slant, y: node.y - hh },
      { x: node.x + hw, y: node.y - hh },
      { x: node.x + hw - slant, y: node.y + hh },
      { x: node.x - hw, y: node.y + hh },
    ]
    let best: { x: number; y: number; t: number } | null = null
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      const hit = raySegmentIntersection(node.x, node.y, dx, dy, a.x, a.y, b.x, b.y)
      if (hit && (!best || hit.t < best.t)) best = hit
    }
    if (best) return { x: best.x, y: best.y }
  }

  // Rectangle boundary
  const tx = Math.abs(dx) < 1e-7 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx)
  const ty = Math.abs(dy) < 1e-7 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: node.x + dx * t, y: node.y + dy * t }
}

function pushPointOutward(point: { x: number; y: number }, towardX: number, towardY: number, distance: number) {
  const dx = towardX - point.x
  const dy = towardY - point.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return point
  return {
    x: point.x + (dx / len) * distance,
    y: point.y + (dy / len) * distance,
  }
}

function edgePath(edge: FlowEdge): EdgePath | null {
  const source = nodes.value.find((n) => n.id === edge.sourceId)
  const target = nodes.value.find((n) => n.id === edge.targetId)
  if (!source || !target) return null
  const rawBx = edge.bendX ?? (source.x + target.x) / 2
  const rawBy = edge.bendY ?? (source.y + target.y) / 2
  const preS = nodeBoundaryPoint(source, rawBx, rawBy)
  const preT = nodeBoundaryPoint(target, rawBx, rawBy)
  const bx = edge.bendX ?? (preS.x + preT.x) / 2
  const by = edge.bendY ?? (preS.y + preT.y) / 2
  const s = pushPointOutward(nodeBoundaryPoint(source, bx, by), bx, by, 2)
  const t = pushPointOutward(nodeBoundaryPoint(target, bx, by), bx, by, 2)
  const sx = s.x
  const sy = s.y
  const tx = t.x
  const ty = t.y
  return { sx, sy, bx, by, tx, ty }
}

function getEdgeAt(x: number, y: number): FlowEdge | null {
  const hitDistance = 8 / scale.value
  for (let i = edges.value.length - 1; i >= 0; i -= 1) {
    const edge = edges.value[i]!
    const p = edgePath(edge)
    if (!p) continue
    const d1 = pointToSegmentDistance(x, y, p.sx, p.sy, p.bx, p.by)
    const d2 = pointToSegmentDistance(x, y, p.bx, p.by, p.tx, p.ty)
    if (Math.min(d1, d2) <= hitDistance) return edge
  }
  return null
}

function getBendHandleEdgeAt(x: number, y: number): FlowEdge | null {
  const radius = 10 / scale.value
  for (let i = edges.value.length - 1; i >= 0; i -= 1) {
    const edge = edges.value[i]!
    const p = edgePath(edge)
    if (!p) continue
    if (Math.hypot(x - p.bx, y - p.by) <= radius) return edge
  }
  return null
}

function applySnap(rawX: number, rawY: number, movingId: string) {
  const snapGrid = 20
  let x = Math.round(rawX / snapGrid) * snapGrid
  let y = Math.round(rawY / snapGrid) * snapGrid
  const alignThreshold = 8
  for (const node of nodes.value) {
    if (node.id === movingId) continue
    if (Math.abs(node.x - x) <= alignThreshold) x = node.x
    if (Math.abs(node.y - y) <= alignThreshold) y = node.y
  }
  return { x, y }
}

function marqueeRect() {
  const x1 = Math.min(marquee.value.startX, marquee.value.endX)
  const y1 = Math.min(marquee.value.startY, marquee.value.endY)
  const x2 = Math.max(marquee.value.startX, marquee.value.endX)
  const y2 = Math.max(marquee.value.startY, marquee.value.endY)
  return { x1, y1, x2, y2 }
}

function nodeIntersectsRect(node: FlowNode, rect: { x1: number; y1: number; x2: number; y2: number }) {
  const left = node.x - node.width / 2
  const right = node.x + node.width / 2
  const top = node.y - node.height / 2
  const bottom = node.y + node.height / 2
  return !(right < rect.x1 || left > rect.x2 || bottom < rect.y1 || top > rect.y2)
}

function onMouseDown(e: MouseEvent) {
  const p = toCanvasPoint(e.clientX, e.clientY)
  const bendEdge = getBendHandleEdgeAt(p.x, p.y)
  if (bendEdge && selectedTool.value === 'select') {
    ensureEdgeDefaults(bendEdge)
    draggingBendEdgeId.value = bendEdge.id
    selectedEdgeId.value = bendEdge.id
    selectedNodeId.value = ''
    selectedNodeIds.value = []
    draggingMoved.value = false
    draw()
    return
  }

  const node = getNodeAt(p.x, p.y)
  if (selectedTool.value === 'connect') {
    if (!node) return
    if (!connectFromId.value) {
      connectFromId.value = node.id
      setSingleNodeSelection(node.id)
    } else if (connectFromId.value !== node.id) {
      edges.value.push({
        id: generateId('edge'),
        sourceId: connectFromId.value,
        targetId: node.id,
        label: '',
        labelColor: '#94a3b8',
        labelFontSize: 12,
        labelBold: false,
        lineStyle: 'solid',
        lineColor: '#334155',
        lineWidth: 1.4,
      })
      connectFromId.value = ''
      selectedNodeId.value = ''
      selectedNodeIds.value = []
      selectedEdgeId.value = ''
      commitHistory()
    }
    draw()
    return
  }

  if (selectedTool.value !== 'select') {
    createNode(selectedTool.value, p.x, p.y)
    selectedTool.value = 'select'
    return
  }

  if (node) {
    if (e.shiftKey) {
      toggleNodeSelection(node.id)
      draw()
      return
    }
    if (!selectedNodeIds.value.includes(node.id)) {
      setSingleNodeSelection(node.id)
    } else {
      selectedNodeId.value = node.id
      selectedEdgeId.value = ''
    }
    draggingNodeId.value = node.id
    draggingMoved.value = false
    draggingGroupIds.value = selectedNodeIds.value.includes(node.id) ? [...selectedNodeIds.value] : [node.id]
    groupDragStart.value = {}
    draggingGroupIds.value.forEach((id) => {
      const n = nodes.value.find((it) => it.id === id)
      if (n) groupDragStart.value[id] = { x: n.x, y: n.y }
    })
    dragStartPoint.value = { x: p.x, y: p.y }
    draw()
    return
  }

  const edge = getEdgeAt(p.x, p.y)
  if (edge) {
    ensureEdgeDefaults(edge)
    selectedEdgeId.value = edge.id
    selectedNodeId.value = ''
    selectedNodeIds.value = []
    draw()
    return
  }

  if (e.shiftKey) {
    marquee.value.active = true
    marquee.value.startX = p.x
    marquee.value.startY = p.y
    marquee.value.endX = p.x
    marquee.value.endY = p.y
    marquee.value.append = true
    selectedEdgeId.value = ''
  } else {
    selectedNodeId.value = ''
    selectedNodeIds.value = []
    selectedEdgeId.value = ''
    panning.value = true
    panStart.value = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y }
  }
  draw()
}

function onMouseMove(e: MouseEvent) {
  const p = toCanvasPoint(e.clientX, e.clientY)
  if (draggingBendEdgeId.value) {
    const edge = edges.value.find((it) => it.id === draggingBendEdgeId.value)
    if (edge) {
      edge.bendX = Math.round(p.x / 10) * 10
      edge.bendY = Math.round(p.y / 10) * 10
      draggingMoved.value = true
      draw()
    }
    return
  }
  if (draggingNodeId.value) {
    const leaderId = draggingNodeId.value
    const leaderStart = groupDragStart.value[leaderId]
    if (leaderStart) {
      const rawX = leaderStart.x + (p.x - dragStartPoint.value.x)
      const rawY = leaderStart.y + (p.y - dragStartPoint.value.y)
      const snapped = applySnap(rawX, rawY, leaderId)
      const dx = snapped.x - leaderStart.x
      const dy = snapped.y - leaderStart.y
      draggingGroupIds.value.forEach((id) => {
        const n = nodes.value.find((it) => it.id === id)
        const start = groupDragStart.value[id]
        if (n && start) {
          n.x = Math.round(start.x + dx)
          n.y = Math.round(start.y + dy)
        }
      })
      draggingMoved.value = true
      draw()
    }
    return
  }
  if (marquee.value.active) {
    marquee.value.endX = p.x
    marquee.value.endY = p.y
    draw()
    return
  }
  if (panning.value) {
    pan.value.x = e.clientX - panStart.value.x
    pan.value.y = e.clientY - panStart.value.y
    draw()
  }
}

function onMouseUp() {
  if (marquee.value.active) {
    const rect = marqueeRect()
    const ids = nodes.value.filter((node) => nodeIntersectsRect(node, rect)).map((node) => node.id)
    if (marquee.value.append) {
      const union = new Set([...selectedNodeIds.value, ...ids])
      setNodeSelection(Array.from(union))
    } else {
      setNodeSelection(ids)
    }
    marquee.value.active = false
    draw()
    return
  }
  if ((draggingNodeId.value || draggingBendEdgeId.value) && draggingMoved.value) commitHistory()
  draggingNodeId.value = ''
  draggingGroupIds.value = []
  groupDragStart.value = {}
  draggingBendEdgeId.value = ''
  draggingMoved.value = false
  panning.value = false
}

function onDoubleClick() {
  if (!selectedNode.value) return
  const text = window.prompt('请输入节点文本', selectedNode.value.text)
  if (text === null) return
  const nextText = text.trim()
  if (!nextText || nextText === selectedNode.value.text) return
  selectedNode.value.text = nextText
  draw()
  commitHistory()
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY < 0 ? 0.1 : -0.1
  scale.value = Math.max(0.5, Math.min(2, Number((scale.value + delta).toFixed(2))))
  draw()
}

function miniMapLayout() {
  if (!miniCanvasRef.value) return null
  const bounds = getDiagramBounds()
  const miniW = miniCanvasRef.value.width
  const miniH = miniCanvasRef.value.height
  const worldW = Math.max(1, bounds.maxX - bounds.minX)
  const worldH = Math.max(1, bounds.maxY - bounds.minY)
  const s = Math.min((miniW - 12) / worldW, (miniH - 12) / worldH)
  const drawW = worldW * s
  const drawH = worldH * s
  const offsetX = (miniW - drawW) / 2
  const offsetY = (miniH - drawH) / 2
  return { bounds, s, offsetX, offsetY, miniW, miniH }
}

function drawMiniMap() {
  if (!miniCanvasRef.value) return
  const c = miniCanvasRef.value
  const mctx = c.getContext('2d')
  if (!mctx) return
  const layout = miniMapLayout()
  if (!layout) return

  mctx.clearRect(0, 0, c.width, c.height)
  mctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  mctx.fillRect(0, 0, c.width, c.height)

  mctx.strokeStyle = 'rgba(148, 163, 184, 0.35)'
  mctx.strokeRect(layout.offsetX, layout.offsetY, (layout.bounds.maxX - layout.bounds.minX) * layout.s, (layout.bounds.maxY - layout.bounds.minY) * layout.s)

  nodes.value.forEach((n) => {
    const x = layout.offsetX + (n.x - n.width / 2 - layout.bounds.minX) * layout.s
    const y = layout.offsetY + (n.y - n.height / 2 - layout.bounds.minY) * layout.s
    const w = Math.max(2, n.width * layout.s)
    const h = Math.max(2, n.height * layout.s)
    mctx.fillStyle = selectedNodeIds.value.includes(n.id) ? '#a78bfa' : '#60a5fa'
    mctx.fillRect(x, y, w, h)
  })

  if (canvasRef.value) {
    const vx = -pan.value.x / scale.value
    const vy = -pan.value.y / scale.value
    const vw = canvasRef.value.width / scale.value
    const vh = canvasRef.value.height / scale.value
    const rx = layout.offsetX + (vx - layout.bounds.minX) * layout.s
    const ry = layout.offsetY + (vy - layout.bounds.minY) * layout.s
    const rw = vw * layout.s
    const rh = vh * layout.s
    mctx.strokeStyle = '#f8fafc'
    mctx.lineWidth = 1.2
    mctx.strokeRect(rx, ry, rw, rh)
    mctx.fillStyle = 'rgba(248, 250, 252, 0.08)'
    mctx.fillRect(rx, ry, rw, rh)
  }
}

function onMiniMapClick(e: MouseEvent) {
  if (!canvasRef.value || !miniCanvasRef.value) return
  const layout = miniMapLayout()
  if (!layout) return
  const rect = miniCanvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const worldX = layout.bounds.minX + (mx - layout.offsetX) / layout.s
  const worldY = layout.bounds.minY + (my - layout.offsetY) / layout.s
  pan.value.x = canvasRef.value.width / 2 - worldX * scale.value
  pan.value.y = canvasRef.value.height / 2 - worldY * scale.value
  draw()
}

function clearFlow() {
  if (!window.confirm('确定清空当前流程图吗？')) return
  nodes.value.splice(0)
  edges.value.splice(0)
  selectedNodeId.value = ''
  selectedNodeIds.value = []
  selectedEdgeId.value = ''
  connectFromId.value = ''
  draw()
  commitHistory()
}

function deleteSelected() {
  if (selectedNodeIds.value.length > 0) {
    const ids = new Set(selectedNodeIds.value)
    for (let i = nodes.value.length - 1; i >= 0; i -= 1) {
      if (ids.has(nodes.value[i]!.id)) nodes.value.splice(i, 1)
    }
    for (let i = edges.value.length - 1; i >= 0; i -= 1) {
      const edge = edges.value[i]!
      if (ids.has(edge.sourceId) || ids.has(edge.targetId)) edges.value.splice(i, 1)
    }
    selectedNodeId.value = ''
    selectedNodeIds.value = []
    draw()
    commitHistory()
    return
  }
  if (selectedEdge.value) {
    const idx = edges.value.findIndex((e) => e.id === selectedEdge.value!.id)
    if (idx >= 0) edges.value.splice(idx, 1)
    selectedEdgeId.value = ''
    draw()
    commitHistory()
  }
}

function copySelected() {
  const ids = selectedNodeIds.value.length > 0
    ? [...selectedNodeIds.value]
    : (selectedNode.value ? [selectedNode.value.id] : [])
  if (ids.length === 0) return
  const idSet = new Set(ids)
  const clipNodes = nodes.value
    .filter((n) => idSet.has(n.id))
    .map((n) => ({ ...n }))
  const clipEdges = edges.value
    .filter((e) => idSet.has(e.sourceId) && idSet.has(e.targetId))
    .map((e) => ({ ...e }))
  clipboardData.value = { nodes: clipNodes, edges: clipEdges }
  pasteCount.value = 0
}

function pasteClipboard() {
  if (!clipboardData.value || clipboardData.value.nodes.length === 0) return
  pasteCount.value += 1
  const offset = 28 * pasteCount.value
  const idMap = new Map<string, string>()
  const nextNodes: FlowNode[] = clipboardData.value.nodes.map((n) => {
    const nextId = generateId('node')
    idMap.set(n.id, nextId)
    return {
      ...n,
      id: nextId,
      x: n.x + offset,
      y: n.y + offset,
    }
  })
  const nextEdges: FlowEdge[] = []
  for (const e of clipboardData.value.edges) {
    const sourceId = idMap.get(e.sourceId)
    const targetId = idMap.get(e.targetId)
    if (!sourceId || !targetId) continue
    nextEdges.push({
      ...e,
      id: generateId('edge'),
      sourceId,
      targetId,
      labelColor: e.labelColor || '#94a3b8',
      labelFontSize: e.labelFontSize || 12,
      labelBold: typeof e.labelBold === 'boolean' ? e.labelBold : false,
      lineStyle: e.lineStyle || 'solid',
      lineColor: e.lineColor || '#334155',
      lineWidth: e.lineWidth || 1.4,
      bendX: typeof e.bendX === 'number' ? e.bendX + offset : undefined,
      bendY: typeof e.bendY === 'number' ? e.bendY + offset : undefined,
    })
  }

  nodes.value.push(...nextNodes)
  edges.value.push(...nextEdges)
  setNodeSelection(nextNodes.map((n) => n.id))
  selectedEdgeId.value = ''
  connectFromId.value = ''
  draw()
  commitHistory()
}

function updateNodeText() {
  draw()
  commitHistory()
}

function updateEdgeLabel() {
  draw()
  commitHistory()
}

function resetSelectedEdgeBend() {
  if (!selectedEdge.value) return
  selectedEdge.value.bendX = undefined
  selectedEdge.value.bendY = undefined
  draw()
  commitHistory()
}

function updateEdgeStyle() {
  draw()
  commitHistory()
}

function exportPng() {
  if (!canvasRef.value) return
  const url = canvasRef.value.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `flow_${new Date().toISOString().slice(0, 10)}.png`
  a.click()
}

function exportPngWhite() {
  if (!canvasRef.value) return
  const temp = document.createElement('canvas')
  temp.width = canvasRef.value.width
  temp.height = canvasRef.value.height
  const tctx = temp.getContext('2d')
  if (!tctx) return
  tctx.fillStyle = '#ffffff'
  tctx.fillRect(0, 0, temp.width, temp.height)
  tctx.drawImage(canvasRef.value, 0, 0)
  const url = temp.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `flow_white_${new Date().toISOString().slice(0, 10)}.png`
  a.click()
}

function exportJson() {
  const data = JSON.stringify({ nodes: nodes.value, edges: edges.value }, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flow_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importJson() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (ev: Event) => {
    const file = (ev.target as HTMLInputElement).files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const parsed = JSON.parse(text) as { nodes?: FlowNode[]; edges?: FlowEdge[] }
      replaceDiagram(
        Array.isArray(parsed.nodes) ? parsed.nodes : [],
        Array.isArray(parsed.edges) ? parsed.edges : []
      )
      selectedNodeId.value = ''
      selectedNodeIds.value = []
      selectedEdgeId.value = ''
      connectFromId.value = ''
      draw()
      commitHistory()
    } catch {
      window.alert('JSON 文件格式无效')
    }
  }
  input.click()
}

function loadTemplate(name: 'login' | 'approval' | 'leave' | 'thesis') {
  if (nodes.value.length > 0 && !window.confirm('将覆盖当前流程图，是否继续？')) return
  const n = (id: string, type: FlowNodeType, text: string, x: number, y: number): FlowNode => ({
    id, type, text, x, y, ...nodeSize(type),
  })
  if (name === 'login') {
    replaceDiagram([
      n('tmpl_start', 'start', '开始', 180, 130),
      n('tmpl_input', 'io', '输入账号密码', 180, 230),
      n('tmpl_validate', 'decision', '校验是否通过?', 180, 340),
      n('tmpl_error', 'process', '提示错误并返回', 390, 340),
      n('tmpl_success', 'process', '创建会话/写入登录态', 180, 470),
      n('tmpl_end', 'end', '进入系统首页', 180, 580),
    ], [
      { id: 'te_1', sourceId: 'tmpl_start', targetId: 'tmpl_input', label: '' },
      { id: 'te_2', sourceId: 'tmpl_input', targetId: 'tmpl_validate', label: '' },
      { id: 'te_3', sourceId: 'tmpl_validate', targetId: 'tmpl_error', label: '否' },
      { id: 'te_4', sourceId: 'tmpl_validate', targetId: 'tmpl_success', label: '是' },
      { id: 'te_5', sourceId: 'tmpl_success', targetId: 'tmpl_end', label: '' },
    ])
  } else if (name === 'approval') {
    replaceDiagram([
      n('a_start', 'start', '发起申请', 170, 120),
      n('a_leader', 'decision', '组长审批?', 170, 230),
      n('a_reject', 'process', '驳回并通知申请人', 380, 230),
      n('a_mgr', 'decision', '经理审批?', 170, 360),
      n('a_archive', 'process', '归档并执行', 170, 480),
      n('a_end', 'end', '结束', 170, 580),
    ], [
      { id: 'ae1', sourceId: 'a_start', targetId: 'a_leader' },
      { id: 'ae2', sourceId: 'a_leader', targetId: 'a_reject', label: '否' },
      { id: 'ae3', sourceId: 'a_leader', targetId: 'a_mgr', label: '是' },
      { id: 'ae4', sourceId: 'a_mgr', targetId: 'a_reject', label: '否' },
      { id: 'ae5', sourceId: 'a_mgr', targetId: 'a_archive', label: '是' },
      { id: 'ae6', sourceId: 'a_archive', targetId: 'a_end' },
    ])
  } else if (name === 'leave') {
    replaceDiagram([
      n('l_start', 'start', '提交请假申请', 170, 120),
      n('l_check', 'decision', '天数 > 3 天?', 170, 230),
      n('l_teacher', 'process', '导师审批', 170, 350),
      n('l_college', 'process', '学院审批', 390, 230),
      n('l_record', 'process', '登记请假信息', 170, 480),
      n('l_end', 'end', '通知结果', 170, 580),
    ], [
      { id: 'le1', sourceId: 'l_start', targetId: 'l_check' },
      { id: 'le2', sourceId: 'l_check', targetId: 'l_teacher', label: '否' },
      { id: 'le3', sourceId: 'l_check', targetId: 'l_college', label: '是' },
      { id: 'le4', sourceId: 'l_teacher', targetId: 'l_record' },
      { id: 'le5', sourceId: 'l_college', targetId: 'l_record' },
      { id: 'le6', sourceId: 'l_record', targetId: 'l_end' },
    ])
  } else {
    replaceDiagram([
      n('t_start', 'start', '选题开始', 190, 120),
      n('t_pick', 'process', '学生提交选题', 190, 220),
      n('t_review', 'decision', '导师审核通过?', 190, 330),
      n('t_back', 'process', '退回修改', 390, 330),
      n('t_open', 'process', '开题报告', 190, 460),
      n('t_mid', 'process', '中期检查', 190, 560),
      n('t_end', 'end', '论文答辩', 190, 660),
    ], [
      { id: 'te1', sourceId: 't_start', targetId: 't_pick' },
      { id: 'te2', sourceId: 't_pick', targetId: 't_review' },
      { id: 'te3', sourceId: 't_review', targetId: 't_back', label: '否' },
      { id: 'te4', sourceId: 't_review', targetId: 't_open', label: '是' },
      { id: 'te5', sourceId: 't_open', targetId: 't_mid' },
      { id: 'te6', sourceId: 't_mid', targetId: 't_end' },
    ])
  }
  selectedNodeId.value = ''
  selectedNodeIds.value = []
  selectedEdgeId.value = ''
  connectFromId.value = ''
  pan.value = { x: 0, y: 0 }
  scale.value = 1
  draw()
  commitHistory()
}

function autoLayout(direction: 'vertical' | 'horizontal') {
  if (nodes.value.length === 0) return
  const incomingCount = new Map<string, number>()
  const adj = new Map<string, string[]>()
  nodes.value.forEach((n) => {
    incomingCount.set(n.id, 0)
    adj.set(n.id, [])
  })
  edges.value.forEach((e) => {
    incomingCount.set(e.targetId, (incomingCount.get(e.targetId) || 0) + 1)
    adj.get(e.sourceId)?.push(e.targetId)
  })
  const queue: string[] = []
  nodes.value.forEach((n) => {
    if ((incomingCount.get(n.id) || 0) === 0) queue.push(n.id)
  })
  if (queue.length === 0) queue.push(nodes.value[0]!.id)
  const depth = new Map<string, number>()
  queue.forEach((id) => depth.set(id, 0))
  let qIndex = 0
  while (qIndex < queue.length) {
    const id = queue[qIndex]!
    qIndex += 1
    const d = depth.get(id) || 0
    const children = adj.get(id) || []
    for (const child of children) {
      const next = Math.max(depth.get(child) || 0, d + 1)
      depth.set(child, next)
      incomingCount.set(child, (incomingCount.get(child) || 0) - 1)
      if ((incomingCount.get(child) || 0) <= 0) queue.push(child)
    }
  }
  nodes.value.forEach((n) => {
    if (!depth.has(n.id)) depth.set(n.id, 0)
  })
  const groups = new Map<number, FlowNode[]>()
  nodes.value.forEach((n) => {
    const d = depth.get(n.id) || 0
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(n)
  })
  const layers = Array.from(groups.keys()).sort((a, b) => a - b)
  const layerGap = 170
  const itemGap = 140
  const originX = 180
  const originY = 120
  layers.forEach((layer) => {
    const items = groups.get(layer)!
    items.forEach((node, i) => {
      if (direction === 'vertical') {
        node.x = originX + i * itemGap
        node.y = originY + layer * layerGap
      } else {
        node.x = originX + layer * layerGap
        node.y = originY + i * itemGap
      }
    })
  })
  edges.value.forEach((e) => {
    e.bendX = undefined
    e.bendY = undefined
  })
  draw()
  commitHistory()
}

function alignSelected(mode: 'left' | 'hcenter' | 'top' | 'vcenter' | 'hspace' | 'vspace') {
  if (selectedNodeIds.value.length < 2) return
  const selected = nodes.value.filter((n) => selectedNodeIds.value.includes(n.id))
  if (selected.length < 2) return

  if (mode === 'left') {
    const minX = Math.min(...selected.map((n) => n.x))
    selected.forEach((n) => { n.x = minX })
  } else if (mode === 'hcenter') {
    const minX = Math.min(...selected.map((n) => n.x))
    const maxX = Math.max(...selected.map((n) => n.x))
    const cx = (minX + maxX) / 2
    selected.forEach((n) => { n.x = cx })
  } else if (mode === 'top') {
    const minY = Math.min(...selected.map((n) => n.y))
    selected.forEach((n) => { n.y = minY })
  } else if (mode === 'vcenter') {
    const minY = Math.min(...selected.map((n) => n.y))
    const maxY = Math.max(...selected.map((n) => n.y))
    const cy = (minY + maxY) / 2
    selected.forEach((n) => { n.y = cy })
  } else if (mode === 'hspace') {
    if (selected.length < 3) return
    const arr = [...selected].sort((a, b) => a.x - b.x)
    const start = arr[0]!.x
    const end = arr[arr.length - 1]!.x
    const gap = (end - start) / (arr.length - 1)
    arr.forEach((n, i) => { n.x = start + gap * i })
  } else if (mode === 'vspace') {
    if (selected.length < 3) return
    const arr = [...selected].sort((a, b) => a.y - b.y)
    const start = arr[0]!.y
    const end = arr[arr.length - 1]!.y
    const gap = (end - start) / (arr.length - 1)
    arr.forEach((n, i) => { n.y = start + gap * i })
  }

  draw()
  commitHistory()
}

function drawNode(node: FlowNode) {
  if (!ctx) return
  const selected = selectedNodeIds.value.includes(node.id)
  const pendingConnect = node.id === connectFromId.value
  const stroke = pendingConnect ? '#f59e0b' : selected ? '#a78bfa' : '#334155'
  const fill = selected ? 'rgba(99,102,241,0.16)' : '#ffffff'
  const { x, y, width: w, height: h } = node
  const hw = w / 2
  const hh = h / 2

  ctx.save()
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = selected ? 2.2 : 1.6
  if (node.type === 'start' || node.type === 'end') {
    ctx.beginPath()
    ctx.ellipse(x, y, hw, hh, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else if (node.type === 'decision') {
    ctx.beginPath()
    ctx.moveTo(x, y - hh)
    ctx.lineTo(x + hw, y)
    ctx.lineTo(x, y + hh)
    ctx.lineTo(x - hw, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (node.type === 'io') {
    const slant = 20
    ctx.beginPath()
    ctx.moveTo(x - hw + slant, y - hh)
    ctx.lineTo(x + hw, y - hh)
    ctx.lineTo(x + hw - slant, y + hh)
    ctx.lineTo(x - hw, y + hh)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.rect(x - hw, y - hh, w, h)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = '#0f172a'
  ctx.font = '13px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(node.text, x, y, w - 16)
  ctx.restore()
}

function drawArrow(x1: number, y1: number, x2: number, y2: number, color: string) {
  if (!ctx) return
  const head = 10
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

function draw() {
  if (!ctx || !canvasRef.value) return
  const W = canvasRef.value.width
  const H = canvasRef.value.height
  ctx.clearRect(0, 0, W, H)
  ctx.save()
  ctx.translate(pan.value.x, pan.value.y)
  ctx.scale(scale.value, scale.value)

  ctx.save()
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)'
  ctx.lineWidth = 1
  const step = 40
  const vx = -pan.value.x / scale.value
  const vy = -pan.value.y / scale.value
  const vw = W / scale.value
  const vh = H / scale.value
  for (let x = Math.floor(vx / step) * step; x < vx + vw + step; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, vy)
    ctx.lineTo(x, vy + vh)
    ctx.stroke()
  }
  for (let y = Math.floor(vy / step) * step; y < vy + vh + step; y += step) {
    ctx.beginPath()
    ctx.moveTo(vx, y)
    ctx.lineTo(vx + vw, y)
    ctx.stroke()
  }
  ctx.restore()

  edges.value.forEach((edge) => {
    const p = edgePath(edge)
    if (!p || !ctx) return
    const selected = edge.id === selectedEdgeId.value
    const baseColor = edge.lineColor || '#334155'
    const strokeColor = selected ? '#a78bfa' : baseColor
    const baseWidth = edge.lineWidth || 1.4
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = selected ? Math.max(2.1, baseWidth) : baseWidth
    if (edge.lineStyle === 'dashed') ctx.setLineDash([8, 5])
    else ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(p.sx, p.sy)
    ctx.lineTo(p.bx, p.by)
    ctx.lineTo(p.tx, p.ty)
    ctx.stroke()
    ctx.setLineDash([])
    if (edge.label) {
      const fontSize = Math.max(10, Math.min(36, edge.labelFontSize || 12))
      const fontWeight = edge.labelBold ? '700' : '400'
      ctx.fillStyle = edge.labelColor || '#94a3b8'
      ctx.font = `${fontWeight} ${fontSize}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(edge.label, p.bx, p.by - 8)
    }
    if (selected) {
      ctx.fillStyle = '#f59e0b'
      ctx.beginPath()
      ctx.arc(p.bx, p.by, 5, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  nodes.value.forEach(drawNode)

  // Draw arrowheads after nodes so they are never covered by node fills.
  edges.value.forEach((edge) => {
    const p = edgePath(edge)
    if (!p || !ctx) return
    const selected = edge.id === selectedEdgeId.value
    const baseColor = edge.lineColor || '#334155'
    const strokeColor = selected ? '#a78bfa' : baseColor
    drawArrow(p.bx, p.by, p.tx, p.ty, strokeColor)
  })

  if (marquee.value.active && ctx) {
    const rect = marqueeRect()
    ctx.save()
    ctx.strokeStyle = '#60a5fa'
    ctx.fillStyle = 'rgba(96, 165, 250, 0.12)'
    ctx.lineWidth = 1 / scale.value
    ctx.setLineDash([6 / scale.value, 4 / scale.value])
    ctx.beginPath()
    ctx.rect(rect.x1, rect.y1, rect.x2 - rect.x1, rect.y2 - rect.y1)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
  drawMiniMap()
}

function onKeyDown(e: KeyboardEvent) {
  const cmd = e.ctrlKey || e.metaKey
  if (cmd && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
    return
  }
  if (cmd && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
    return
  }
  if (cmd && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    setNodeSelection(nodes.value.map((n) => n.id))
    draw()
    return
  }
  if (cmd && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    copySelected()
    return
  }
  if (cmd && e.key.toLowerCase() === 'v') {
    e.preventDefault()
    pasteClipboard()
    return
  }
  if (e.key === 'Delete') {
    e.preventDefault()
    deleteSelected()
  }
}

function setCanvasBackground(mode: 'default' | 'white' | 'light' | 'dark') {
  if (mode === 'white') {
    canvasBackground.value = '#ffffff'
  } else if (mode === 'light') {
    canvasBackground.value = '#f8fafc'
  } else if (mode === 'dark') {
    canvasBackground.value = '#0f172a'
  } else {
    canvasBackground.value = '#ffffff'
  }
}

onMounted(() => {
  if (!canvasRef.value) return
  ctx = canvasRef.value.getContext('2d')
  resizeCanvas()
  draw()
  window.addEventListener('resize', resizeCanvas)
  window.addEventListener('resize', draw)
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  window.removeEventListener('resize', draw)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="flow-editor">
    <aside class="toolbar">
      <div class="toolbar-group">
        <button class="btn btn-secondary" :class="{ active: selectedTool === 'select' }" @click="selectedTool = 'select'">选择</button>
        <button class="btn btn-secondary" :class="{ active: selectedTool === 'connect' }" @click="selectedTool = 'connect'">连线</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-secondary" :class="{ active: selectedTool === 'start' }" @click="selectedTool = 'start'">开始</button>
        <button class="btn btn-secondary" :class="{ active: selectedTool === 'process' }" @click="selectedTool = 'process'">处理</button>
        <button class="btn btn-secondary" :class="{ active: selectedTool === 'decision' }" @click="selectedTool = 'decision'">判断</button>
        <button class="btn btn-secondary" :class="{ active: selectedTool === 'io' }" @click="selectedTool = 'io'">输入输出</button>
        <button class="btn btn-secondary" :class="{ active: selectedTool === 'end' }" @click="selectedTool = 'end'">结束</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-ghost" :disabled="!canUndo" @click="undo">撤销</button>
        <button class="btn btn-ghost" :disabled="!canRedo" @click="redo">重做</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-ghost" :disabled="!canAlign" @click="alignSelected('left')">左对齐</button>
        <button class="btn btn-ghost" :disabled="!canAlign" @click="alignSelected('hcenter')">水平居中</button>
        <button class="btn btn-ghost" :disabled="!canAlign" @click="alignSelected('top')">顶对齐</button>
        <button class="btn btn-ghost" :disabled="!canAlign" @click="alignSelected('vcenter')">垂直居中</button>
        <button class="btn btn-ghost" :disabled="selectedNodeIds.length < 3" @click="alignSelected('hspace')">水平等距</button>
        <button class="btn btn-ghost" :disabled="selectedNodeIds.length < 3" @click="alignSelected('vspace')">垂直等距</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-ghost" @click="autoLayout('vertical')">自动布局(纵向)</button>
        <button class="btn btn-ghost" @click="autoLayout('horizontal')">自动布局(横向)</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-ghost" @click="loadTemplate('login')">模板-登录</button>
        <button class="btn btn-ghost" @click="loadTemplate('approval')">模板-审批</button>
        <button class="btn btn-ghost" @click="loadTemplate('leave')">模板-请假</button>
        <button class="btn btn-ghost" @click="loadTemplate('thesis')">模板-毕业设计</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-ghost" :disabled="!canDelete" @click="deleteSelected">删除选中</button>
        <button class="btn btn-ghost" @click="clearFlow">清空</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-ghost" @click="exportPng">导出 PNG</button>
        <button class="btn btn-ghost" @click="exportPngWhite">导出白底 PNG</button>
        <button class="btn btn-ghost" @click="exportJson">导出 JSON</button>
        <button class="btn btn-ghost" @click="importJson">导入 JSON</button>
      </div>
      <div class="toolbar-group">
        <button class="btn btn-ghost" @click="setCanvasBackground('default')">背景-默认</button>
        <button class="btn btn-ghost" @click="setCanvasBackground('white')">背景-白色</button>
        <button class="btn btn-ghost" @click="setCanvasBackground('light')">背景-浅灰</button>
        <button class="btn btn-ghost" @click="setCanvasBackground('dark')">背景-深色</button>
      </div>
      <div class="toolbar-tip">
        Shift+点击/框选可多选；Ctrl/Cmd+C/V 可复制粘贴；选中连线后可拖拽橙色拐点调整折线。
      </div>
    </aside>

    <section class="canvas-area" ref="wrapperRef" :style="{ background: canvasBackground }">
      <canvas
        ref="canvasRef"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @dblclick="onDoubleClick"
        @wheel="onWheel"
        @contextmenu.prevent
      />
      <div class="canvas-float-tools">
        <span class="zoom-text">缩放 {{ zoomText }}</span>
        <button class="btn btn-secondary btn-sm" @click="centerView(false)">居中</button>
        <button class="btn btn-secondary btn-sm" @click="centerView(true)">适配</button>
      </div>
      <div class="minimap-card">
        <canvas
          ref="miniCanvasRef"
          class="minimap-canvas"
          width="190"
          height="130"
          @click="onMiniMapClick"
        />
      </div>
    </section>

    <aside class="inspector">
      <h3>属性面板</h3>
      <div v-if="selectedNode" class="inspector-content">
        <label class="form-label">节点文本</label>
        <input class="form-input" v-model="selectedNode.text" @change="updateNodeText" />
        <div class="meta">类型：{{ selectedNode.type }}</div>
        <div class="meta">坐标：{{ Math.round(selectedNode.x) }}, {{ Math.round(selectedNode.y) }}</div>
      </div>
      <div v-else-if="selectedEdge" class="inspector-content">
        <label class="form-label">连线标签</label>
        <input class="form-input" v-model="selectedEdge.label" @change="updateEdgeLabel" placeholder="例如：是 / 否" />
        <label class="form-label">标签颜色</label>
        <input class="form-input" type="color" v-model="selectedEdge.labelColor" @change="updateEdgeStyle" />
        <label class="form-label">标签字号</label>
        <input class="form-input" type="number" min="10" max="36" step="1" v-model.number="selectedEdge.labelFontSize" @change="updateEdgeStyle" />
        <label class="form-label" style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" v-model="selectedEdge.labelBold" @change="updateEdgeStyle" />
          标签加粗
        </label>
        <label class="form-label">线型</label>
        <select class="form-select" v-model="selectedEdge.lineStyle" @change="updateEdgeStyle">
          <option value="solid">实线</option>
          <option value="dashed">虚线</option>
        </select>
        <label class="form-label">颜色</label>
        <input class="form-input" type="color" v-model="selectedEdge.lineColor" @change="updateEdgeStyle" />
        <label class="form-label">粗细</label>
        <input class="form-input" type="number" min="1" max="6" step="0.2" v-model.number="selectedEdge.lineWidth" @change="updateEdgeStyle" />
        <button class="btn btn-secondary" @click="resetSelectedEdgeBend">重置拐点</button>
        <div class="meta">起点：{{ selectedEdge.sourceId }}</div>
        <div class="meta">终点：{{ selectedEdge.targetId }}</div>
      </div>
      <div v-else class="inspector-empty">请选择节点或连线</div>
    </aside>
  </div>
</template>

<style scoped>
.flow-editor {
  height: 100%;
  display: grid;
  grid-template-columns: 300px 1fr 220px;
  gap: 10px;
  padding: 10px;
  background: var(--bg-primary);
}

.toolbar,
.inspector {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  backdrop-filter: blur(14px);
  padding: 12px;
  overflow: auto;
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.toolbar-tip {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.btn.active {
  border-color: var(--border-hover);
  background: rgba(99, 102, 241, 0.18);
  color: var(--text-primary);
}

.canvas-area {
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(99, 102, 241, 0.05), rgba(17, 24, 39, 0.25));
  overflow: hidden;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
}

.canvas-float-tools {
  position: absolute;
  right: 12px;
  top: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(8px);
}

.zoom-text {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 68px;
}

.minimap-card {
  position: absolute;
  right: 12px;
  bottom: 12px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
}

.minimap-canvas {
  width: 190px;
  height: 130px;
  display: block;
  cursor: pointer;
}

.inspector h3 {
  font-size: 14px;
  margin-bottom: 12px;
}

.inspector-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.inspector-empty {
  color: var(--text-secondary);
  font-size: 13px;
}

.meta {
  font-size: 12px;
  color: var(--text-secondary);
}

@media (max-width: 1200px) {
  .flow-editor {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
  }

  .canvas-area {
    min-height: 420px;
  }
}
</style>


