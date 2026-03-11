<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useProjectStore, type ERNode, type ERLink, type ERNodeType, type ERCardinality } from '../stores/project'

const store = useProjectStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null

const selectedTool = ref<'select' | 'entity' | 'attribute' | 'relationship' | 'connect'>('select')
const selectedNode = ref<ERNode | null>(null)
const connectFrom = ref<ERNode | null>(null)
const dragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const showEditModal = ref(false)
const editLabel = ref('')
const showLinkModal = ref(false)
const linkCardinality = ref<ERCardinality>('1:N')
const showSqlModal = ref(false)
const sqlInput = ref('')

const pan = ref({ x: 0, y: 0 })
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })

const nodes = ref<ERNode[]>([])
const links = ref<ERLink[]>([])

watch(() => store.activeProject, (proj) => {
  if (proj) {
    nodes.value = proj.er.nodes
    links.value = proj.er.links
    draw()
  }
}, { immediate: true })

function generateId() { return store.generateId('er') }

function draw() {
  if (!canvasRef.value || !ctx) return
  const W = canvasRef.value.width
  const H = canvasRef.value.height
  ctx.clearRect(0, 0, W, H)
  ctx.save()
  ctx.translate(pan.value.x, pan.value.y)

  // Draw links
  for (const link of links.value) {
    drawLink(link)
  }

  // Draw nodes
  for (const node of nodes.value) {
    if (node.type === 'entity') drawEntity(node)
    else if (node.type === 'attribute') drawAttribute(node)
    else if (node.type === 'relationship') drawRelationship(node)
  }

  ctx.restore()
}



function drawEntity(node: ERNode) {
  if (!ctx) return
  const { x, y, label } = node
  const isSelected = selectedNode.value?.id === node.id
  const nodeColor = node.color || '#000000'
  const w = 120, h = 44

  ctx.save()
  ctx.beginPath()
  ctx.rect(x - w / 2, y - h / 2, w, h)
  ctx.fillStyle = isSelected ? 'rgba(167, 139, 250, 0.12)' : 'rgba(255, 255, 255, 0.95)'
  ctx.fill()
  ctx.strokeStyle = isSelected ? '#a78bfa' : nodeColor
  ctx.lineWidth = isSelected ? 2.5 : 1.5
  ctx.stroke()

  ctx.fillStyle = nodeColor
  ctx.font = 'bold 13px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y, w - 12)
  ctx.restore()
}

function drawAttribute(node: ERNode) {
  if (!ctx) return
  const { x, y, label, isPrimaryKey, isMultiValued } = node
  const isSelected = selectedNode.value?.id === node.id
  const nodeColor = node.color || '#000000'
  const rx = 55, ry = 22

  ctx.save()

  if (isMultiValued) {
    ctx.beginPath()
    ctx.ellipse(x, y, rx + 4, ry + 4, 0, 0, Math.PI * 2)
    ctx.strokeStyle = isSelected ? '#a78bfa' : nodeColor
    ctx.lineWidth = 1
    ctx.stroke()
  }

  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = isSelected ? 'rgba(167, 139, 250, 0.12)' : 'rgba(255, 255, 255, 0.95)'
  ctx.fill()
  ctx.strokeStyle = isSelected ? '#a78bfa' : nodeColor
  ctx.lineWidth = isSelected ? 2 : 1.5
  ctx.stroke()

  ctx.fillStyle = nodeColor
  ctx.font = '12px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (isPrimaryKey) {
    const textW = ctx.measureText(label).width
    ctx.fillText(label, x, y, rx * 2 - 10)
    ctx.beginPath()
    ctx.moveTo(x - textW / 2, y + 8)
    ctx.lineTo(x + textW / 2, y + 8)
    ctx.strokeStyle = nodeColor
    ctx.lineWidth = 1
    ctx.stroke()
  } else {
    ctx.fillText(label, x, y, rx * 2 - 10)
  }

  ctx.restore()
}

