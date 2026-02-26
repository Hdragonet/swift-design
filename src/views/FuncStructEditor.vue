<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useProjectStore, type FuncNode } from '../stores/project'

const store = useProjectStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null

// Canvas pan
const panX = ref(0)
const panY = ref(0)
const panning = ref(false)
const panStart = ref({ x: 0, y: 0 })

// Text input
const inputText = ref('')
const parsedNodes = computed(() => parseTextToNodes(inputText.value))
const hasContent = computed(() => parsedNodes.value.length > 0)
const hasInteracted = ref(false)

const sampleText = `小区综合信息服务平台
  用户前台
    业主
      登录注册
      查看公告
      查看活动
      供求管理
      用户投诉
    维修人员
      物业费查询
      维修上报
      报表盘
  管理员后台
    物业管理员
      楼栋管理
      房屋管理
      业主管理
      物业费管理
      活动管理
      供求管理
      公告管理
      投诉管理
      报修管理
    系统管理员
      菜单管理
      角色管理
      用户管理`

// Load from store
watch(() => store.activeProject, (proj) => {
  if (proj) {
    if (proj.funcStruct && proj.funcStruct.nodes.length > 0) {
      inputText.value = nodesToText(proj.funcStruct.nodes, 0)
      hasInteracted.value = true
    }
    nextTick(() => draw())
  }
}, { immediate: true })

// Re-draw on text change
watch(inputText, () => {
  if (inputText.value.length > 0) {
    hasInteracted.value = true
  }
  draw()
  autoSave()
})

// ====== Text ↔ Tree conversion ======
function parseTextToNodes(text: string): FuncNode[] {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return []

  const indents = lines.map(l => {
    const match = l.match(/^(\s*)/)
    return match ? match[1]?.length ?? 0 : 0
  })

  let indentUnit = 2
  for (const ind of indents) {
    if (ind > 0) {
      indentUnit = ind
      break
    }
  }

  const root: FuncNode[] = []
  const stack: { level: number; node: FuncNode }[] = []
  let idCounter = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    const indent = indents[i]!
    const level = indentUnit > 0 ? Math.round(indent / indentUnit) : 0

    const node: FuncNode = {
      id: `fn_${idCounter++}`,
      label: trimmed,
      children: [],
    }

    if (level === 0) {
      root.push(node)
      stack.length = 0
      stack.push({ level: 0, node })
    } else {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
        stack.pop()
      }
      if (stack.length > 0) {
        stack[stack.length - 1]!.node.children.push(node)
      } else {
        root.push(node)
      }
      stack.push({ level, node })
    }
  }
  return root
}

function nodesToText(nodes: FuncNode[], level: number): string {
  let result = ''
  for (const node of nodes) {
    result += '  '.repeat(level) + node.label + '\n'
    if (node.children.length > 0) {
      result += nodesToText(node.children, level + 1)
    }
  }
  return result.replace(/\n$/, '')
}

// ====== Layout calculation ======
const LEVEL_GAP_Y = 50
const SIBLING_GAP_X = 8
const FONT_SIZE = 13
const CHAR_LINE_H = 18
const V_PAD_X = 8
const V_PAD_Y = 10
const H_PAD_X = 20
const H_PAD_Y = 10

interface LayoutNode {
  label: string
  x: number
  y: number
  w: number
  h: number
  isRoot: boolean
  children: LayoutNode[]
}

function computeNodeSize(label: string, isRoot: boolean): { w: number; h: number } {
  if (isRoot) {
    const textW = measureHorizontalTextWidth(label)
    return { w: Math.max(80, textW + H_PAD_X * 2), h: 36 + H_PAD_Y * 2 }
  } else {
    // Vertical text: one char per row
    const chars = [...label]
    const charW = FONT_SIZE + 2
    const w = charW + V_PAD_X * 2
    const h = chars.length * CHAR_LINE_H + V_PAD_Y * 2
    return { w: Math.max(30, w), h: Math.max(40, h) }
  }
}

function measureHorizontalTextWidth(text: string): number {
  if (!ctx) return text.length * 14
  ctx.font = `${FONT_SIZE}px "Inter", "Microsoft YaHei", sans-serif`
  return ctx.measureText(text).width
}

