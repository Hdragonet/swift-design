<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useProjectStore, type DBTable, type DBField } from '../stores/project'

const store = useProjectStore()

const tables = ref<DBTable[]>([])
const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null

const selectedTable = ref<DBTable | null>(null)
const selectedTool = ref<'select' | 'table'>('select')
const dragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

// Style settings
const lineWidth = ref(1.2)
const borderWidth = ref(1.5)
const entityFontSize = ref(14)
const attrFontSize = ref(12)
const draggingAttr = ref<{ table: DBTable; fieldIdx: number } | null>(null)

// Canvas pan
const panX = ref(0)
const panY = ref(0)
const panning = ref(false)
const panStart = ref({ x: 0, y: 0 })

const showAddTableModal = ref(false)
const newTableName = ref('')
const showAddFieldModal = ref(false)
const activeTableId = ref('')
const showSqlPreview = ref(false)
const showImportModal = ref(false)
const importSql = ref('')

const newField = ref<DBField>({
  name: '',
  type: 'INT',
  primaryKey: false,
  notNull: false,
  unique: false,
  foreignKey: '',
  comment: '',
})

const fieldTypes = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT',
  'FLOAT', 'DOUBLE', 'DECIMAL',
  'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(200)', 'VARCHAR(255)',
  'TEXT', 'LONGTEXT',
  'DATE', 'DATETIME', 'TIMESTAMP',
  'BOOLEAN', 'BLOB', 'JSON', 'ENUM',
]

watch(() => store.activeProject, (proj) => {
  if (proj) {
    tables.value = proj.db.tables
    nextTick(() => draw())
  }
}, { immediate: true })

function generateId() { return store.generateId('db') }

// ====== Drawing ======
const ENTITY_W = 130
const ENTITY_H = 50
const BASE_ATTR_RX = 58
const BASE_ATTR_RY = 20

function draw() {
  if (!canvasRef.value || !ctx) return
  const W = canvasRef.value.width
  const H = canvasRef.value.height
  ctx.clearRect(0, 0, W, H)

  ctx.save()
  ctx.translate(panX.value, panY.value)

  // Draw grid
  ctx.save()
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.05)'
  ctx.lineWidth = 1
  const step = 40
  const gx0 = -panX.value - step
  const gy0 = -panY.value - step
  const gx1 = W - panX.value + step
  const gy1 = H - panY.value + step
  for (let x = Math.floor(gx0 / step) * step; x < gx1; x += step) { ctx.beginPath(); ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); ctx.stroke() }
  for (let y = Math.floor(gy0 / step) * step; y < gy1; y += step) { ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke() }
  ctx.restore()

  // Draw each table with its fields
  for (const table of tables.value) {
    drawTableEntity(table)
  }

  ctx.restore()
}

// Calculate ellipse edge intersection point from an external point
function getEllipseEdge(cx: number, cy: number, rx: number, ry: number, fromX: number, fromY: number): { x: number; y: number } {
  const dx = fromX - cx
  const dy = fromY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy - ry }
  const angle = Math.atan2(dy, dx)
  return {
    x: cx + rx * Math.cos(angle),
    y: cy + ry * Math.sin(angle),
  }
}

