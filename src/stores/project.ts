import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface Position { x: number; y: number }

// ====== Use Case Diagram types ======
export type UCNodeType = 'actor' | 'usecase' | 'boundary'
export interface UCNode {
    id: string
    type: UCNodeType
    label: string
    x: number
    y: number
    width: number
    height: number
    color?: string
    bgColor?: string
}
export type UCRelationType = 'association' | 'include' | 'extend' | 'generalization'
export interface UCRelation {
    id: string
    type: UCRelationType
    fromId: string
    toId: string
    color?: string
    lineWidth?: number
}

// ====== ER Diagram types ======
export type ERNodeType = 'entity' | 'attribute' | 'relationship'
export interface ERNode {
    id: string
    type: ERNodeType
    label: string
    x: number
    y: number
    isPrimaryKey?: boolean
    isMultiValued?: boolean
    color?: string
}
export type ERCardinality = '1:1' | '1:N' | 'M:N' | '1' | 'N' | 'M'
export interface ERLink {
    id: string
    fromId: string
    toId: string
    cardinality?: ERCardinality
}

// ====== DB Entity types ======
export interface DBField {
    name: string
    type: string
    primaryKey: boolean
    notNull: boolean
    unique: boolean
    foreignKey: string  // e.g. 'table_name.field_name' or ''
    comment: string
    displayName?: string  // COMMENT 提取的中文名
    offsetX?: number      // 属性椭圆拖拽偏移
    offsetY?: number
}
export interface DBTable {
    id: string
    name: string
    fields: DBField[]
    x: number
    y: number
    bgColor?: string
}
export interface DBRelation {
    id: string
    fromTable: string
    fromField: string
    toTable: string
    toField: string
    type: '1:1' | '1:N' | 'M:N'
}

// ====== Function Structure types ======
export interface FuncNode {
    id: string
    label: string
    children: FuncNode[]
}

// ====== Project ======
export interface Project {
    id: string
    name: string
    createdAt: string
    updatedAt: string
    usecase: { nodes: UCNode[]; relations: UCRelation[] }
    er: { nodes: ERNode[]; links: ERLink[] }
    db: { tables: DBTable[]; relations: DBRelation[] }
    funcStruct: { nodes: FuncNode[] }
}

const STORAGE_KEY = 'swiftdesign_projects'
const ACTIVE_KEY = 'swiftdesign_active_project'

function generateId(prefix = 'n') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

function loadProjects(): Record<string, Project> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : {}
    } catch { return {} }
}

function persistProjects(projects: Record<string, Project>) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

export const useProjectStore = defineStore('project', () => {
    const projects = ref<Record<string, Project>>(loadProjects())
    const activeProjectId = ref<string>(localStorage.getItem(ACTIVE_KEY) || '')
    const activeProject = ref<Project | null>(null)

    // Load active project on init
    if (activeProjectId.value && projects.value[activeProjectId.value]) {
        activeProject.value = projects.value[activeProjectId.value]!
    }

    function createProject(name: string): Project {
        const project: Project = {
            id: generateId('proj'),
            name: name || '未命名项目',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            usecase: { nodes: [], relations: [] },
            er: { nodes: [], links: [] },
            db: { tables: [], relations: [] },
            funcStruct: { nodes: [] },
        }
        projects.value[project.id] = project
        activeProjectId.value = project.id
        activeProject.value = project
        localStorage.setItem(ACTIVE_KEY, project.id)
        persistProjects(projects.value)
        return project
    }

    function switchProject(id: string) {
        if (projects.value[id]) {
            activeProjectId.value = id
            activeProject.value = projects.value[id]!
            localStorage.setItem(ACTIVE_KEY, id)
        }
    }

    function deleteProject(id: string) {
        delete projects.value[id]
        if (activeProjectId.value === id) {
            const remaining = Object.keys(projects.value)
            if (remaining.length > 0) {
                switchProject(remaining[0]!)
            } else {
                activeProjectId.value = ''
                activeProject.value = null
                localStorage.removeItem(ACTIVE_KEY)
            }
        }
        persistProjects(projects.value)
    }

    function saveCurrentProject() {
        if (activeProject.value) {
            activeProject.value.updatedAt = new Date().toISOString()
            projects.value[activeProject.value.id] = activeProject.value
            persistProjects(projects.value)
        }
    }

    function exportProject(project: Project) {
        const json = JSON.stringify(project, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${project.name}_${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    function importProject(): Promise<Project> {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.json'
            input.onchange = (e: Event) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (!file) return reject(new Error('未选择文件'))
                const reader = new FileReader()
                reader.onload = (ev) => {
                    try {
                        const project = JSON.parse(ev.target?.result as string) as Project
                        project.id = generateId('proj')
                        projects.value[project.id] = project
                        switchProject(project.id)
                        persistProjects(projects.value)
                        resolve(project)
                    } catch { reject(new Error('无效的 JSON 文件')) }
                }
                reader.readAsText(file)
            }
            input.click()
        })
    }

    // Auto-save debounce
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    watch(activeProject, () => {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => saveCurrentProject(), 1000)
    }, { deep: true })

    return {
        projects,
        activeProjectId,
        activeProject,
        createProject,
        switchProject,
        deleteProject,
        saveCurrentProject,
        exportProject,
        importProject,
        generateId,
    }
})