function computeLayout(nodes: FuncNode[], level: number, isRoot: boolean): LayoutNode[] {
  const layouts = nodes.map(node => {
    const { w, h } = computeNodeSize(node.label, isRoot)
    const childLayouts = computeLayout(node.children, level + 1, false)

    return {
      label: node.label,
      x: 0,
      y: 0,
      w,
      h,
      isRoot,
      children: childLayouts,
    }
  })
  return layouts
}

// Collect all non-root nodes grouped by depth level
function collectByDepth(nodes: LayoutNode[], depth: number, map: Map<number, LayoutNode[]>) {
  for (const node of nodes) {
    if (!node.isRoot) {
      if (!map.has(depth)) map.set(depth, [])
      map.get(depth)!.push(node)
    }
    collectByDepth(node.children, depth + 1, map)
  }
}

// Normalize all nodes at the same depth to have the same height
function normalizeHeightsByDepth(roots: LayoutNode[]) {
  const depthMap = new Map<number, LayoutNode[]>()
  collectByDepth(roots, 0, depthMap)
  for (const [, nodesAtDepth] of depthMap) {
    if (nodesAtDepth.length > 0) {
      const maxH = Math.max(...nodesAtDepth.map(n => n.h))
      for (const n of nodesAtDepth) n.h = maxH
    }
  }
}

function getSubtreeWidth(node: LayoutNode): number {
  if (node.children.length === 0) return node.w
  let childrenWidth = 0
  for (let i = 0; i < node.children.length; i++) {
    if (i > 0) childrenWidth += SIBLING_GAP_X
    childrenWidth += getSubtreeWidth(node.children[i]!)
  }
  return Math.max(node.w, childrenWidth)
}

function positionNodes(nodes: LayoutNode[], startX: number, startY: number) {
  let currentX = startX
  for (const node of nodes) {
    const subtreeW = getSubtreeWidth(node)
    node.x = currentX + subtreeW / 2 - node.w / 2
    node.y = startY
    if (node.children.length > 0) {
      const childY = startY + node.h + LEVEL_GAP_Y
      let childStartX = currentX
      for (const child of node.children) {
        const childSubW = getSubtreeWidth(child)
        positionNodes([child], childStartX, childY)
        childStartX += childSubW + SIBLING_GAP_X
      }
    }
    currentX += subtreeW + SIBLING_GAP_X
  }
}

// ====== Drawing ======
function draw() {
  if (!canvasRef.value || !ctx) return
  const W = canvasRef.value.width
  const H = canvasRef.value.height
  ctx.clearRect(0, 0, W, H)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  ctx.save()
  ctx.translate(panX.value, panY.value)

  // Draw grid
  ctx.save()
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.04)'
  ctx.lineWidth = 1
  const step = 40
  const gx0 = -panX.value - step
  const gy0 = -panY.value - step
  const gx1 = W - panX.value + step
  const gy1 = H - panY.value + step
  for (let x = Math.floor(gx0 / step) * step; x < gx1; x += step) { ctx.beginPath(); ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); ctx.stroke() }
  for (let y = Math.floor(gy0 / step) * step; y < gy1; y += step) { ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke() }
  ctx.restore()

  const nodes = parsedNodes.value
  if (nodes.length === 0) {
    ctx.restore()
    return
  }

  const layoutNodes = computeLayout(nodes, 0, true)
  normalizeHeightsByDepth(layoutNodes)
  positionNodes(layoutNodes, 40, 30)

  for (const node of layoutNodes) {
    drawNodeRecursive(node)
  }

  ctx.restore()
}

