import type { OrganizePlan, ScanResult } from '@/core/types'
import type { ApplyResult } from '@/engine/apply'
import type { CleanupInput, CleanupResult, CleanupScan } from '@/engine/cleanup'
import type { AggregateInput, AggregateResult } from '@/engine/aggregate'
import type { LinkResult, LinkTarget } from '@/engine/linkCheck'
import type { UndoResult } from '@/engine/undo'
import type { BookmarkNode } from '@/core/ports'
import type { Settings } from '@/storage/settings'
import type { ExportNode } from '@/core/export'
import type { ImportResult } from '@/engine/importTree'
import type { OrganizeMode } from '@/core/mode'
import type { TestFailure } from '@/llm/probe'
import type { StaleScanResult } from '@/core/stale'
import type { MoveBookmarksInput, MoveBookmarksResult } from '@/engine/moveBookmarks'
import type { TaskRecord } from './events'
import type { StructureDraft, StructureEdits, StructureWorkflowState } from '@/core/structure'

/**
 * 失败分类跟着探针本身定义在 llm/probe.ts（那一层零浏览器依赖），这里再导出一次，
 * 让消息契约自己说得清能带回哪些取值，侧栏不必反向去 llm/ 取类型。
 */
export type { TestFailure }

/**
 * 面板发给后台的业务请求。
 *
 * 曾经每条消息还捎带着发信侧栏的 clientId（传输层身份），后台据此决定进度推给谁、
 * 取消掐哪一轮。任务改为全局单轮 + 广播之后（见 background/sessions.ts 的头注释），
 * 窗口身份失去了存在的理由，字段整个删掉——旧侧栏升级后多发的那半个字段，后台
 * 读类型时看不到它，自然忽略。
 */
export type Request =
  | { kind: 'get_tree' }
  | { kind: 'scan'; scopeRootIds: string[] }
  | {
      kind: 'analyze'
      scopeRootIds: string[]
      /**
       * 用户在偏好页推翻了自动判断时才带上；缺省表示由后台按这次扫描的结果自己判。
       *
       * 不进 Settings：存下来就等于把删掉的开关偷偷留着，一次推翻只对这一次整理生效
       * （见 issues/14-mode-detection.md §5）。
       */
      modeOverride?: OrganizeMode
      /** 只生成 GitHub 标题改名方案，不调用模型也不生成移动操作。 */
      titleOnly?: boolean
      /** title-only 时选用的规则。缺省按 GitHub-only 处理，兼容旧侧栏。 */
      ruleIds?: string[]
    }
  | { kind: 'classify_structure'; draft: StructureDraft; edits: StructureEdits }
  | { kind: 'apply'; plan: OrganizePlan; accepted: string[] }
  | { kind: 'undo' }
  | { kind: 'get_settings' }
  | { kind: 'save_settings'; settings: Settings }
  | { kind: 'get_undo_state' }
  | { kind: 'import'; nodes: ExportNode[]; targetName: string }
  | { kind: 'cancel' }
  /**
   * 清空持久化的分类缓存。「重新开始」的前半步：取消后再跑 analyze 本来会命中
   * 缓存、免费沿用取消前已经算好的那些批次，清掉才是真的从头来。
   */
  | { kind: 'clear_classify_cache' }
  /**
   * 当场验一次模型配置。必须走后台：这个功能对着的那次故障，形状是「浏览器普通标签页
   * 能打开那个域名、而扩展的请求失败」——从侧栏直接 fetch 去测会给出假绿灯。
   * apiKey 跟眼前这份走：编辑态下 Key 还没落盘，去 settings 里找会测成上一份。
   */
  | { kind: 'test_model'; baseUrl: string; apiKey: string; model: string }

  /**
   * 列出这个端点上能选的模型。apiKey 跟草稿走：编辑态下 Key 还没落盘，
   * 去 settings 里找会拿到上一份，名单就是错的。
   */
  | { kind: 'list_models'; baseUrl: string; apiKey: string }
  /**
   * 清理模式的全库扫描。不带 scopeRootIds：重复项的常态是跨文件夹，限定范围
   * 反而把最该抓的那批漏掉（见设计文档第四节）。
   */
  | { kind: 'cleanup_scan' }
  | { kind: 'apply_cleanup'; input: CleanupInput }
  | { kind: 'cleanup_stale_scan'; scopeRootIds: string[] }
  | { kind: 'apply_aggregate'; input: AggregateInput }
  /**
   * 必须走后台：service worker 才有那份 host 权限的完整上下文，
   * 而且长时间的批量请求需要 keepalive 撑着，与 analyze 同一条路。
   */
  | { kind: 'check_links'; targets: LinkTarget[] }
  /**
   * 复核页对某几条建议不满意，选中它们、排除各自当前的目标目录，重新问一次模型。
   *
   * 带的是完整的 plan 而不是只带 bookmarkIds：patch 结果要贴回 plan.rows 与
   * plan.operations 两处（见 core/plan.ts 的 applyReclassifyResults），后台没有
   * 别的地方存着这份 plan——它只活在侧栏的 store 里，得由调用方带过来。
   */
  | { kind: 'reclassify'; plan: OrganizePlan; bookmarkIds: string[] }
  | { kind: 'move_bookmarks'; input: MoveBookmarksInput }


