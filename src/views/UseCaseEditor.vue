<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useProjectStore, type UCNode, type UCRelation, type UCRelationType, type UCNodeType } from '../stores/project'

const store = useProjectStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null

// State
const selectedTool = ref<'select' | 'actor' | 'usecase' | 'boundary' | 'connect'>('select')
const selectedNode = ref<UCNode | null>(null)
const selectedRelation = ref<UCRelation | null>(null)
const connectFrom = ref<UCNode | null>(null)
const connectType = ref<UCRelationType>('association')
const dragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const showEditModal = ref(false)
const editLabel = ref('')
const showRelationModal = ref(false)

// Canvas state
const pan = ref({ x: 0, y: 0 })
const scale = ref(1)
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })
const selectAll = ref(false)
const dragAllOffset = ref({ x: 0, y: 0 })
const dragAllStart = ref<{ x: number; y: number }[]>([])

const nodes = ref<UCNode[]>([])
const relations = ref<UCRelation[]>([])

// Sync with store
watch(() => store.activeProject, (proj) => {
  if (proj) {
    nodes.value = proj.usecase.nodes
    relations.value = proj.usecase.relations
    draw()
  }
}, { immediate: true })

function generateId() { return store.generateId('uc') }

function draw() {
  if (!canvasRef.value || !ctx) return
  const canvas = canvasRef.value
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.save()
  ctx.translate(pan.value.x, pan.value.y)
  ctx.scale(scale.value, scale.value)

  // Draw grid
  drawGrid(W, H)

  // Draw boundaries first (they're behind everything)
  for (const node of nodes.value) {
    if (node.type === 'boundary') drawBoundary(node)
  }

  // Draw relations
  for (const rel of relations.value) {
    drawRelation(rel)
  }

  // Draw nodes
  for (const node of nodes.value) {
    if (node.type === 'actor') drawActor(node)
    else if (node.type === 'usecase') drawUseCase(node)
  }

  ctx.restore()
}

function drawGrid(W: number, H: number) {
  if (!ctx) return
  ctx.save()
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.04)'
  ctx.lineWidth = 1 / scale.value
  const step = 40
  const vW = W / scale.value
  const vH = H / scale.value
  const ox = (pan.value.x / scale.value) % step
  const oy = (pan.value.y / scale.value) % step
  const startX = -pan.value.x / scale.value
  const startY = -pan.value.y / scale.value
  for (let x = startX - ox; x < startX + vW; x += step) {
    ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, startY + vH); ctx.stroke()
  }
  for (let y = startY - oy; y < startY + vH; y += step) {
    ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(startX + vW, y); ctx.stroke()
  }
  ctx.restore()
}

function drawActor(node: UCNode) {
  if (!ctx) return
  const { x, y, label } = node
  const isSelected = selectedNode.value?.id === node.id
  const isConnectTarget = connectFrom.value?.id === node.id
  const nodeColor = node.color || '#1e293b'

  ctx.save()
  ctx.strokeStyle = isSelected ? '#a78bfa' : isConnectTarget ? '#f59e0b' : nodeColor
  ctx.lineWidth = isSelected ? 2.5 : 2
  ctx.fillStyle = '#1e293b'

  // Head
  ctx.beginPath()
  ctx.arc(x, y - 18, 10, 0, Math.PI * 2)
  ctx.stroke()

  // Body
  ctx.beginPath()
  ctx.moveTo(x, y - 8)
  ctx.lineTo(x, y + 12)
  ctx.stroke()

  // Arms
  ctx.beginPath()
  ctx.moveTo(x - 16, y)
  ctx.lineTo(x + 16, y)
  ctx.stroke()

  // Legs
  ctx.beginPath()
  ctx.moveTo(x, y + 12)
  ctx.lineTo(x - 12, y + 28)
  ctx.moveTo(x, y + 12)
  ctx.lineTo(x + 12, y + 28)
  ctx.stroke()

  // Label
  ctx.fillStyle = '#1e293b'
  ctx.font = '12px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, x, y + 44)

  if (isSelected) {
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.3)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.strokeRect(x - 24, y - 32, 48, 80)
    ctx.setLineDash([])
  }
  ctx.restore()
}

