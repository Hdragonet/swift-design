<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useProjectStore } from './stores/project'

const store = useProjectStore()
const route = useRoute()
const router = useRouter()

const showProjectModal = ref(false)
const newProjectName = ref('')
const showProjectList = ref(false)
const toasts = ref<{ id: number; type: string; message: string }[]>([])

const tabs = [
  { name: '用例图', icon: '👤', route: '/usecase' },
  { name: 'ER 图', icon: '🔗', route: '/er' },
  { name: '数据库实体图', icon: '🗃️', route: '/db' },
  { name: '功能结构图', icon: '🏗️', route: '/func' },
]

const currentTab = computed(() => route.path)
const projectList = computed(() => Object.values(store.projects))

function switchTab(path: string) {
  router.push(path)
}

function showToast(type: string, message: string) {
  const id = Date.now()
  toasts.value.push({ id, type, message })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 3000)
}

function createProject() {
  const name = newProjectName.value.trim() || '未命名项目'
  store.createProject(name)
  newProjectName.value = ''
  showProjectModal.value = false
  showToast('success', `项目 "${name}" 已创建`)
}

function switchProject(id: string) {
  store.switchProject(id)
  showProjectList.value = false
  showToast('info', `已切换到: ${store.activeProject?.name}`)
}

function deleteProject(id: string) {
  const name = store.projects[id]?.name
  store.deleteProject(id)
  showToast('warning', `项目 "${name}" 已删除`)
}

function onExport() {
  if (store.activeProject) {
    store.exportProject(store.activeProject)
    showToast('success', '项目已导出')
  }
}

async function onImport() {
  try {
    const proj = await store.importProject()
    showToast('success', `项目 "${proj.name}" 已导入`)
  } catch (e: any) {
    showToast('error', e.message || '导入失败')
  }
}

function onSave() {
  store.saveCurrentProject()
  showToast('success', '已保存')
}

onMounted(() => {
  if (!store.activeProject) {
    // Auto-create a default project if none exists
    if (Object.keys(store.projects).length === 0) {
      store.createProject('我的第一个项目')
    } else {
      const first = Object.keys(store.projects)[0]!
      store.switchProject(first)
    }
  }
})
</script>

<template>
  <div class="app-shell">
    <!-- Navbar -->
    <nav class="navbar">
      <div class="navbar-brand" @click="showProjectList = !showProjectList">
        <div class="logo">S</div>
        <h1>SwiftDesign</h1>
        <span class="project-name" v-if="store.activeProject">
          · {{ store.activeProject.name }}
          <span class="chevron">▾</span>
        </span>
      </div>

      <div class="navbar-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.route"
          class="navbar-tab"
          :class="{ active: currentTab === tab.route }"
          @click="switchTab(tab.route)"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          {{ tab.name }}
        </button>
      </div>

      <div class="navbar-actions">
        <button class="btn btn-ghost btn-sm" @click="onSave" title="保存">💾 保存</button>
        <button class="btn btn-ghost btn-sm" @click="onExport" title="导出">📤 导出</button>
        <button class="btn btn-ghost btn-sm" @click="onImport" title="导入">📥 导入</button>
        <button class="btn btn-primary btn-sm" @click="showProjectModal = true">＋ 新建项目</button>
      </div>
    </nav>

    <!-- Project Dropdown -->
    <div class="project-dropdown" v-if="showProjectList" @click.self="showProjectList = false">
      <div class="dropdown-panel">
        <div class="dropdown-header">
          <h3>项目列表</h3>
        </div>
        <div class="dropdown-body" v-if="projectList.length > 0">
          <div
            v-for="proj in projectList"
            :key="proj.id"
            class="project-item"
            :class="{ active: proj.id === store.activeProjectId }"
            @click="switchProject(proj.id)"
          >
            <div class="project-item-info">
              <span class="project-item-name">{{ proj.name }}</span>
              <span class="project-item-date">{{ new Date(proj.updatedAt).toLocaleDateString() }}</span>
            </div>
            <button class="btn btn-ghost btn-sm delete-btn" @click.stop="deleteProject(proj.id)">🗑️</button>
          </div>
        </div>
        <div class="dropdown-empty" v-else>
          <p>暂无项目</p>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <main class="main-area">
      <RouterView v-if="store.activeProject" />
      <div class="empty-state" v-else>
        <div class="empty-icon">📐</div>
        <h3>欢迎使用 SwiftDesign</h3>
        <p>创建一个新项目来开始绘制图表</p>
        <button class="btn btn-primary" @click="showProjectModal = true">创建项目</button>
      </div>
    </main>

    <!-- New Project Modal -->
    <div class="modal-overlay" v-if="showProjectModal" @click.self="showProjectModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>新建项目</h3>
          <button class="btn btn-ghost btn-icon" @click="showProjectModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">项目名称</label>
            <input
              class="form-input"
              v-model="newProjectName"
              placeholder="请输入项目名称"
              @keyup.enter="createProject"
              autofocus
            />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showProjectModal = false">取消</button>
          <button class="btn btn-primary" @click="createProject">创建</button>
        </div>
      </div>
    </div>

    <!-- Toast container -->
    <div class="toast-container">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type">
        {{ toast.message }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.navbar {
  height: var(--navbar-height);
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 20px;
  z-index: 100;
  flex-shrink: 0;
  gap: 8px;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.logo {
  width: 30px;
  height: 30px;
  background: var(--accent-gradient);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 15px;
  color: white;
  box-shadow: var(--shadow-glow);
}

.navbar-brand h1 {
  font-size: 16px;
  font-weight: 600;
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.project-name {
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}
.chevron { font-size: 10px; }

.navbar-tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  justify-content: center;
}

.navbar-tab {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--transition-normal);
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  user-select: none;
}
.navbar-tab:hover {
  color: var(--text-primary);
  background: rgba(99, 102, 241, 0.08);
}
.navbar-tab.active {
  color: var(--accent-tertiary);
  background: rgba(99, 102, 241, 0.12);
  border-color: var(--border-hover);
  box-shadow: var(--shadow-glow);
}
.tab-icon { font-size: 15px; }

.navbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.main-area {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: var(--bg-primary);
}

/* Project Dropdown */
.project-dropdown {
  position: fixed;
  inset: 0;
  top: var(--navbar-height);
  z-index: 90;
}

.dropdown-panel {
  position: absolute;
  top: 8px;
  left: 20px;
  width: 320px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: slideUp 0.2s ease;
}

.dropdown-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}
.dropdown-header h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.dropdown-body {
  max-height: 300px;
  overflow-y: auto;
  padding: 4px;
}

.project-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.project-item:hover {
  background: rgba(99, 102, 241, 0.08);
}
.project-item.active {
  background: rgba(99, 102, 241, 0.15);
  border-left: 2px solid var(--accent-primary);
}
.project-item-info { display: flex; flex-direction: column; }
.project-item-name { font-size: 13px; font-weight: 500; }
.project-item-date { font-size: 11px; color: var(--text-muted); }
.delete-btn { opacity: 0; transition: opacity var(--transition-fast); }
.project-item:hover .delete-btn { opacity: 1; }

.dropdown-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}
.empty-state .empty-icon { font-size: 56px; margin-bottom: 16px; opacity: 0.4; }
.empty-state h3 { font-size: 18px; color: var(--text-secondary); margin-bottom: 8px; }
.empty-state p { font-size: 13px; color: var(--text-muted); margin-bottom: 20px; }
</style>