function drawTableEntity(table: DBTable) {
  if (!ctx) return
  const { x, y } = table
  const isSelected = selectedTable.value?.id === table.id
  const count = table.fields.length
  const attrRX = count > 8 ? 48 : BASE_ATTR_RX
  const attrRY = count > 8 ? 17 : BASE_ATTR_RY

  // Calculate attribute positions (fan layout above entity)
  const attrPositions = getFieldPositions(table)

  // Draw lines from entity border to attribute ellipse edges
  ctx.save()
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = lineWidth.value
  const hw = ENTITY_W / 2
  const hh = ENTITY_H / 2
  for (const pos of attrPositions) {
    // Compute intersection of line (center → attr) with rectangle border
    const dx = pos.x - x
    const dy = pos.y - y
    if (dx === 0 && dy === 0) continue
    // Scale to reach rectangle edge
    const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity
    const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity
    const s = Math.min(sx, sy)
    const edgeX = x + dx * s
    const edgeY = y + dy * s
    // Compute intersection with ellipse border (line ends at ellipse edge, not center)
    const ellipseEdge = getEllipseEdge(pos.x, pos.y, attrRX, attrRY, x, y)
    ctx.beginPath()
    ctx.moveTo(edgeX, edgeY)
    ctx.lineTo(ellipseEdge.x, ellipseEdge.y)
    ctx.stroke()
  }
  ctx.restore()

  // Draw attribute ellipses
  for (let i = 0; i < table.fields.length; i++) {
    const pos = attrPositions[i]!
    const field = table.fields[i]!
    drawAttribute(pos.x, pos.y, field, isSelected, attrRX, attrRY, table.bgColor)
  }

  // Draw entity rectangle
  ctx.save()
  ctx.beginPath()
  ctx.rect(x - ENTITY_W / 2, y - ENTITY_H / 2, ENTITY_W, ENTITY_H)
  ctx.fillStyle = isSelected ? 'rgba(167, 139, 250, 0.12)' : (table.bgColor || '#ffffff')
  ctx.fill()
  ctx.strokeStyle = isSelected ? '#a78bfa' : '#1e293b'
  ctx.lineWidth = isSelected ? borderWidth.value + 1 : borderWidth.value
  ctx.stroke()

  // Entity label
  ctx.fillStyle = '#1e293b'
  ctx.font = `bold ${entityFontSize.value}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(table.name, x, y, ENTITY_W - 12)
  ctx.restore()
}

function getFieldPositions(table: DBTable): { x: number; y: number }[] {
  const { x, y, fields } = table
  const count = fields.length
  if (count === 0) return []

  // Dynamic radius: grows with field count to avoid overlap
  const radius = 110 + count * 18
  // Wide fan: nearly full semicircle above (-170° to -10°)
  const startAngle = -170 * (Math.PI / 180)
  const endAngle = -10 * (Math.PI / 180)
  const angleStep = count > 1 ? (endAngle - startAngle) / (count - 1) : 0

  const positions: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const angle = count > 1 ? startAngle + i * angleStep : -Math.PI / 2
    const baseX = x + radius * Math.cos(angle)
    const baseY = y + radius * Math.sin(angle)
    positions.push({
      x: baseX + (fields[i]!.offsetX || 0),
      y: baseY + (fields[i]!.offsetY || 0),
    })
  }
  return positions
}

function drawAttribute(cx: number, cy: number, field: DBField, tableSelected: boolean, rx: number, ry: number, bgColor?: string) {
  if (!ctx) return
  const label = field.displayName || field.comment || field.name

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = tableSelected ? 'rgba(167, 139, 250, 0.08)' : (bgColor || '#ffffff')
  ctx.fill()
  ctx.strokeStyle = tableSelected ? '#a78bfa' : '#1e293b'
  ctx.lineWidth = tableSelected ? borderWidth.value + 0.5 : borderWidth.value
  ctx.stroke()

  ctx.fillStyle = '#1e293b'
  ctx.font = `${attrFontSize.value}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx, cy, rx * 2 - 10)

  // PK underline
  if (field.primaryKey) {
    const textW = Math.min(ctx.measureText(label).width, rx * 2 - 10)
    ctx.beginPath()
    ctx.moveTo(cx - textW / 2, cy + 8)
    ctx.lineTo(cx + textW / 2, cy + 8)
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.restore()
}

// ====== Interaction ======
function toWorldCoords(e: MouseEvent): { mx: number; my: number } {
  if (!canvasRef.value) return { mx: 0, my: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    mx: e.clientX - rect.left - panX.value,
    my: e.clientY - rect.top - panY.value,
  }
}

function hitTestAttr(mx: number, my: number): { table: DBTable; fieldIdx: number } | null {
  for (let i = tables.value.length - 1; i >= 0; i--) {
    const t = tables.value[i]!
    const count = t.fields.length
    const attrRX = count > 8 ? 48 : BASE_ATTR_RX
    const attrRY = count > 8 ? 17 : BASE_ATTR_RY
    const positions = getFieldPositions(t)
    for (let j = positions.length - 1; j >= 0; j--) {
      const pos = positions[j]!
      const dx = (mx - pos.x) / attrRX
      const dy = (my - pos.y) / attrRY
      if (dx * dx + dy * dy <= 1) return { table: t, fieldIdx: j }
    }
  }
  return null
}