function drawUseCase(node: UCNode) {
  if (!ctx) return
  const { x, y, width, height, label } = node
  const isSelected = selectedNode.value?.id === node.id
  const isConnectTarget = connectFrom.value?.id === node.id
  const nodeColor = node.color || '#1e293b'

  ctx.save()
  const w = width || 120
  const h = height || 50

  // Ellipse
  ctx.beginPath()
  ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2)
  ctx.fillStyle = isSelected
    ? 'rgba(167, 139, 250, 0.12)'
    : isConnectTarget
    ? 'rgba(245, 158, 11, 0.1)'
    : (node.bgColor || '#ffffff')
  ctx.fill()
  ctx.strokeStyle = isSelected ? '#a78bfa' : isConnectTarget ? '#f59e0b' : nodeColor
  ctx.lineWidth = isSelected ? 2.5 : 1.5
  ctx.stroke()

  // Label
  ctx.fillStyle = '#1e293b'
  ctx.font = '13px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y, w - 16)

  ctx.restore()
}

function drawBoundary(node: UCNode) {
  if (!ctx) return
  const { x, y, width, height, label } = node
  const isSelected = selectedNode.value?.id === node.id
  const nodeColor = node.color || '#000000'
  const w = width || 300
  const h = height || 250

  ctx.save()
  ctx.strokeStyle = isSelected ? '#a78bfa' : nodeColor
  ctx.lineWidth = isSelected ? 2 : 1.5

  ctx.strokeRect(x - w / 2, y - h / 2, w, h)

  // Title
  ctx.fillStyle = isSelected ? '#a78bfa' : nodeColor
  ctx.font = '14px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, x, y - h / 2 - 8)
  ctx.restore()
}

function getEdgePoint(node: UCNode, targetX: number, targetY: number) {
  const cx = node.x
  const cy = node.y
  const dx = targetX - cx
  const dy = targetY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  if (node.type === 'usecase') {
    // Ellipse intersection
    const a = (node.width || 120) / 2
    const b = (node.height || 50) / 2
    const angle = Math.atan2(dy, dx)
    return {
      x: cx + a * Math.cos(angle),
      y: cy + b * Math.sin(angle),
    }
  } else if (node.type === 'actor') {
    // Bounding box intersection for actor figure
    const hw = 24, hh = 40
    const sx = Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity
    const sy = Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity
    const s = Math.min(sx, sy)
    return { x: cx + dx * s, y: cy + dy * s }
  } else {
    // Boundary rectangle intersection
    const hw = (node.width || 300) / 2
    const hh = (node.height || 250) / 2
    const sx = Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity
    const sy = Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity
    const s = Math.min(sx, sy)
    return { x: cx + dx * s, y: cy + dy * s }
  }
}