function drawRelationship(node: ERNode) {
  if (!ctx) return
  const { x, y, label } = node
  const isSelected = selectedNode.value?.id === node.id
  const nodeColor = node.color || '#000000'
  const size = 40

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x, y - size)
  ctx.lineTo(x + size * 1.4, y)
  ctx.lineTo(x, y + size)
  ctx.lineTo(x - size * 1.4, y)
  ctx.closePath()

  ctx.fillStyle = isSelected ? 'rgba(167, 139, 250, 0.12)' : 'rgba(255, 255, 255, 0.95)'
  ctx.fill()
  ctx.strokeStyle = isSelected ? '#a78bfa' : nodeColor
  ctx.lineWidth = isSelected ? 2.5 : 1.5
  ctx.stroke()

  ctx.fillStyle = nodeColor
  ctx.font = '12px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y, size * 2)
  ctx.restore()
}

// 计算节点边缘交点：从节点中心向 (toX, toY) 方向的边框交点
function getNodeBorderPoint(node: ERNode, toX: number, toY: number): { x: number; y: number } {
  const dx = toX - node.x
  const dy = toY - node.y
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y }

  if (node.type === 'entity') {
    // 矩形 120×44
    const hw = 60, hh = 22
    const absDx = Math.abs(dx), absDy = Math.abs(dy)
    let scale: number
    if (absDx / hw > absDy / hh) {
      scale = hw / absDx
    } else {
      scale = hh / absDy
    }
    return { x: node.x + dx * scale, y: node.y + dy * scale }
  } else if (node.type === 'attribute') {
    // 椭圆 rx=55, ry=22
    const rx = 55, ry = 22
    const angle = Math.atan2(dy, dx)
    return {
      x: node.x + rx * Math.cos(angle),
      y: node.y + ry * Math.sin(angle),
    }
  } else if (node.type === 'relationship') {
    // 菱形 size=40, 宽=56*2=半宽56, 高=40
    const hw = 56, hh = 40
    const absDx = Math.abs(dx), absDy = Math.abs(dy)
    // 菱形边界: |x/hw| + |y/hh| = 1
    const sum = absDx / hw + absDy / hh
    if (sum === 0) return { x: node.x, y: node.y }
    const scale = 1 / sum
    return { x: node.x + dx * scale, y: node.y + dy * scale }
  }
  return { x: node.x, y: node.y }
}

function drawLink(link: ERLink) {
  if (!ctx) return
  const from = nodes.value.find(n => n.id === link.fromId)
  const to = nodes.value.find(n => n.id === link.toId)
  if (!from || !to) return

  // 计算边缘交点
  const fromPt = getNodeBorderPoint(from, to.x, to.y)
  const toPt = getNodeBorderPoint(to, from.x, from.y)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(fromPt.x, fromPt.y)
  ctx.lineTo(toPt.x, toPt.y)
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 在连线中点标注基数
  if (link.cardinality) {
    const mx = (fromPt.x + toPt.x) / 2
    const my = (fromPt.y + toPt.y) / 2

    ctx.font = 'bold 12px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // 白底背景
    const textW = ctx.measureText(link.cardinality).width + 10
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(mx - textW / 2, my - 10, textW, 20)
    // 黑色文字
    ctx.fillStyle = '#000000'
    ctx.fillText(link.cardinality, mx, my)
  }
  ctx.restore()
}

function hitTest(mx: number, my: number): ERNode | null {
  for (let i = nodes.value.length - 1; i >= 0; i--) {
    const n = nodes.value[i]!
    if (n.type === 'entity') {
      if (Math.abs(mx - n.x) < 60 && Math.abs(my - n.y) < 22) return n
    } else if (n.type === 'attribute') {
      const dx = (mx - n.x) / 55
      const dy = (my - n.y) / 22
      if (dx * dx + dy * dy <= 1) return n
    } else if (n.type === 'relationship') {
      const dx = Math.abs(mx - n.x) / 56
      const dy = Math.abs(my - n.y) / 40
      if (dx + dy <= 1) return n
    }
  }
  return null
}

function toCanvasCoord(e: MouseEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left - pan.value.x, y: e.clientY - rect.top - pan.value.y }
}