function hitTestEntity(mx: number, my: number): DBTable | null {
  for (let i = tables.value.length - 1; i >= 0; i--) {
    const t = tables.value[i]!
    if (mx >= t.x - ENTITY_W / 2 && mx <= t.x + ENTITY_W / 2 &&
        my >= t.y - ENTITY_H / 2 && my <= t.y + ENTITY_H / 2) {
      return t
    }
  }
  return null
}

function onMouseDown(e: MouseEvent) {
  if (!canvasRef.value) return

  // Right-click or middle-click → start panning
  if (e.button === 1 || e.button === 2) {
    e.preventDefault()
    panning.value = true
    panStart.value = { x: e.clientX - panX.value, y: e.clientY - panY.value }
    return
  }

  const { mx, my } = toWorldCoords(e)

  if (selectedTool.value === 'select') {
    // Check attribute ellipses first
    const attrHit = hitTestAttr(mx, my)
    if (attrHit) {
      selectedTable.value = attrHit.table
      draggingAttr.value = attrHit
      dragOffset.value = { x: mx, y: my }
      draw()
      return
    }
    // Then check entity rectangles
    const hit = hitTestEntity(mx, my)
    selectedTable.value = hit
    if (hit) {
      dragging.value = true
      dragOffset.value = { x: mx - hit.x, y: my - hit.y }
    }
    draw()
  } else if (selectedTool.value === 'table') {
    showAddTableModal.value = true
    dragOffset.value = { x: mx, y: my }
  }
}

function onMouseMove(e: MouseEvent) {
  if (!canvasRef.value) return

  // Panning
  if (panning.value) {
    panX.value = e.clientX - panStart.value.x
    panY.value = e.clientY - panStart.value.y
    draw()
    return
  }

  const { mx, my } = toWorldCoords(e)

  // Dragging attribute ellipse
  if (draggingAttr.value) {
    const field = draggingAttr.value.table.fields[draggingAttr.value.fieldIdx]
    if (field) {
      const deltaX = mx - dragOffset.value.x
      const deltaY = my - dragOffset.value.y
      field.offsetX = (field.offsetX || 0) + deltaX
      field.offsetY = (field.offsetY || 0) + deltaY
      dragOffset.value = { x: mx, y: my }
      draw()
    }
    return
  }

  // Dragging entity
  if (dragging.value && selectedTable.value) {
    selectedTable.value.x = mx - dragOffset.value.x
    selectedTable.value.y = my - dragOffset.value.y
    draw()
  }
}

function onMouseUp() {
  if (panning.value) {
    panning.value = false
    return
  }
  if (draggingAttr.value) {
    draggingAttr.value = null
    autoSave()
    return
  }
  if (dragging.value) {
    dragging.value = false
    autoSave()
  }
}

function onContextMenu(e: Event) {
  e.preventDefault()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedTable.value && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
      deleteTable(selectedTable.value.id)
    }
  }
  if (e.key === 'Escape') {
    selectedTable.value = null
    selectedTool.value = 'select'
    draw()
  }
}

// ====== Table / Field CRUD ======
function addTable() {
  const name = newTableName.value.trim() || '新表'
  const table: DBTable = {
    id: generateId(),
    name,
    fields: [
      { name: 'id', type: 'BIGINT', primaryKey: true, notNull: true, unique: false, foreignKey: '', comment: '主键' }
    ],
    x: selectedTool.value === 'table' ? dragOffset.value.x : 200 + tables.value.length * 60,
    y: selectedTool.value === 'table' ? dragOffset.value.y : 250,
  }
  tables.value.push(table)
  newTableName.value = ''
  showAddTableModal.value = false
  selectedTool.value = 'select'
  draw()
  autoSave()
}

function deleteTable(id: string) {
  tables.value = tables.value.filter(t => t.id !== id)
  selectedTable.value = null
  draw()
  autoSave()
}

function openAddField(tableId: string) {
  activeTableId.value = tableId
  newField.value = { name: '', type: 'INT', primaryKey: false, notNull: false, unique: false, foreignKey: '', comment: '' }
  showAddFieldModal.value = true
}

function addField() {
  const table = tables.value.find(t => t.id === activeTableId.value)
  if (table && newField.value.name.trim()) {
    table.fields.push({ ...newField.value, name: newField.value.name.trim() })
    showAddFieldModal.value = false
    draw()
    autoSave()
  }
}

