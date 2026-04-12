/**
 * squan-fs: Everything-as-Code for Squan.
 *
 * The .squan/ directory in each project is the source of truth for:
 * - Tasks (kanban board)
 * - Charters (agent knowledge)
 * - Templates (reusable task descriptions)
 * - Docs (project documentation)
 * - Security (audit trail)
 *
 * SQLite is used as a fast read cache, rebuilt from files on startup.
 */

export { hasSquanDir, readSquanDir, readBoard, readConfig, readCharters, readTemplates, readDocs, readSecurity } from './reader.js'
export { initSquanDir, writeTask, moveTask, deleteTask, writeCharter, writeTemplate, deleteTemplate, writeDoc, writeSecurity, writeConfig } from './writer.js'
export { initAndSync, fullSync, createTask, updateTaskStatus, removeTask, updateCharter, createTemplate, removeTemplate, stopWatching } from './cache-sync.js'
export { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
export type { TaskMeta, TaskStatus, TaskType, TaskFile, SquanConfig, CharterFile, TemplateMeta, TemplateFile, DocFile, SecurityFile, SquanDirState } from './types.js'