function drawRelation(rel: UCRelation) {
  if (!ctx) return
  const from = nodes.value.find(n => n.id === rel.fromId)
  const to = nodes.value.find(n => n.id === rel.toId)
  if (!from || !to) return

  const isSelected = selectedRelation.value?.id === rel.id

  ctx.save()

  const fromCenter = { x: from.x, y: from.y }
  const toCenter = { x: to.x, y: to.y }
  const fromPt = getEdgePoint(from, toCenter.x, toCenter.y)
  const toPt = getEdgePoint(to, fromCenter.x, fromCenter.y)

  // Determine style
  const relColor = rel.color || '#000000'
  const relLineWidth = rel.lineWidth || 1.5

  ctx.strokeStyle = isSelected ? '#a78bfa' : relColor
  ctx.lineWidth = isSelected ? relLineWidth + 1 : relLineWidth

  if (rel.type === 'include' || rel.type === 'extend') {
    ctx.setLineDash([6, 4])
  }

  ctx.beginPath()
  ctx.moveTo(fromPt.x, fromPt.y)
  ctx.lineTo(toPt.x, toPt.y)
  ctx.stroke()
  ctx.setLineDash([])

  // Draw arrow at toPt
  const angle = Math.atan2(toPt.y - fromPt.y, toPt.x - fromPt.x)
  const arrowLen = 12

  if (rel.type === 'generalization') {
    // Hollow triangle arrow (UML generalization)
    ctx.save()
    ctx.translate(toPt.x, toPt.y)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-arrowLen, -6)
    ctx.lineTo(-arrowLen, 6)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = isSelected ? '#a78bfa' : relColor
    ctx.lineWidth = isSelected ? relLineWidth + 1 : relLineWidth
    ctx.stroke()
    ctx.restore()
  } else if (rel.type === 'include' || rel.type === 'extend') {
    // Filled arrow for include/extend (dashed line)
    ctx.save()
    ctx.translate(toPt.x, toPt.y)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-arrowLen, -5)
    ctx.lineTo(-arrowLen, 5)
    ctx.closePath()
    ctx.fillStyle = isSelected ? '#a78bfa' : relColor
    ctx.fill()
    ctx.restore()
  } else {
    // Simple open arrow for association
    ctx.save()
    ctx.translate(toPt.x, toPt.y)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(-arrowLen, -5)
    ctx.lineTo(0, 0)
    ctx.lineTo(-arrowLen, 5)
    ctx.strokeStyle = isSelected ? '#a78bfa' : relColor
    ctx.lineWidth = isSelected ? relLineWidth + 1 : relLineWidth
    ctx.stroke()
    ctx.restore()
  }

  // Label for include/extend
  if (rel.type === 'include' || rel.type === 'extend') {
    const mx = (fromPt.x + toPt.x) / 2
    const my = (fromPt.y + toPt.y) / 2
    ctx.fillStyle = isSelected ? '#a78bfa' : '#000000'
    ctx.font = '11px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`«${rel.type}»`, mx, my - 8)
  }

  // Selection highlight glow
  if (isSelected) {
    ctx.save()
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.25)'
    ctx.lineWidth = relLineWidth + 6
    if (rel.type === 'include' || rel.type === 'extend') ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(fromPt.x, fromPt.y)
    ctx.lineTo(toPt.x, toPt.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  ctx.restore()
}

function getNodeCenter(node: UCNode) {
  return { x: node.x, y: node.y }
}

function hitTestRelation(mx: number, my: number): UCRelation | null {
  const threshold = 6
  for (let i = relations.value.length - 1; i >= 0; i--) {
    const rel = relations.value[i]!
    const from = nodes.value.find(n => n.id === rel.fromId)
    const to = nodes.value.find(n => n.id === rel.toId)
    if (!from || !to) continue
    const fromPt = getEdgePoint(from, to.x, to.y)
    const toPt = getEdgePoint(to, from.x, from.y)
    const dist = pointToSegmentDist(mx, my, fromPt.x, fromPt.y, toPt.x, toPt.y)
    if (dist <= threshold) return rel
  }
  return null
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax, aby = by - ay
  const apx = px - ax, apy = py - ay
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)))
  const cx = ax + t * abx, cy = ay + t * aby
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
}

function hitTest(mx: number, my: number): UCNode | null {
  // Reverse order so top-most items are checked first
  for (let i = nodes.value.length - 1; i >= 0; i--) {
    const n = nodes.value[i]!
    if (n.type === 'actor') {
      if (Math.abs(mx - n.x) < 24 && my > n.y - 32 && my < n.y + 48) return n
    } else if (n.type === 'usecase') {
      const w = (n.width || 120) / 2
      const h = (n.height || 50) / 2
      const dx = (mx - n.x) / w
      const dy = (my - n.y) / h
      if (dx * dx + dy * dy <= 1) return n
    } else if (n.type === 'boundary') {
      const w = (n.width || 300) / 2
      const h = (n.height || 250) / 2
      if (Math.abs(mx - n.x) < w + 10 && Math.abs(my - n.y) < h + 10) {
        // Only hit boundary edge, not interior
        if (Math.abs(mx - n.x) > w - 10 || Math.abs(my - n.y) > h - 10
          || my < n.y - h + 20) return n
      }
    }
  }
  return null
}

function toCanvasCoord(e: MouseEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left - pan.value.x) / scale.value,
    y: (e.clientY - rect.top - pan.value.y) / scale.value,
  }
}

