import { describe, expect, it } from 'vitest'
import { TASK_SPECS } from '@/background/task-specs'
import type { Request } from '@/background/messages'

/** 后台真的会开车的请求：独占、可能可取消。与 worker 里 task.begin 的对象一一对应。 */
const EXCLUSIVE_KINDS = [
  'analyze', 'classify_structure', 'check_links', 'reclassify',
  'apply', 'undo', 'import', 'apply_cleanup', 'apply_aggregate',
  'move_bookmarks', 'clear_classify_cache',
] as const

/** 只读或瞬时的请求：并发跑没有互相破坏的余地。 */
const READ_ONLY_KINDS = [
  'get_tree', 'scan', 'get_settings', 'save_settings', 'get_undo_state',
  'cancel', 'test_model', 'list_models', 'cleanup_scan', 'cleanup_stale_scan',
] as const

describe('TASK_SPECS 每种请求的运行政策', () => {
  it('可取消的任务必然独占：给取消按钮的前提是后台真的在读这一轮的信号', () => {
    for (const [kind, spec] of Object.entries(TASK_SPECS)) {
      if (spec.cancellable) expect(spec.exclusive, kind).toBe(true)
    }
  })

  it('互斥任务里只有真读取消信号的那几种配得上取消按钮', () => {
    for (const kind of ['analyze', 'classify_structure', 'check_links', 'reclassify'] as const) {
      expect(TASK_SPECS[kind], kind).toMatchObject({ exclusive: true, cancellable: true })
    }
    // apply / undo / import 及清理类从不读 isCancelled；把它们标成可取消，
    // 换来「点了取消 → 日志说正在取消 → 它照样跑完」的骗人三连。
    for (const kind of ['apply', 'undo', 'import', 'apply_cleanup', 'apply_aggregate', 'move_bookmarks', 'clear_classify_cache'] as const) {
      expect(TASK_SPECS[kind], kind).toMatchObject({ exclusive: true, cancellable: false })
    }
  })

  it('只读或瞬时的请求不挡别人', () => {
    for (const kind of READ_ONLY_KINDS) {
      expect(TASK_SPECS[kind], kind).toMatchObject({ exclusive: false, cancellable: false })
    }
  })

  it('面板 busy 文案跟着 kind 走：用户等得住的请求有文案，秒回的没有', () => {
    expect(TASK_SPECS.analyze.busyLabel).toBe('busyAnalyzing')
    expect(TASK_SPECS.classify_structure.busyLabel).toBe('structureClassifying')
    expect(TASK_SPECS.check_links.busyLabel).toBe('busyCheckingLinks')
    expect(TASK_SPECS.reclassify.busyLabel).toBe('busyReclassifying')
    expect(TASK_SPECS.apply.busyLabel).toBe('busyApplying')
    expect(TASK_SPECS.apply_cleanup.busyLabel).toBe('busyApplying')
    expect(TASK_SPECS.undo.busyLabel).toBe('busyUndoing')
    expect(TASK_SPECS.import.busyLabel).toBe('busyImporting')
    expect(TASK_SPECS.apply_aggregate.busyLabel).toBe('busyAggregating')
    expect(TASK_SPECS.move_bookmarks.busyLabel).toBe('busyMovingBookmarks')
    expect(TASK_SPECS.scan.busyLabel).toBe('busyScanning')
    expect(TASK_SPECS.cleanup_scan.busyLabel).toBe('busyScanning')
    // 秒回的缓存清理不给文案：「重新开始」紧接着就进 analyze，闪一下反而吓人
    expect(TASK_SPECS.clear_classify_cache.busyLabel).toBeNull()
    expect(TASK_SPECS.get_tree.busyLabel).toBeNull()
    expect(TASK_SPECS.cleanup_stale_scan.busyLabel).toBeNull()
  })

  it('每种请求都登记了一行：新 kind 忘了登记时，Record 类型先报错，这里再兜一层底', () => {
    const kinds: Request['kind'][] = [...EXCLUSIVE_KINDS, ...READ_ONLY_KINDS]
    for (const kind of kinds) expect(TASK_SPECS[kind], kind).toBeDefined()
  })
})