function drawNodeRecursive(node: LayoutNode) {
  if (!ctx) return

  // Draw connections to children
  if (node.children.length > 0) {
    const parentCX = node.x + node.w / 2
    const parentBottom = node.y + node.h

    ctx.save()
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 1.5

    const midY = parentBottom + LEVEL_GAP_Y / 2

    ctx.beginPath()
    ctx.moveTo(parentCX, parentBottom)
    ctx.lineTo(parentCX, midY)
    ctx.stroke()

    if (node.children.length > 1) {
      const leftCX = node.children[0]!.x + node.children[0]!.w / 2
      const rightCX = node.children[node.children.length - 1]!.x + node.children[node.children.length - 1]!.w / 2
      ctx.beginPath()
      ctx.moveTo(leftCX, midY)
      ctx.lineTo(rightCX, midY)
      ctx.stroke()
    }

    for (const child of node.children) {
      const childCX = child.x + child.w / 2
      ctx.beginPath()
      ctx.moveTo(childCX, midY)
      ctx.lineTo(childCX, child.y)
      ctx.stroke()
    }

    ctx.restore()
  }

  // Draw node rectangle
  ctx.save()
  const radius = 2
  const { x, y, w, h } = node

  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()

  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Label
  ctx.fillStyle = '#1e293b'
  ctx.font = `${FONT_SIZE}px "Inter", "Microsoft YaHei", sans-serif`

  if (node.isRoot) {
    // Horizontal text for root node
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(node.label, x + w / 2, y + h / 2, w - 12)
  } else {
    // Vertical text: each character drawn top to bottom
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const chars = [...node.label]
    const totalTextH = chars.length * CHAR_LINE_H
    const startTextY = y + (h - totalTextH) / 2 + CHAR_LINE_H / 2
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i]!, x + w / 2, startTextY + i * CHAR_LINE_H)
    }
  }
  ctx.restore()

  // Draw children
  for (const child of node.children) {
    drawNodeRecursive(child)
  }
}

// ====== Interaction ======
function onMouseDown(e: MouseEvent) {
  if (!canvasRef.value) return
  if (e.button === 1 || e.button === 2) {
    e.preventDefault()
    panning.value = true
    panStart.value = { x: e.clientX - panX.value, y: e.clientY - panY.value }
  }
}

function onMouseMove(e: MouseEvent) {
  if (panning.value) {
    panX.value = e.clientX - panStart.value.x
    panY.value = e.clientY - panStart.value.y
    draw()
  }
}

function onMouseUp() {
  if (panning.value) {
    panning.value = false
  }
}

function onContextMenu(e: Event) {
  e.preventDefault()
}

// ====== Actions ======
function loadSample() {
  inputText.value = sampleText
  hasInteracted.value = true
}

function clearAll() {
  if (!inputText.value.trim()) return
  if (!confirm('确定要清空所有内容吗？')) return
  inputText.value = ''
  hasInteracted.value = false
}

function exportImage() {
  if (!canvasRef.value) return

  const nodes = parsedNodes.value
  if (nodes.length === 0) return

  const tempCanvas = document.createElement('canvas')
  const tempCtx = tempCanvas.getContext('2d')
  if (!tempCtx) return

  const savedCtx = ctx
  ctx = tempCtx
  const layoutNodes = computeLayout(nodes, 0, true)
  normalizeHeightsByDepth(layoutNodes)
  positionNodes(layoutNodes, 40, 30)
  ctx = savedCtx

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  function findBounds(n: LayoutNode) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
    for (const c of n.children) findBounds(c)
  }
  for (const n of layoutNodes) findBounds(n)

  const pad = 40
  const exportW = maxX - minX + pad * 2
  const exportH = maxY - minY + pad * 2
  tempCanvas.width = exportW
  tempCanvas.height = exportH

  tempCtx.fillStyle = '#ffffff'
  tempCtx.fillRect(0, 0, exportW, exportH)
  tempCtx.translate(-minX + pad, -minY + pad)

  const origCtx = ctx
  ctx = tempCtx
  for (const n of layoutNodes) {
    drawNodeRecursive(n)
  }
  ctx = origCtx

  const link = document.createElement('a')
  link.download = `功能结构图_${new Date().toISOString().slice(0, 10)}.png`
  link.href = tempCanvas.toDataURL('image/png')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function autoSave() {
  if (store.activeProject) {
    store.activeProject.funcStruct.nodes = parsedNodes.value
  }
}

function resizeCanvas() {
  if (!canvasRef.value) return
  const container = canvasRef.value.parentElement!
  canvasRef.value.width = container.clientWidth
  canvasRef.value.height = container.clientHeight
  draw()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // reset
  }
}