function onMouseDown(e: MouseEvent) {
  const pos = toCanvasCoord(e)

  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning.value = true
    panStart.value = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y }
    return
  }

  if (selectedTool.value === 'select') {
    const hit = hitTest(pos.x, pos.y)
    if (hit) {
      if (e.detail === 2) {
        // Double click to edit
        selectedNode.value = hit
        selectedRelation.value = null
        editLabel.value = hit.label
        showEditModal.value = true
        return
      }
      // If selectAll is active, drag all nodes together
      if (selectAll.value) {
        dragging.value = true
        dragAllOffset.value = { x: pos.x, y: pos.y }
        dragAllStart.value = nodes.value.map(n => ({ x: n.x, y: n.y }))
      } else {
        selectedNode.value = hit
        selectedRelation.value = null
        dragging.value = true
        dragOffset.value = { x: pos.x - hit.x, y: pos.y - hit.y }
      }
    } else {
      // Try hitting a relation line
      const hitRel = hitTestRelation(pos.x, pos.y)
      if (hitRel) {
        selectedRelation.value = hitRel
        selectedNode.value = null
      } else {
        // Empty space: start panning
        selectedNode.value = null
        selectedRelation.value = null
        isPanning.value = true
        panStart.value = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y }
      }
    }
    draw()
  } else if (selectedTool.value === 'connect') {
    const hit = hitTest(pos.x, pos.y)
    if (hit) {
      if (!connectFrom.value) {
        connectFrom.value = hit
      } else {
        // Create relation
        if (hit.id !== connectFrom.value.id) {
          showRelationModal.value = true
          selectedNode.value = hit
        }
      }
      draw()
    }
  } else {
    // Place a new node
    const type = selectedTool.value as UCNodeType
    const newNode: UCNode = {
      id: generateId(),
      type,
      label: type === 'actor' ? '参与者' : type === 'usecase' ? '用例' : '系统边界',
      x: pos.x,
      y: pos.y,
      width: type === 'usecase' ? 120 : type === 'boundary' ? 300 : 48,
      height: type === 'usecase' ? 50 : type === 'boundary' ? 250 : 80,
    }
    nodes.value.push(newNode)
    selectedNode.value = newNode
    selectedTool.value = 'select'
    draw()
    autoSave()
  }
}

function onMouseMove(e: MouseEvent) {
  if (isPanning.value) {
    pan.value.x = e.clientX - panStart.value.x
    pan.value.y = e.clientY - panStart.value.y
    draw()
    return
  }

  if (dragging.value) {
    const pos = toCanvasCoord(e)
    if (selectAll.value) {
      // Move all nodes together
      const dx = pos.x - dragAllOffset.value.x
      const dy = pos.y - dragAllOffset.value.y
      nodes.value.forEach((n, i) => {
        const startPos = dragAllStart.value[i]
        if (startPos) {
          n.x = startPos.x + dx
          n.y = startPos.y + dy
        }
      })
      draw()
    } else if (selectedNode.value) {
      selectedNode.value.x = pos.x - dragOffset.value.x
      selectedNode.value.y = pos.y - dragOffset.value.y
      draw()
    }
  }
}

function onMouseUp() {
  if (dragging.value) {
    dragging.value = false
    autoSave()
  }
  isPanning.value = false
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const rect = canvasRef.value!.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  const oldScale = scale.value
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.min(3, Math.max(0.2, oldScale * delta))

  // Zoom toward mouse position
  pan.value.x = mx - (mx - pan.value.x) * (newScale / oldScale)
  pan.value.y = my - (my - pan.value.y) * (newScale / oldScale)
  scale.value = newScale
  draw()
}

function zoomIn() {
  const canvas = canvasRef.value!
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const oldScale = scale.value
  const newScale = Math.min(3, oldScale * 1.2)
  pan.value.x = cx - (cx - pan.value.x) * (newScale / oldScale)
  pan.value.y = cy - (cy - pan.value.y) * (newScale / oldScale)
  scale.value = newScale
  draw()
}

function zoomOut() {
  const canvas = canvasRef.value!
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const oldScale = scale.value
  const newScale = Math.max(0.2, oldScale / 1.2)
  pan.value.x = cx - (cx - pan.value.x) * (newScale / oldScale)
  pan.value.y = cy - (cy - pan.value.y) * (newScale / oldScale)
  scale.value = newScale
  draw()
}