function deleteField(tableId: string, fieldIdx: number) {
  const table = tables.value.find(t => t.id === tableId)
  if (table) {
    table.fields.splice(fieldIdx, 1)
    draw()
    autoSave()
  }
}

function updateField(field: DBField, key: keyof DBField, value: any) {
  (field as any)[key] = value
  // Sync displayName from comment when comment changes
  if (key === 'comment') {
    field.displayName = value || undefined
  }
  draw()
  autoSave()
}

function clearAll() {
  if (tables.value.length === 0) return
  if (!confirm('确定要清空所有实体图元素吗？此操作不可撤销。')) return
  tables.value = []
  selectedTable.value = null
  draw()
  autoSave()
}

// ====== SQL ======
const generatedSql = computed(() => {
  let sql = ''
  for (const table of tables.value) {
    sql += `CREATE TABLE IF NOT EXISTS \`${table.name}\` (\n`
    const lines: string[] = []
    const pks: string[] = []
    for (const field of table.fields) {
      let line = `  \`${field.name}\` ${field.type}`
      if (field.primaryKey && /^(INT|BIGINT|SMALLINT|TINYINT)/i.test(field.type)) {
        line += ' NOT NULL AUTO_INCREMENT'
      } else if (field.notNull) {
        line += ' NOT NULL'
      }
      if (field.unique) line += ' UNIQUE'
      if (field.primaryKey) pks.push(field.name)
      if (field.comment) line += ` COMMENT '${field.comment}'`
      lines.push(line)
    }
    if (pks.length > 0) {
      lines.push(`  PRIMARY KEY (${pks.map(k => '`' + k + '`').join(', ')})`)
    }
    sql += lines.join(',\n')
    sql += '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n'
  }
  return sql
})

function parseImportSql() {
  let sql = importSql.value.trim()
  if (!sql) return

  sql = sql.replace(/--[^\n]*/g, '')
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, '')

  const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?(\w+)`?\.)?`?(\w+)`?\s*\(/gi
  let crMatch

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

  let tblIdx = 0

  while ((crMatch = createRegex.exec(sql)) !== null) {
    const tableName = crMatch[2] || crMatch[1] || ''
    const startIdx = crMatch.index + crMatch[0].length
    let depth = 1
    let i = startIdx
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++
      else if (sql[i] === ')') depth--
      i++
    }
    if (depth !== 0) continue
    const body = sql.substring(startIdx, i - 1)

    const fieldLines = splitFields(body)
    const fields: DBField[] = []
    const pkFields: string[] = []

    for (const line of fieldLines) {
      const pkMatch = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
      if (pkMatch && pkMatch[1]) {
        pkMatch[1].split(',').forEach(f => pkFields.push(f.replace(/`/g, '').trim()))
      }
    }

    for (const line of fieldLines) {
      if (/^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s+KEY|UNIQUE\s+INDEX|INDEX|KEY\s+\w|CONSTRAINT|CHECK)/i.test(line)) continue

      const fieldMatch = line.match(/^`?(\w+)`?\s+(\w+(?:\([^)]*\))?)/i)
      if (fieldMatch && fieldMatch[1] && fieldMatch[2]) {
        const fName = fieldMatch[1]
        const fType = fieldMatch[2].toUpperCase()
        const isPK = /PRIMARY\s+KEY/i.test(line) || pkFields.includes(fName)
        const isNotNull = /NOT\s+NULL/i.test(line) || isPK
        const isUnique = /UNIQUE/i.test(line)
        const commentMatch = line.match(/COMMENT\s+'([^']*)'/i)
        const comment = commentMatch?.[1] ?? ''

        fields.push({
          name: fName,
          type: fType,
          primaryKey: isPK,
          notNull: isNotNull,
          unique: isUnique,
          foreignKey: '',
          comment,
          displayName: comment || undefined,
        })
      }
    }

    const col = tblIdx % 3
    const row = Math.floor(tblIdx / 3)
    const table: DBTable = {
      id: generateId(),
      name: tableName,
      fields: fields.length > 0 ? fields : [{ name: 'id', type: 'INT', primaryKey: true, notNull: true, unique: false, foreignKey: '', comment: '' }],
      x: 200 + col * 400,
      y: 280 + row * 420,
    }
    tables.value.push(table)
    tblIdx++
  }

  showImportModal.value = false
  importSql.value = ''
  draw()
  autoSave()
}