function onMouseDown(e: MouseEvent) {
  const pos = toCanvasCoord(e)
  if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
    isPanning.value = true
    panStart.value = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y }
    return
  }

  if (selectedTool.value === 'select') {
    const hit = hitTest(pos.x, pos.y)
    if (hit) {
      if (e.detail === 2) {
        selectedNode.value = hit
        editLabel.value = hit.label
        showEditModal.value = true
        return
      }
      selectedNode.value = hit
      dragging.value = true
      dragOffset.value = { x: pos.x - hit.x, y: pos.y - hit.y }
    } else {
      selectedNode.value = null
    }
    draw()
  } else if (selectedTool.value === 'connect') {
    const hit = hitTest(pos.x, pos.y)
    if (hit) {
      if (!connectFrom.value) {
        connectFrom.value = hit
      } else if (hit.id !== connectFrom.value.id) {
        selectedNode.value = hit
        showLinkModal.value = true
      }
      draw()
    }
  } else {
    const type = selectedTool.value as ERNodeType
    const newNode: ERNode = {
      id: generateId(),
      type,
      label: type === 'entity' ? '实体' : type === 'attribute' ? '属性' : '关系',
      x: pos.x,
      y: pos.y,
      isPrimaryKey: false,
      isMultiValued: false,
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
  if (dragging.value && selectedNode.value) {
    const pos = toCanvasCoord(e)
    selectedNode.value.x = pos.x - dragOffset.value.x
    selectedNode.value.y = pos.y - dragOffset.value.y
    draw()
  }
}

function onMouseUp() {
  if (dragging.value) { dragging.value = false; autoSave() }
  isPanning.value = false
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Delete' && selectedNode.value && !showEditModal.value) deleteSelected()
  if (e.key === 'Escape') { selectedNode.value = null; connectFrom.value = null; selectedTool.value = 'select'; draw() }
}

function deleteSelected() {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  nodes.value = nodes.value.filter(n => n.id !== id)
  links.value = links.value.filter(l => l.fromId !== id && l.toId !== id)
  selectedNode.value = null
  draw(); autoSave()
}

function confirmEdit() {
  if (selectedNode.value) selectedNode.value.label = editLabel.value || selectedNode.value.label
  showEditModal.value = false
  draw(); autoSave()
}

function confirmLink() {
  if (connectFrom.value && selectedNode.value) {
    const fromNode = connectFrom.value
    const toNode = selectedNode.value

    // 两个实体之间连线时，自动在中间创建关系菱形
    if (fromNode.type === 'entity' && toNode.type === 'entity') {
      const relNode: ERNode = {
        id: generateId(),
        type: 'relationship',
        label: '关系',
        x: (fromNode.x + toNode.x) / 2,
        y: (fromNode.y + toNode.y) / 2,
        isPrimaryKey: false,
        isMultiValued: false,
      }
      nodes.value.push(relNode)
      // from实体 → 关系节点，标注基数前半部分（如 "1"）
      const parts = linkCardinality.value.split(':')
      links.value.push({
        id: generateId(),
        fromId: fromNode.id,
        toId: relNode.id,
        cardinality: parts[0] as ERCardinality,
      })
      // 关系节点 → to实体，标注基数后半部分（如 "N"）
      links.value.push({
        id: generateId(),
        fromId: relNode.id,
        toId: toNode.id,
        cardinality: parts[1] as ERCardinality,
      })
    } else {
      // 其他类型的连线（如 entity-attribute）直接连线
      links.value.push({
        id: generateId(),
        fromId: fromNode.id,
        toId: toNode.id,
        cardinality: linkCardinality.value,
      })
    }
  }
  connectFrom.value = null
  selectedNode.value = null
  showLinkModal.value = false
  selectedTool.value = 'select'
  draw(); autoSave()
}

// ====== SQL Parser ======
function parseSql() {
  let sql = sqlInput.value.trim()
  if (!sql) return

  // Step 1: Strip comments
  sql = sql.replace(/--[^\n]*/g, '')          // single-line comments
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, '')  // block comments

  // Step 2: Extract CREATE TABLE blocks using balanced parentheses
  const createTableBlocks: { tableName: string; body: string }[] = []
  const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?(\w+)`?\.)?`?(\w+)`?\s*\(/gi
  let crMatch
  while ((crMatch = createRegex.exec(sql)) !== null) {
    const tableName = crMatch[2] || crMatch[1] || ''
    const startIdx = crMatch.index + crMatch[0].length
    // Find the matching closing paren using balanced counting
    let depth = 1
    let i = startIdx
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++
      else if (sql[i] === ')') depth--
      i++
    }
    if (depth === 0) {
      const body = sql.substring(startIdx, i - 1)
      createTableBlocks.push({ tableName, body })
    }
  }

  if (createTableBlocks.length === 0) return

  // Step 3: Paren-aware field splitter
  function splitFields(body: string): string[] {
    const result: string[] = []
    let depth = 0
    let current = ''
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    if (current.trim()) result.push(current.trim())
    return result
  }

  let offsetX = 200
  let offsetY = 150
  const entityMap: Record<string, ERNode> = {}

  for (const block of createTableBlocks) {
    const { tableName, body } = block

    // Create entity node
    const entityNode: ERNode = {
      id: generateId(),
      type: 'entity',
      label: tableName,
      x: offsetX,
      y: offsetY,
    }
    nodes.value.push(entityNode)
    entityMap[tableName.toLowerCase()] = entityNode

    const fieldLines = splitFields(body)
    let attrIdx = 0
    const pkFields: string[] = []

    // First pass: collect PKs from PRIMARY KEY constraints
    for (const line of fieldLines) {
      const pkMatch = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
      if (pkMatch && pkMatch[1]) {
        pkMatch[1].split(',').forEach(f => pkFields.push(f.replace(/`/g, '').trim()))
      }
    }

    // Second pass: extract fields
    for (const line of fieldLines) {
      // Skip pure constraint / index / key lines
      if (/^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s+KEY|UNIQUE\s+INDEX|INDEX|KEY\s+\w|CONSTRAINT|CHECK)/i.test(line)) continue

      // Match field: `name` TYPE(...) or name TYPE
      const fieldMatch = line.match(/^`?(\w+)`?\s+(\w+(?:\([^)]*\))?)/i)
      if (fieldMatch && fieldMatch[1]) {
        const fieldName = fieldMatch[1]
        const isPK = /PRIMARY\s+KEY/i.test(line) || pkFields.includes(fieldName)

        // Position: alternate left/right of entity, spread vertically
        const side = attrIdx % 2 === 0 ? -130 : 130
        const attrNode: ERNode = {
          id: generateId(),
          type: 'attribute',
          label: fieldName,
          x: offsetX + side,
          y: offsetY - 80 + attrIdx * 45,
          isPrimaryKey: isPK,
          isMultiValued: false,
        }
        nodes.value.push(attrNode)
        links.value.push({
          id: generateId(),
          fromId: entityNode.id,
          toId: attrNode.id,
        })
        attrIdx++
      }
    }

    // Third pass: extract foreign key relationships
    const fkRegex = /FOREIGN\s+KEY\s*\(`?(\w+)`?\)\s*REFERENCES\s+`?(\w+)`?\s*\(`?(\w+)`?\)/gi
    let fkMatch
    while ((fkMatch = fkRegex.exec(body)) !== null) {
      const refTable = (fkMatch[2] || '').toLowerCase()
      // Deferred to after all tables are parsed
      const capturedEntityNode = entityNode
      setTimeout(() => {
        const refEntity = entityMap[refTable]
        if (refEntity) {
          const relNode: ERNode = {
            id: generateId(),
            type: 'relationship',
            label: '关联',
            x: (capturedEntityNode.x + refEntity.x) / 2,
            y: (capturedEntityNode.y + refEntity.y) / 2,
          }
          nodes.value.push(relNode)
          links.value.push({ id: generateId(), fromId: capturedEntityNode.id, toId: relNode.id, cardinality: '1' as ERCardinality })
          links.value.push({ id: generateId(), fromId: relNode.id, toId: refEntity.id, cardinality: 'N' as ERCardinality })
          draw()
        }
      }, 0)
    }

    offsetX += 300
    if (offsetX > 900) { offsetX = 200; offsetY += 350 }
  }

  showSqlModal.value = false
  sqlInput.value = ''
  draw()
  autoSave()
}