export type AnalyzeResponse =
  | { ok: true; kind: 'analyze'; outcome: 'plan'; plan: OrganizePlan }
  | { ok: true; kind: 'analyze'; outcome: 'structure'; draft: StructureDraft }

export type Response =
  | { ok: true; kind: 'get_tree'; tree: BookmarkNode[] }
  | { ok: true; kind: 'scan'; scan: ScanResult }
  | AnalyzeResponse
  | { ok: true; kind: 'classify_structure'; plan: OrganizePlan }
  | { ok: true; kind: 'apply'; result: ApplyResult }
  | { ok: true; kind: 'undo'; result: UndoResult }
  | { ok: true; kind: 'get_settings'; settings: Settings }
  | { ok: true; kind: 'save_settings' }
  | { ok: true; kind: 'get_undo_state'; available: boolean; createdAt: number | null }
  | { ok: true; kind: 'import'; result: ImportResult }
  | { ok: true; kind: 'cancel' }
  | { ok: true; kind: 'clear_classify_cache' }
  /** ms 是这一次请求真实的往返耗时，给用户一个「快不快」的直观印象。 */
  | { ok: true; kind: 'test_model'; ms: number }
  | { ok: true; kind: 'list_models'; models: string[] }
  | { ok: true; kind: 'cleanup_scan'; scan: CleanupScan }
  | { ok: true; kind: 'apply_cleanup'; result: CleanupResult }
  | { ok: true; kind: 'cleanup_stale_scan'; scan: StaleScanResult }
  | { ok: true; kind: 'apply_aggregate'; result: AggregateResult }
  | { ok: true; kind: 'check_links'; results: LinkResult[] }
  | { ok: true; kind: 'reclassify'; plan: OrganizePlan }
  | { ok: true; kind: 'move_bookmarks'; result: MoveBookmarksResult }
  | { ok: true; kind: 'open_app_tab' }
  /** 当前后台任务的完整记录（含在途进度与终态载荷）；没有就是 null。 */
  | { ok: true; kind: 'get_task'; record: TaskRecord | null }
  | { ok: true; kind: 'clear_task' }
  | { ok: true; kind: 'get_structure_workflow'; workflow: StructureWorkflowState }
  | { ok: true; kind: 'save_structure_edits' }
  | { ok: true; kind: 'clear_structure_workflow' }
  /**
   * cancelled 为 true 表示用户主动取消，不是出错。
   * reason 只有 test_model 会带：失败时说清是哪一类，别的请求没有这个分类。
   */
  | { ok: false; error: string; cancelled?: boolean; reason?: TestFailure }

/**
 * 面板会发、但**不走 handle()** 的控制消息，由 service-worker 直接代办或作答
 * （见 service-worker.ts 的 onMessage）。与 Request 分开，handle 的 switch
 * 就不必为它们添永远走不到的分支：
 *
 * - get_task / clear_task 回答「后台现在在干嘛」，由任务中枢直接作答；
 * - open_app_tab 把侧栏换成完整标签页：侧栏没有 close API，唯一关法是
 *   sidePanel.enabled 先关后开，而面板一关侧栏页面就被卸载——让侧栏自己做，
 *   「再启用」那一步永远轮不到执行，扩展图标从此点了没反应。
 *   mode / step / checkedIds 只作透传（写进标签页 URL），所以是裸 string，
 *   合法性由侧栏那边校验。
 */
export type ControlRequest =
  | { kind: 'get_task' }
  | { kind: 'clear_task' }
  | { kind: 'get_structure_workflow' }
  | { kind: 'save_structure_edits'; draft: StructureDraft; edits: StructureEdits }
  | { kind: 'clear_structure_workflow' }
  | { kind: 'open_app_tab'; mode: string; step: string; checkedIds: string[] }

export type PanelRequest = Request | ControlRequest