function copySql() {
  navigator.clipboard.writeText(generatedSql.value).then(() => {})
}

function autoSave() {
  if (store.activeProject) {
    store.activeProject.db.tables = tables.value
  }
}

function resizeCanvas() {
  if (!canvasRef.value) return
  const container = canvasRef.value.parentElement!
  canvasRef.value.width = container.clientWidth
  canvasRef.value.height = container.clientHeight
  draw()
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
      <div class="toolbar-header"><h3>数据库实体图</h3></div>
      <div class="toolbar-content">
        <div class="toolbar-section">
          <div class="toolbar-section-title">工具</div>
          <button class="tool-btn" :class="{ active: selectedTool === 'select' }" @click="selectedTool = 'select'">
            <span class="tool-icon">🖱️</span> 选择
          </button>
          <button class="tool-btn" :class="{ active: selectedTool === 'table' }" @click="selectedTool = 'table'">
            <span class="tool-icon">📋</span> 添加表
          </button>
        </div>

        <div class="toolbar-section">
          <div class="toolbar-section-title">操作</div>
          <button class="btn btn-secondary btn-sm" @click="showImportModal = true" style="width: 100%; margin-bottom: 6px;">📝 导入 SQL</button>
          <button class="btn btn-secondary btn-sm" @click="showSqlPreview = true" style="width: 100%; margin-bottom: 6px;">📋 生成 SQL</button>
          <button class="btn btn-danger btn-sm" @click="clearAll" style="width: 100%;">🗑️ 一键清空</button>
          <p style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">右键拖拽可平移画布</p>
        </div>

        <div class="toolbar-section">
          <div class="toolbar-section-title">样式设置</div>
          <div class="style-control">
            <label class="style-label">连线粗细 <span class="style-value">{{ lineWidth.toFixed(1) }}</span></label>
            <input type="range" class="style-slider" v-model.number="lineWidth" min="0.5" max="5" step="0.5" @input="draw()" />
          </div>
          <div class="style-control">
            <label class="style-label">框线粗细 <span class="style-value">{{ borderWidth.toFixed(1) }}</span></label>
            <input type="range" class="style-slider" v-model.number="borderWidth" min="0.5" max="5" step="0.5" @input="draw()" />
          </div>
          <div class="style-control">
            <label class="style-label">实体字号 <span class="style-value">{{ entityFontSize }}px</span></label>
            <input type="range" class="style-slider" v-model.number="entityFontSize" min="10" max="22" step="1" @input="draw()" />
          </div>
          <div class="style-control">
            <label class="style-label">属性字号 <span class="style-value">{{ attrFontSize }}px</span></label>
            <input type="range" class="style-slider" v-model.number="attrFontSize" min="8" max="18" step="1" @input="draw()" />
          </div>
        </div>

        <!-- Selected Table Properties + Field Editing -->
        <div class="toolbar-section" v-if="selectedTable && selectedTool === 'select'">
          <div class="toolbar-section-title">表属性: {{ selectedTable.name }}</div>
          <div class="form-group">
            <label class="form-label">表名</label>
            <input class="form-input" :value="selectedTable.name" @change="(e: any) => { selectedTable!.name = e.target.value; draw(); autoSave() }" />
          </div>
          <div class="form-group">
            <label class="form-label">背景颜色</label>
            <div class="color-picker-row">
              <input type="color" class="color-input" :value="selectedTable.bgColor || '#ffffff'" @input="(e: any) => { selectedTable!.bgColor = e.target.value; draw(); autoSave() }" />
              <span class="color-value">{{ selectedTable.bgColor || '#ffffff' }}</span>
              <button v-if="selectedTable.bgColor" class="btn btn-ghost btn-xs" @click="selectedTable!.bgColor = undefined; draw(); autoSave()" title="重置">↺</button>
            </div>
          </div>

          <div class="toolbar-section-title" style="margin-top: 10px;">字段编辑</div>
          <div class="field-edit-list">
            <div class="field-edit-item" v-for="(field, idx) in selectedTable.fields" :key="idx">
              <div class="field-edit-header">
                <span class="field-idx">{{ idx + 1 }}</span>
                <button class="field-del" @click="deleteField(selectedTable!.id, idx)" title="删除字段">✕</button>
              </div>
              <div class="field-edit-row">
                <input class="field-edit-input" :value="field.name" @change="(e: any) => updateField(field, 'name', e.target.value)" placeholder="字段名" />
                <select class="field-edit-select" :value="field.type" @change="(e: any) => updateField(field, 'type', e.target.value)">
                  <option v-for="t in fieldTypes" :key="t" :value="t">{{ t }}</option>
                </select>
              </div>
              <div class="field-edit-row">
                <input class="field-edit-input" :value="field.comment" @change="(e: any) => updateField(field, 'comment', e.target.value)" placeholder="备注 (COMMENT)" />
              </div>
              <div class="field-edit-checks">
                <label><input type="checkbox" :checked="field.primaryKey" @change="updateField(field, 'primaryKey', !field.primaryKey)" /> PK</label>
                <label><input type="checkbox" :checked="field.notNull" @change="updateField(field, 'notNull', !field.notNull)" /> NN</label>
                <label><input type="checkbox" :checked="field.unique" @change="updateField(field, 'unique', !field.unique)" /> UQ</label>
              </div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="openAddField(selectedTable.id)" style="width: 100%; margin-top: 8px;">＋ 添加字段</button>
          <button class="btn btn-danger btn-sm" @click="deleteTable(selectedTable.id)" style="width: 100%; margin-top: 6px;">删除表</button>
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
        :class="{ crosshair: selectedTool === 'table', pointer: selectedTool === 'select' }"
      ></canvas>
      <div class="canvas-hint" v-if="tables.length === 0">
        <p>点击左侧「添加表」或「导入 SQL」开始绘制</p>
      </div>
    </div>

    <!-- Add Table Modal -->
    <div class="modal-overlay" v-if="showAddTableModal" @click.self="showAddTableModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>添加数据表</h3>
          <button class="btn btn-ghost btn-icon" @click="showAddTableModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">表名</label>
            <input class="form-input" v-model="newTableName" placeholder="例如: t_user" @keyup.enter="addTable" autofocus />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showAddTableModal = false">取消</button>
          <button class="btn btn-primary" @click="addTable">创建</button>
        </div>
      </div>
    </div>

    <!-- Add Field Modal -->
    <div class="modal-overlay" v-if="showAddFieldModal" @click.self="showAddFieldModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>添加字段</h3>
          <button class="btn btn-ghost btn-icon" @click="showAddFieldModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">字段名</label>
            <input class="form-input" v-model="newField.name" placeholder="例如: username" @keyup.enter="addField" autofocus />
          </div>
          <div class="form-group">
            <label class="form-label">类型</label>
            <select class="form-select" v-model="newField.type">
              <option v-for="t in fieldTypes" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">备注 (COMMENT)</label>
            <input class="form-input" v-model="newField.comment" placeholder="中文描述，如'用户主键 ID'" />
          </div>
          <div class="checkbox-group">
            <label><input type="checkbox" v-model="newField.primaryKey" /> 主键</label>
            <label><input type="checkbox" v-model="newField.notNull" /> NOT NULL</label>
            <label><input type="checkbox" v-model="newField.unique" /> UNIQUE</label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showAddFieldModal = false">取消</button>
          <button class="btn btn-primary" @click="addField">添加</button>
        </div>
      </div>
    </div>

    <!-- SQL Preview Modal -->
    <div class="modal-overlay" v-if="showSqlPreview" @click.self="showSqlPreview = false">
      <div class="modal" style="min-width: 560px;">
        <div class="modal-header">
          <h3>生成的 SQL 语句</h3>
          <button class="btn btn-ghost btn-icon" @click="showSqlPreview = false">✕</button>
        </div>
        <div class="modal-body">
          <pre class="sql-preview">{{ generatedSql || '-- 暂无数据表' }}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="copySql">📋 复制</button>
          <button class="btn btn-primary" @click="showSqlPreview = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- Import SQL Modal -->
    <div class="modal-overlay" v-if="showImportModal" @click.self="showImportModal = false">
      <div class="modal" style="min-width: 520px;">
        <div class="modal-header">
          <h3>导入 SQL 语句</h3>
          <button class="btn btn-ghost btn-icon" @click="showImportModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">粘贴 CREATE TABLE 语句</label>
            <textarea class="form-textarea sql-input" v-model="importSql" placeholder="CREATE TABLE IF NOT EXISTS t_user (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT '用户主键 ID',
  ...
);" rows="10"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showImportModal = false">取消</button>
          <button class="btn btn-primary" @click="parseImportSql">解析并导入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-layout { display: flex; width: 100%; height: 100%; }