function onTextareaKeydown(e: KeyboardEvent) {
  const textarea = e.target as HTMLTextAreaElement
  if (e.key === 'Tab') {
    e.preventDefault()
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    if (e.shiftKey) {
      const before = inputText.value.substring(0, start)
      const selected = inputText.value.substring(start, end)
      const after = inputText.value.substring(end)
      const lineStart = before.lastIndexOf('\n') + 1
      const prefix = inputText.value.substring(lineStart, start)
      const fullSelected = prefix + selected
      const unindented = fullSelected.replace(/^  /gm, '')
      const diff = fullSelected.length - unindented.length
      inputText.value = inputText.value.substring(0, lineStart) + unindented + after
      nextTick(() => {
        textarea.selectionStart = Math.max(lineStart, start - (prefix.startsWith('  ') ? 2 : 0))
        textarea.selectionEnd = end - diff
      })
    } else {
      if (start === end) {
        inputText.value = inputText.value.substring(0, start) + '  ' + inputText.value.substring(end)
        nextTick(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2
        })
      } else {
        const before = inputText.value.substring(0, start)
        const selected = inputText.value.substring(start, end)
        const after = inputText.value.substring(end)
        const lineStart = before.lastIndexOf('\n') + 1
        const prefix = inputText.value.substring(lineStart, start)
        const fullSelected = prefix + selected
        const indented = fullSelected.replace(/^/gm, '  ')
        const diff = indented.length - fullSelected.length
        inputText.value = inputText.value.substring(0, lineStart) + indented + after
        nextTick(() => {
          textarea.selectionStart = start + 2
          textarea.selectionEnd = end + diff
        })
      }
    }
  }
}

onMounted(() => {
  if (canvasRef.value) {
    ctx = canvasRef.value.getContext('2d')
    resizeCanvas()
  }
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
      <div class="toolbar-header"><h3>功能结构图</h3></div>
      <div class="toolbar-content">
        <div class="toolbar-section">
          <div class="toolbar-section-title">操作</div>
          <button class="btn btn-secondary btn-sm" @click="loadSample" style="width: 100%; margin-bottom: 6px;">📄 加载示例</button>
          <button class="btn btn-secondary btn-sm" @click="exportImage" style="width: 100%; margin-bottom: 6px;">📸 导出图片</button>
          <button class="btn btn-danger btn-sm" @click="clearAll" style="width: 100%;">🗑️ 一键清空</button>
          <p style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">右键拖拽可平移画布</p>
        </div>
        <div class="toolbar-section">
          <div class="toolbar-section-title">输入层级结构</div>
          <p class="input-hint">使用 2 空格缩进表示层级<br>第一行为根节点<br>按 Tab / Shift+Tab 缩进</p>
          <textarea
            class="struct-input"
            v-model="inputText"
            placeholder="小区综合信息服务平台
  用户前台
    业主
      登录注册
      查看公告
  管理员后台
    系统管理员
      用户管理"
            spellcheck="false"
            @keydown="onTextareaKeydown"
          ></textarea>
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
        @contextmenu="onContextMenu"
      ></canvas>
      <div class="canvas-hint" v-if="!hasInteracted && !hasContent">
        <p>在左侧输入层级结构或点击「加载示例」开始</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-layout { display: flex; width: 100%; height: 100%; }

.toolbar {
  width: 280px;
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
.toolbar-content { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.toolbar-section { padding: 12px; border-bottom: 1px solid var(--border-color); }
.toolbar-section:last-child { flex: 1; display: flex; flex-direction: column; border-bottom: none; }
.toolbar-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 8px; }

.input-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
  line-height: 1.6;
}

.struct-input {
  width: 100%;
  flex: 1;
  min-height: 300px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  line-height: 1.7;
  resize: none;
  outline: none;
  transition: border-color var(--transition-fast);
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}
.struct-input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.struct-input::placeholder {
  color: var(--text-muted);
  opacity: 0.5;
}

.canvas-container { flex: 1; position: relative; overflow: hidden; background: #ffffff; }
.canvas-container canvas { display: block; cursor: default; }
.canvas-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(241, 245, 249, 0.9); backdrop-filter: blur(8px); border: 1px solid #e2e8f0; border-radius: var(--radius-md); padding: 16px 24px; pointer-events: none; }
.canvas-hint p { font-size: 13px; color: #64748b; }
</style>