function resetView() {
  pan.value = { x: 0, y: 0 }
  scale.value = 1
  draw()
}

function toggleSelectAll() {
  selectAll.value = !selectAll.value
  if (!selectAll.value) {
    selectedNode.value = null
  }
  draw()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Delete' && !showEditModal.value) {
    if (selectedRelation.value) {
      deleteSelectedRelation()
    } else if (selectedNode.value) {
      deleteSelected()
    }
  }
  if (e.key === 'Escape') {
    selectedNode.value = null
    selectedRelation.value = null
    connectFrom.value = null
    selectAll.value = false
    selectedTool.value = 'select'
    draw()
  }
  // Ctrl+A to select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !showEditModal.value) {
    e.preventDefault()
    selectAll.value = true
    selectedTool.value = 'select'
    draw()
  }
}

function deleteSelected() {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  nodes.value = nodes.value.filter(n => n.id !== id)
  relations.value = relations.value.filter(r => r.fromId !== id && r.toId !== id)
  selectedNode.value = null
  draw()
  autoSave()
}

function deleteSelectedRelation() {
  if (!selectedRelation.value) return
  const id = selectedRelation.value.id
  relations.value = relations.value.filter(r => r.id !== id)
  selectedRelation.value = null
  draw()
  autoSave()
}

function confirmEdit() {
  if (selectedNode.value) {
    selectedNode.value.label = editLabel.value || selectedNode.value.label
  }
  showEditModal.value = false
  draw()
  autoSave()
}

function confirmRelation() {
  if (connectFrom.value && selectedNode.value) {
    relations.value.push({
      id: generateId(),
      type: connectType.value,
      fromId: connectFrom.value.id,
      toId: selectedNode.value.id,
    })
  }
  connectFrom.value = null
  selectedNode.value = null
  showRelationModal.value = false
  selectedTool.value = 'select'
  draw()
  autoSave()
}

function autoSave() {
  if (store.activeProject) {
    store.activeProject.usecase.nodes = nodes.value
    store.activeProject.usecase.relations = relations.value
  }
}

function resizeCanvas() {
  if (!canvasRef.value) return
  const container = canvasRef.value.parentElement!
  canvasRef.value.width = container.clientWidth
  canvasRef.value.height = container.clientHeight
  draw()
}

function exportPNG() {
  if (!canvasRef.value) return
  const url = canvasRef.value.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = 'usecase_diagram.png'
  a.click()
}