.toolbar {
  width: 260px;
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

.tool-btn {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer;
  font-size: 13px; color: var(--text-secondary); background: transparent;
  border: 1px solid transparent; transition: all var(--transition-fast);
  font-family: inherit; margin-bottom: 4px;
}
.tool-btn:hover { color: var(--text-primary); background: rgba(99, 102, 241, 0.08); }
.tool-btn.active { color: var(--accent-tertiary); background: rgba(99, 102, 241, 0.12); border-color: var(--border-hover); }
.tool-icon { font-size: 16px; width: 22px; text-align: center; flex-shrink: 0; }

.canvas-container { flex: 1; position: relative; overflow: hidden; background: #ffffff; }
.canvas-container canvas { display: block; cursor: default; }
.canvas-container canvas.crosshair { cursor: crosshair; }
.canvas-container canvas.pointer { cursor: pointer; }
.canvas-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(241, 245, 249, 0.9); backdrop-filter: blur(8px); border: 1px solid #e2e8f0; border-radius: var(--radius-md); padding: 16px 24px; pointer-events: none; }
.canvas-hint p { font-size: 13px; color: #64748b; }

/* Field editing */
.field-edit-list { max-height: 350px; overflow-y: auto; }
.field-edit-item {
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  background: rgba(99, 102, 241, 0.03);
}
.field-edit-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.field-idx { font-size: 10px; font-weight: 700; color: var(--text-muted); }
.field-del {
  border: none; background: none; color: var(--text-muted);
  cursor: pointer; font-size: 11px; padding: 1px 4px; opacity: 0.5;
  transition: opacity var(--transition-fast);
}
.field-del:hover { opacity: 1; color: var(--danger); }
.field-edit-row { display: flex; gap: 4px; margin-bottom: 4px; }
.field-edit-input {
  flex: 1; min-width: 0; padding: 3px 6px; font-size: 11px;
  background: var(--bg-primary); border: 1px solid var(--border-color);
  border-radius: 3px; color: var(--text-primary); font-family: inherit;
}
.field-edit-input:focus { outline: none; border-color: var(--accent-tertiary); }
.field-edit-select {
  width: 90px; padding: 3px 4px; font-size: 10px; font-family: monospace;
  background: var(--bg-primary); border: 1px solid var(--border-color);
  border-radius: 3px; color: var(--text-primary);
}
.field-edit-checks {
  display: flex; gap: 8px; font-size: 10px; color: var(--text-secondary);
}
.field-edit-checks label { display: flex; align-items: center; gap: 2px; cursor: pointer; }
.field-edit-checks input[type="checkbox"] { margin: 0; }

/* Style controls */
.style-control { margin-bottom: 10px; }
.style-label {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;
}
.style-value {
  font-weight: 600; color: var(--accent-tertiary); font-size: 11px;
  min-width: 32px; text-align: right;
}
.style-slider {
  width: 100%; height: 4px; -webkit-appearance: none; appearance: none;
  background: var(--border-color); border-radius: 2px; outline: none;
  cursor: pointer;
}
.style-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent-tertiary); border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.18); cursor: pointer;
}
.style-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent-tertiary); border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.18); cursor: pointer;
}

.checkbox-group { display: flex; gap: 16px; flex-wrap: wrap; }
.checkbox-group label { display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }

.sql-preview {
  background: var(--bg-primary); border: 1px solid var(--border-color);
  border-radius: var(--radius-sm); padding: 16px; color: #a5f3fc;
  font-family: 'Consolas', 'Fira Code', monospace; font-size: 12px;
  line-height: 1.6; overflow: auto; max-height: 400px; white-space: pre-wrap;
}

.sql-input {
  font-family: 'Consolas', 'Fira Code', monospace !important;
  color: #a5f3fc !important;
  background: var(--bg-primary) !important;
  min-height: 180px; line-height: 1.6;
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
