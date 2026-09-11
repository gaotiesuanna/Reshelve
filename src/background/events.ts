import type { Request, Response } from './messages'

/** 侧栏与 service worker 之间推送任务动态的长连接名。 */
export const PROGRESS_PORT = 'reshelve:progress'

export type ProgressPhase = 'scan' | 'tags' | 'tree' | 'classify' | 'apply' | 'undo' | 'import' | 'cleanup'

/**
 * 值是 _locales 里的词条键，不是文案——events.ts 要保持零依赖，由渲染方 t() 取文案。
 *
 * 写成 `as const satisfies` 而不是标注成 `Record<ProgressPhase, string>`：后者会把值
 * 拓宽成 string，t() 收 MessageKey 就传不进去了。这样既留住字面量类型（键名写错时
 * 渲染方的 t() 编译期报错），又保住「ProgressPhase 每个取值都得有」这条穷尽检查，
 * 还不用 import i18n。
 */
export const PHASE_LABELS = {
  scan: 'phaseScan',
  tags: 'phaseTags',
  tree: 'phaseTree',
  classify: 'phaseClassify',
  apply: 'phaseApply',
  undo: 'phaseUndo',
  import: 'phaseImport',
  cleanup: 'phaseCleanup',
} as const satisfies Record<ProgressPhase, string>

export interface ProgressEvent {
  phase: ProgressPhase
  /** 空字符串表示只更新进度条，不写日志。 */
  message: string
  level?: 'info' | 'warn' | 'error'
  done?: number
  total?: number
}

export type EmitProgress = (event: ProgressEvent) => void

/**
 * 后台任务的生命周期状态。
 *
 * running → cancelling 是用户点了取消；终态四选一：
 * done（正常收尾）/ error（失败）/ cancelled（用户取消后收尾）/ interrupted
 * （SW 被浏览器回收或扩展重载，冷启动自愈时补写的结论）。
 */
export type TaskStatus = 'running' | 'cancelling' | 'done' | 'error' | 'cancelled' | 'interrupted'

/**
 * 「当前任务」的完整记录——任务在后台的**事实来源**，落在 chrome.storage.session
 * 里（见 task-journal.ts）。侧栏开与关都改变不了它：面板从「任务所有者」降级为
 * 「任务观察者」，随时凭 get_task 把这份记录接回界面。
 */
export interface TaskRecord {
  id: string
  kind: Request['kind']
  startedAt: number
  status: TaskStatus
  /** 取消按钮给不给按：analyze / classify_structure / check_links / reclassify 之外都不给（与 CANCELLABLE 一致）。 */
  cancellable: boolean
  /**
   * 最近的事件环形缓冲，上限见 task-journal 的 MAX_TASK_EVENTS。
   *
   * 半路打开的侧栏靠它把日志与进度条接回当前位置，不必从空屏猜。
   */
  events: ProgressEvent[]
  /** done 时的完整响应载荷（analyze 的 plan 就在这里）。error/cancelled 等态不填。 */
  result?: Response
  /** error 时的失败说明。 */
  error?: string
  finishedAt?: number
}

/**
 * 任务长连接上的三类消息。进度事件包一层而不是裸发，是为了让「某轮任务开始了 /
 * 结束了」这类结构化通知与普通进度共用同一条通道——多开一个 connect 名只会多一份样板。
 */
export type TaskStreamMessage =
  | { kind: 'started'; record: TaskRecord }
  | { kind: 'progress'; event: ProgressEvent }
  | { kind: 'finished'; record: TaskRecord }
