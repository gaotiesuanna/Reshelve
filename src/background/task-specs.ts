import type { Request } from './messages'
import type { MessageKey } from '@/i18n/messages'

/**
 * 每种请求的运行政策，两个进程共读这一张表。
 *
 * 以前这些政策散在五处平行表里（worker 的 EXCLUSIVE / CANCELLABLE、侧栏的
 * BUSY_KIND_BY_TASK / BUSY_LABEL_BY_TASK、adoptRunningTask 的 kind 映射），全都
 * 靠同一个 kind 字符串人肉对齐——漏登一行的错误编译器看不见，只能在运行时露馅。
 * 收进来之后：新增 kind 必须在这里登记一行（Record 全量约束），政策只此一份。
 *
 * 行里三个字段的口径：
 * - exclusive：动全局单例（任务槽、书签树、分类缓存、任务日志），两个窗口同时跑
 *   会互相覆盖或交错，必须挡住后来的。判准是「会不会动全局单例」，不是「跑得久不久」：
 *   apply、undo、import、apply_cleanup、apply_aggregate 全都在改**同一棵书签树**，而落地
 *   操作与 undo 还共用 engine/snapshot.ts 里唯一那个 SNAPSHOT_KEY——两个窗口同时落地，
 *   后写的快照会把先写的整个盖掉，先落地那一次就**再也撤销不回去**。analyze 也必须挡住
 *   apply：方案是对着某一刻的书签树算的，另一个窗口在这中间把树改了，落地时指向的 id
 *   已经不是原来那个东西。reclassify / classify_structure / clear_classify_cache 动的则是
 *   同一份分类缓存（loadCache/saveCache 整块读写，见 storage/settings.ts），分析跑到一半
 *   被人整块删掉，saveCache 会把删掉的条目原样写回去，「重新开始」就成了空话。
 *   没标 exclusive 的都是只读或瞬时的，并发跑没有互相破坏的余地，挡住它们只会让
 *   另一个窗口连书签树都读不了。
 * - cancellable：后台真的会读这一轮的取消信号，界面才配给取消按钮。apply / undo /
 *   import 及清理类从不读 signal——把它们标成可取消，换来的是「点了取消 → 日志说
 *   正在取消 → 它照样跑完」这种骗人的三连。因此 cancellable ⊆ exclusive：能取消
 *   的前提是这轮真的独占着任务槽。
 * - busyLabel：面板等待期间展示的文案。判据是「用户等得住」，与独占无关——
 *   scan / cleanup_scan 不挡别人，但用户要等，照样有文案；秒回的请求不给，
 *   闪一下反而吓人。
 */
export interface TaskSpec {
  readonly exclusive: boolean
  readonly cancellable: boolean
  readonly busyLabel: MessageKey | null
}

const READ_ONLY: TaskSpec = { exclusive: false, cancellable: false, busyLabel: null }

export const TASK_SPECS: Readonly<Record<Request['kind'], TaskSpec>> = {
  // —— 只读或瞬时 ——
  get_tree: READ_ONLY,
  scan: { exclusive: false, cancellable: false, busyLabel: 'busyScanning' },
  get_settings: READ_ONLY,
  save_settings: READ_ONLY,
  get_undo_state: READ_ONLY,
  cancel: READ_ONLY,
  test_model: READ_ONLY,
  list_models: READ_ONLY,
  cleanup_scan: { exclusive: false, cancellable: false, busyLabel: 'busyScanning' },
  cleanup_stale_scan: READ_ONLY,

  // —— 独占任务：真读取消信号的四种 ——
  analyze: { exclusive: true, cancellable: true, busyLabel: 'busyAnalyzing' },
  classify_structure: { exclusive: true, cancellable: true, busyLabel: 'structureClassifying' },
  check_links: { exclusive: true, cancellable: true, busyLabel: 'busyCheckingLinks' },
  reclassify: { exclusive: true, cancellable: true, busyLabel: 'busyReclassifying' },

  // —— 独占任务：从不收取消信号的 ——
  apply: { exclusive: true, cancellable: false, busyLabel: 'busyApplying' },
  undo: { exclusive: true, cancellable: false, busyLabel: 'busyUndoing' },
  import: { exclusive: true, cancellable: false, busyLabel: 'busyImporting' },
  apply_cleanup: { exclusive: true, cancellable: false, busyLabel: 'busyApplying' },
  apply_aggregate: { exclusive: true, cancellable: false, busyLabel: 'busyAggregating' },
  move_bookmarks: { exclusive: true, cancellable: false, busyLabel: 'busyMovingBookmarks' },
  /**
   * 「重新开始」的前半步：清持久化分类缓存。动的正是 analyze 在写的那份缓存，
   * 所以独占；但它秒回且紧跟着就进 analyze，不给 busy 文案也不给取消。
   */
  clear_classify_cache: { exclusive: true, cancellable: false, busyLabel: null },
}