onMounted(() => {
  nextTick(() => {
    if (canvasRef.value) {
      ctx = canvasRef.value.getContext('2d')
      resizeCanvas()
    }
  })
  window.addEventListener('resize', resizeCanvas)
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="editor-layout">
    <!-- Toolbar -->
    <aside class="toolbar">
      <div class="toolbar-header">
        <h3>用例图工具</h3>
      </div>
      <div class="toolbar-content">
        <div class="toolbar-section">
          <div class="toolbar-section-title">工具</div>
          <button class="tool-btn" :class="{ active: selectedTool === 'select' }" @click="selectedTool = 'select'">
            <span class="tool-icon">🖱️</span> 选择 / 移动
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'actor' }" @click="selectedTool = 'actor'">
            <span class="tool-icon">👤</span> 参与者
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'usecase' }" @click="selectedTool = 'usecase'">
            <span class="tool-icon">⭕</span> 用例
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'boundary' }" @click="selectedTool = 'boundary'">
            <span class="tool-icon">🔲</span> 系统边界
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'connect' }" @click="selectedTool = 'connect'; connectFrom = null">
            <span class="tool-icon">↗️</span> 连线
          </button>
        </div>

        <div class="toolbar-section" v-if="selectedNode && selectedTool === 'select'">
          <div class="toolbar-section-title">属性</div>
          <div class="form-group">
            <label class="form-label">名称</label>
            <input class="form-input" :value="selectedNode.label" @change="(e: any) => { selectedNode!.label = e.target.value; draw(); autoSave() }" />
          </div>
          <div class="form-group" v-if="selectedNode.type !== 'actor'">
            <label class="form-label">宽度</label>
            <input class="form-input" type="number" :value="selectedNode.width" @change="(e: any) => { selectedNode!.width = +e.target.value; draw(); autoSave() }" />
          </div>
          <div class="form-group" v-if="selectedNode.type !== 'actor'">
            <label class="form-label">高度</label>
            <input class="form-input" type="number" :value="selectedNode.height" @change="(e: any) => { selectedNode!.height = +e.target.value; draw(); autoSave() }" />
          </div>
          <div class="form-group">
            <label class="form-label">颜色</label>
            <div class="color-picker-row">
              <input type="color" class="color-input" :value="selectedNode.color || '#1e293b'" @input="(e: any) => { selectedNode!.color = e.target.value; draw(); autoSave() }" />
              <span class="color-value">{{ selectedNode.color || '#1e293b' }}</span>
              <button v-if="selectedNode.color" class="btn btn-ghost btn-xs" @click="selectedNode!.color = undefined; draw(); autoSave()" title="重置">↺</button>
            </div>
          </div>
          <div class="form-group" v-if="selectedNode.type === 'usecase'">
            <label class="form-label">背景颜色</label>
            <div class="color-picker-row">
              <input type="color" class="color-input" :value="selectedNode.bgColor || '#ffffff'" @input="(e: any) => { selectedNode!.bgColor = e.target.value; draw(); autoSave() }" />
              <span class="color-value">{{ selectedNode.bgColor || '#ffffff' }}</span>
              <button v-if="selectedNode.bgColor" class="btn btn-ghost btn-xs" @click="selectedNode!.bgColor = undefined; draw(); autoSave()" title="重置">↺</button>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" @click="deleteSelected" style="width: 100%; margin-top: 8px;">删除元素</button>
        </div>

        <div class="toolbar-section" v-if="selectedRelation && selectedTool === 'select'">
          <div class="toolbar-section-title">连线属性</div>
          <div class="form-group">
            <label class="form-label">类型</label>
            <select class="form-select" :value="selectedRelation.type" @change="(e: any) => { selectedRelation!.type = e.target.value; draw(); autoSave() }">
              <option value="association">关联 (Association)</option>
              <option value="include">包含 (Include)</option>
              <option value="extend">扩展 (Extend)</option>
              <option value="generalization">泛化 (Generalization)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">颜色</label>
            <div class="color-picker-row">
              <input type="color" class="color-input" :value="selectedRelation.color || '#64748b'" @input="(e: any) => { selectedRelation!.color = e.target.value; draw(); autoSave() }" />
              <span class="color-value">{{ selectedRelation.color || '#64748b' }}</span>
              <button v-if="selectedRelation.color" class="btn btn-ghost btn-xs" @click="selectedRelation!.color = undefined; draw(); autoSave()" title="重置">↺</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">线宽</label>
            <input class="form-input" type="number" min="1" max="6" step="0.5" :value="selectedRelation.lineWidth || 1.5" @change="(e: any) => { selectedRelation!.lineWidth = +e.target.value; draw(); autoSave() }" />
          </div>
          <button class="btn btn-danger btn-sm" @click="deleteSelectedRelation" style="width: 100%; margin-top: 8px;">删除连线</button>
        </div>

        <div class="toolbar-section" v-if="connectFrom">
          <div class="toolbar-section-title">连线模式</div>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
            从 <strong style="color: var(--accent-tertiary);">{{ connectFrom.label }}</strong> 开始连线
          </p>
          <p style="font-size: 12px; color: var(--text-muted);">点击目标节点完成连线</p>
        </div>

        <div class="toolbar-section">
          <div class="toolbar-section-title">视图</div>
          <button class="tool-btn" :class="{ active: selectAll }" @click="toggleSelectAll">
            <span class="tool-icon">🔗</span> 全选移动
          </button>
          <div style="display: flex; gap: 4px; margin-top: 4px;">
            <button class="btn btn-secondary btn-sm" @click="zoomOut" style="flex:1;">➖</button>
            <button class="btn btn-secondary btn-sm" @click="resetView" style="flex:1;">{{ Math.round(scale * 100) }}%</button>
            <button class="btn btn-secondary btn-sm" @click="zoomIn" style="flex:1;">➕</button>
          </div>
        </div>

        <div class="toolbar-section">
          <div class="toolbar-section-title">操作</div>
          <button class="btn btn-secondary btn-sm" @click="exportPNG" style="width: 100%;">📷 导出 PNG</button>
        </div>
      </div>
    </aside>

    <!-- Canvas -->
    <div class="canvas-container">
      <canvas
        ref="canvasRef"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @wheel.prevent="onWheel"
        :class="{
          crosshair: selectedTool !== 'select' && selectedTool !== 'connect',
          pointer: selectedTool === 'connect',
          grabbing: isPanning,
          'move-all': selectAll && selectedTool === 'select' && !isPanning,
        }"
      ></canvas>

      <div class="canvas-hint" v-if="nodes.length === 0">
        <p>💡 选择左侧工具栏中的元素，然后在画布上点击放置</p>
      </div>
    </div>

    <!-- Edit Modal -->
    <div class="modal-overlay" v-if="showEditModal" @click.self="showEditModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>编辑名称</h3>
          <button class="btn btn-ghost btn-icon" @click="showEditModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">名称</label>
            <input class="form-input" v-model="editLabel" @keyup.enter="confirmEdit" autofocus />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showEditModal = false">取消</button>
          <button class="btn btn-primary" @click="confirmEdit">确定</button>
        </div>
      </div>
    </div>

    <!-- Relation Type Modal -->
    <div class="modal-overlay" v-if="showRelationModal" @click.self="showRelationModal = false; connectFrom = null">
      <div class="modal">
        <div class="modal-header">
          <h3>选择关系类型</h3>
          <button class="btn btn-ghost btn-icon" @click="showRelationModal = false; connectFrom = null">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">关系类型</label>
            <select class="form-select" v-model="connectType">
              <option value="association">关联 (Association)</option>
              <option value="include">包含 (Include)</option>
              <option value="extend">扩展 (Extend)</option>
              <option value="generalization">泛化 (Generalization)</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showRelationModal = false; connectFrom = null">取消</button>
          <button class="btn btn-primary" @click="confirmRelation">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-layout {
  display: flex;
  width: 100%;
  height: 100%;
}