function clearAll() {
  if (nodes.value.length === 0) return
  if (!confirm('确定要清空所有 ER 图元素吗？此操作不可撤销。')) return
  nodes.value = []
  links.value = []
  selectedNode.value = null
  connectFrom.value = null
  draw()
  autoSave()
}

function autoSave() {
  if (store.activeProject) {
    store.activeProject.er.nodes = nodes.value
    store.activeProject.er.links = links.value
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
  a.href = url; a.download = 'er_diagram.png'; a.click()
}

onMounted(() => {
  nextTick(() => {
    if (canvasRef.value) { ctx = canvasRef.value.getContext('2d'); resizeCanvas() }
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
    <aside class="toolbar">
      <div class="toolbar-header"><h3>ER 图工具</h3></div>
      <div class="toolbar-content">
        <div class="toolbar-section">
          <div class="toolbar-section-title">工具</div>
          <button class="tool-btn" :class="{ active: selectedTool === 'select' }" @click="selectedTool = 'select'">
            <span class="tool-icon">🖱️</span> 选择 / 移动
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'entity' }" @click="selectedTool = 'entity'">
            <span class="tool-icon">▭</span> 实体
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'attribute' }" @click="selectedTool = 'attribute'">
            <span class="tool-icon">⬮</span> 属性
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'relationship' }" @click="selectedTool = 'relationship'">
            <span class="tool-icon">◇</span> 关系
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'connect' }" @click="selectedTool = 'connect'; connectFrom = null">
            <span class="tool-icon">↗️</span> 连线
          </button>
        </div>

        <div class="toolbar-section">
          <div class="toolbar-section-title">SQL 解析</div>
          <button class="btn btn-secondary btn-sm" @click="showSqlModal = true" style="width: 100%; margin-bottom: 6px;">📝 导入 SQL 语句</button>
          <button class="btn btn-danger btn-sm" @click="clearAll" style="width: 100%;">🗑️ 一键清空</button>
          <p style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
            粘贴 CREATE TABLE 语句自动生成 ER 图
          </p>
        </div>

        <div class="toolbar-section" v-if="selectedNode && selectedTool === 'select'">
          <div class="toolbar-section-title">属性</div>
          <div class="form-group">
            <label class="form-label">名称</label>
            <input class="form-input" :value="selectedNode.label" @change="(e: any) => { selectedNode!.label = e.target.value; draw(); autoSave() }" />
          </div>
          <div class="form-group" v-if="selectedNode.type === 'attribute'">
            <label class="form-label" style="display: flex; align-items: center; gap: 6px;">
              <input type="checkbox" :checked="selectedNode.isPrimaryKey" @change="(e: any) => { selectedNode!.isPrimaryKey = e.target.checked; draw(); autoSave() }" />
              主键
            </label>
          </div>
          <div class="form-group" v-if="selectedNode.type === 'attribute'">
            <label class="form-label" style="display: flex; align-items: center; gap: 6px;">
              <input type="checkbox" :checked="selectedNode.isMultiValued" @change="(e: any) => { selectedNode!.isMultiValued = e.target.checked; draw(); autoSave() }" />
              多值属性
            </label>
          </div>
          <div class="form-group">
            <label class="form-label">颜色</label>
            <div class="color-picker-row">
              <input type="color" class="color-input" :value="selectedNode.color || '#000000'" @input="(e: any) => { selectedNode!.color = e.target.value; draw(); autoSave() }" />
              <span class="color-value">{{ selectedNode.color || '#000000' }}</span>
              <button v-if="selectedNode.color" class="btn btn-ghost btn-xs" @click="selectedNode!.color = undefined; draw(); autoSave()" title="重置">↺</button>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" @click="deleteSelected" style="width: 100%; margin-top: 8px;">删除元素</button>
        </div>

        <div class="toolbar-section" v-if="connectFrom">
          <div class="toolbar-section-title">连线模式</div>
          <p style="font-size: 12px; color: var(--text-muted);">
            从 <strong style="color: var(--accent-tertiary);">{{ connectFrom.label }}</strong> 开始连线
          </p>
        </div>

        <div class="toolbar-section">
          <div class="toolbar-section-title">操作</div>
          <button class="btn btn-secondary btn-sm" @click="exportPNG" style="width: 100%;">📷 导出 PNG</button>
        </div>
      </div>
    </aside>

    <div class="canvas-container">
      <canvas
        ref="canvasRef"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @contextmenu.prevent
        :class="{ crosshair: selectedTool !== 'select' && selectedTool !== 'connect', pointer: selectedTool === 'connect' }"
      ></canvas>
      <div class="canvas-hint" v-if="nodes.length === 0">
        <p>💡 使用工具栏添加实体、属性和关系，或导入 SQL 语句自动生成</p>
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

    <!-- Link Cardinality Modal -->
    <div class="modal-overlay" v-if="showLinkModal" @click.self="showLinkModal = false; connectFrom = null">
      <div class="modal">
        <div class="modal-header">
          <h3>设置基数</h3>
          <button class="btn btn-ghost btn-icon" @click="showLinkModal = false; connectFrom = null">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">基数类型</label>
            <select class="form-select" v-model="linkCardinality">
              <option value="1:1">1:1（一对一）</option>
              <option value="1:N">1:N（一对多）</option>
              <option value="M:N">M:N（多对多）</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showLinkModal = false; connectFrom = null">取消</button>
          <button class="btn btn-primary" @click="confirmLink">确定</button>
        </div>
      </div>
    </div>

    <!-- SQL Import Modal -->
    <div class="modal-overlay" v-if="showSqlModal" @click.self="showSqlModal = false">
      <div class="modal" style="min-width: 520px;">
        <div class="modal-header">
          <h3>导入 SQL 语句</h3>
          <button class="btn btn-ghost btn-icon" @click="showSqlModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">粘贴 CREATE TABLE 语句</label>
            <textarea
              class="form-textarea sql-input"
              v-model="sqlInput"
              placeholder="CREATE TABLE users (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(200) UNIQUE
);"
              rows="10"
            ></textarea>
          </div>
          <p style="font-size: 11px; color: var(--text-muted);">
            支持标准 SQL CREATE TABLE 语句，自动识别字段、主键和外键关系
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showSqlModal = false">取消</button>
          <button class="btn btn-primary" @click="parseSql">解析并生成</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-layout { display: flex; width: 100%; height: 100%; }

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
.toolbar-header { padding: 12px 16px; border-bottom: 1px solid var(--border-color); }
.toolbar-header h3 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); }
.toolbar-content { flex: 1; overflow-y: auto; }
.toolbar-section { padding: 12px; border-bottom: 1px solid var(--border-color); }
.toolbar-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 8px; }
.tool-btn { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--text-secondary); transition: all var(--transition-fast); border: 1px solid transparent; background: transparent; width: 100%; text-align: left; font-family: inherit; margin-bottom: 2px; }
.tool-btn:hover { color: var(--text-primary); background: rgba(99, 102, 241, 0.08); }
.tool-btn.active { color: var(--accent-tertiary); background: rgba(99, 102, 241, 0.12); border-color: var(--border-hover); }
.tool-icon { font-size: 16px; width: 22px; text-align: center; flex-shrink: 0; }

.canvas-container { flex: 1; position: relative; overflow: hidden; background: #ffffff; }
.canvas-container canvas { display: block; cursor: default; }
.canvas-container canvas.crosshair { cursor: crosshair; }
.canvas-container canvas.pointer { cursor: pointer; }
.canvas-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(241, 245, 249, 0.9); backdrop-filter: blur(8px); border: 1px solid #e2e8f0; border-radius: var(--radius-md); padding: 16px 24px; pointer-events: none; }
.canvas-hint p { font-size: 13px; color: #64748b; }

.sql-input {
  font-family: 'Consolas', 'Fira Code', monospace !important;
  color: #a5f3fc !important;
  background: var(--bg-primary) !important;
  min-height: 180px;
  line-height: 1.6;
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