.toolbar {
  width: 240px;
  background: var(--bg-glass);
  backdrop-filter: blur(16px);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
}

.toolbar-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}
.toolbar-header h3 {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.toolbar-content {
  flex: 1;
  overflow-y: auto;
}

.toolbar-section {
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}

.toolbar-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.tool-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  border: 1px solid transparent;
  background: transparent;
  width: 100%;
  text-align: left;
  font-family: inherit;
  margin-bottom: 2px;
}
.tool-btn:hover {
  color: var(--text-primary);
  background: rgba(99, 102, 241, 0.08);
}
.tool-btn.active {
  color: var(--accent-tertiary);
  background: rgba(99, 102, 241, 0.12);
  border-color: var(--border-hover);
}
.tool-icon { font-size: 16px; width: 22px; text-align: center; flex-shrink: 0; }

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #ffffff;
}

.canvas-container canvas {
  display: block;
  cursor: default;
}
.canvas-container canvas.crosshair { cursor: crosshair; }
.canvas-container canvas.pointer { cursor: pointer; }
.canvas-container canvas.grabbing { cursor: grabbing; }
.canvas-container canvas.move-all { cursor: move; }

.canvas-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(241, 245, 249, 0.9);
  backdrop-filter: blur(8px);
  border: 1px solid #e2e8f0;
  border-radius: var(--radius-md);
  padding: 16px 24px;
  pointer-events: none;
}
.canvas-hint p {
  font-size: 13px;
  color: #64748b;
}

.color-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-input {
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}
.color-input::-webkit-color-swatch-wrapper { padding: 2px; }
.color-input::-webkit-color-swatch { border-radius: 3px; border: none; }
.color-value {
  font-size: 12px;
  color: var(--text-muted);
  font-family: monospace;
}
.btn-xs {
  padding: 2px 6px;
  font-size: 12px;
}
</style>
