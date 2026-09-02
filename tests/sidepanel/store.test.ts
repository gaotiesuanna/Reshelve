import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  appendLog, collectDescendantFolderIds, modelTestKey, nextStepAfterAnalyze, toggleChecked,
  useStore, MAX_LOGS, MAX_LOG_LENGTH, type LogLine,
} from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'
import { currentLocale, setLocale, t } from '@/i18n'
import { DEFAULT_SETTINGS, activeLlm } from '@/storage/settings'
import { EMPTY_EDITS } from '@/core/structure'
import { makePlan } from '../fakes/plan'
import { withLlm } from '../fakes/settings'
import type { ProgressEvent } from '@/background/events'
import type { BookmarkNode } from '@/core/ports'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'A', url: 'https://a.dev' },
        { id: '101', title: '子文件夹', children: [] },
      ]},
      { id: '11', title: '杂项', children: [] },
    ]},
  ]},
]

describe('collectDescendantFolderIds', () => {
  it('只收集文件夹，不收集书签', () => {
    expect(collectDescendantFolderIds(tree, '1').sort()).toEqual(['10', '101', '11'])
  })
  it('叶子文件夹返回空数组', () => {
    expect(collectDescendantFolderIds(tree, '11')).toEqual([])
  })
})

describe('toggleChecked', () => {
  it('勾选文件夹时级联勾选其所有子文件夹', () => {
    expect([...toggleChecked(new Set(), '1', tree)].sort()).toEqual(['1', '10', '101', '11'])
  })

  it('取消勾选时级联取消其所有子文件夹', () => {
    const checked = toggleChecked(new Set(), '1', tree)
    expect([...toggleChecked(checked, '1', tree)]).toEqual([])
  })

  it('取消子文件夹不影响父文件夹的勾选状态', () => {
    const checked = toggleChecked(new Set(), '1', tree)
    const after = toggleChecked(checked, '10', tree)
    expect(after.has('1')).toBe(true)
    expect(after.has('10')).toBe(false)
    expect(after.has('101')).toBe(false)
  })
})

describe('appendLog', () => {
  const event = (message: string, extra: Partial<ProgressEvent> = {}): ProgressEvent => ({
    phase: 'classify', message, ...extra,
  })

  it('把带 message 的事件追加成一行日志', () => {
    const logs = appendLog([], event('批次 1/2 完成'), 0)
    expect(logs).toEqual([{ id: 0, phase: 'classify', level: 'info', message: '批次 1/2 完成' }])
  })

  it('纯进度事件不写日志', () => {
    expect(appendLog([], event('', { done: 25, total: 100 }), 0)).toEqual([])
  })

  it('保留事件级别', () => {
    expect(appendLog([], event('失败了', { level: 'error' }), 0)[0]!.level).toBe('error')
  })

  it('超过上限时丢弃最旧的几行', () => {
    let logs: LogLine[] = []
    for (let i = 0; i < MAX_LOGS + 5; i++) logs = appendLog(logs, event(`第 ${i} 行`), i)
    expect(logs).toHaveLength(MAX_LOGS)
    expect(logs[0]!.message).toBe('第 5 行')
    expect(logs.at(-1)!.message).toBe(`第 ${MAX_LOGS + 4} 行`)
  })
})

describe('store 的事件累积', () => {
  it('进度事件更新进度条，日志事件追加日志', () => {
    useStore.setState({ logs: [], logSeq: 0, progress: null })
    useStore.getState().pushEvent({ phase: 'tags', message: '', done: 50, total: 100 })
    useStore.getState().pushEvent({ phase: 'tags', message: '标签批次 2/4' })
    expect(useStore.getState().progress).toEqual({ phase: 'tags', done: 50, total: 100 })
    expect(useStore.getState().logs.map((l) => l.message)).toEqual(['标签批次 2/4'])
  })

  it('日志事件不会清掉已有进度', () => {
    useStore.setState({ logs: [], logSeq: 0, progress: { phase: 'tags', done: 50, total: 100 } })
    useStore.getState().pushEvent({ phase: 'tags', message: '某条日志' })
    expect(useStore.getState().progress).toEqual({ phase: 'tags', done: 50, total: 100 })
  })
})

describe('日志长度截断', () => {
  it('过长的接口错误体被截断，界面不会被撑爆', () => {
    const long = 'x'.repeat(MAX_LOG_LENGTH + 50)
    const logs = appendLog([], { phase: 'classify', message: long, level: 'error' }, 0)
    expect(logs[0]!.message).toHaveLength(MAX_LOG_LENGTH + 1) // 含省略号
  })

  /**
   * 砍中间不砍尾巴：模型输出非法时开头永远是一段合法 JSON，破绽全在末尾，
   * 从头截断等于把唯一有诊断价值的地方扔掉（llm/client.ts 特意拼进去的尾部
   * 就是被这里砍没的）。
   */
  it('超长日志保留尾部', () => {
    const message = `模型返回的不是合法 JSON：${'x'.repeat(MAX_LOG_LENGTH)}破绽在这里`
    const logs = appendLog([], { phase: 'tags', message, level: 'error' }, 0)
    expect(logs[0]!.message).toContain('破绽在这里')
  })

  it('超长日志仍保留开头，一眼认得出是哪一条', () => {
    const message = `模型返回的不是合法 JSON：${'x'.repeat(MAX_LOG_LENGTH)}破绽在这里`
    const logs = appendLog([], { phase: 'tags', message, level: 'error' }, 0)
    expect(logs[0]!.message.startsWith('模型返回的不是合法 JSON：')).toBe(true)
  })

  it('省略号在中间，不在末尾', () => {
    const message = `开头${'x'.repeat(MAX_LOG_LENGTH)}结尾`
    const logs = appendLog([], { phase: 'tags', message, level: 'error' }, 0)
    expect(logs[0]!.message.endsWith('…')).toBe(false)
    expect(logs[0]!.message).toContain('…')
  })

  it('不超长的日志一字不改', () => {
    const message = 'x'.repeat(MAX_LOG_LENGTH)
    const logs = appendLog([], { phase: 'tags', message, level: 'error' }, 0)
    expect(logs[0]!.message).toBe(message)
  })
})

describe('nextStepAfterAnalyze', () => {
  it('推翻模式先进结构确认页', () => {
    expect(nextStepAfterAnalyze(true)).toBe('structure')
  })

  it('非推翻模式直接进移动清单页', () => {
    expect(nextStepAfterAnalyze(false)).toBe('review')
  })
})

describe('结构确认步骤', () => {
  it('renameNode 与 removeNode 累积到 structureEdits', () => {
    useStore.setState({ plan: makePlan(), structureEdits: { renames: {}, removed: [], mergedInto: {} } })
    useStore.getState().renameNode('tmp:1', '代码仓库')
    useStore.getState().removeNode('tmp:3')
    expect(useStore.getState().structureEdits).toEqual({
      renames: { 'tmp:1': '代码仓库' }, removed: ['tmp:3'], mergedInto: {},
    })
  })

  it('confirmStructure 把编辑写进 plan 并进入 review', () => {
    useStore.setState({
      plan: makePlan(),
      structureEdits: { renames: { 'tmp:1': '代码仓库' }, removed: [], mergedInto: {} },
      step: 'structure',
    })
    useStore.getState().confirmStructure()
    const state = useStore.getState()
    expect(state.step).toBe('review')
    expect(state.plan!.candidates.find((c) => c.id === 'tmp:1')!.path).toEqual(['代码仓库'])
  })

  it('confirmStructure 后重新全选，不再看置信度——放错比不放更可接受', () => {
    const plan = makePlan()
    plan.rows[0]!.confidence = 0.3 // 就算是低置信度的行，也照样进 accepted
    useStore.setState({ plan, structureEdits: { renames: {}, removed: [], mergedInto: {} }, accepted: new Set() })
    useStore.getState().confirmStructure()
    const accepted = useStore.getState().accepted
    expect(accepted.has(plan.rows[0]!.bookmarkId)).toBe(true)
    expect(accepted.has(plan.rows[1]!.bookmarkId)).toBe(true)
  })

  it('backToPreferences 回到偏好页并清空结构编辑', () => {
    useStore.setState({
      step: 'structure',
      structureEdits: { renames: { 'tmp:1': 'x' }, removed: [], mergedInto: {} },
    })
    useStore.getState().backToPreferences()
    expect(useStore.getState().step).toBe('preferences')
    expect(useStore.getState().structureEdits).toEqual({ renames: {}, removed: [], mergedInto: {} })
  })

  it('合并同时写 removed 与 mergedInto——两件事必须一起发生', () => {
    useStore.setState({ structureEdits: EMPTY_EDITS })
    useStore.getState().mergeNode('tmp:1', 'tmp:2')

    const edits = useStore.getState().structureEdits
    expect(edits.removed).toContain('tmp:1')
    expect(edits.mergedInto['tmp:1']).toBe('tmp:2')
  })

  it('合并到自己是无操作——不会把一个目录合进它自己', () => {
    useStore.setState({ structureEdits: EMPTY_EDITS })
    useStore.getState().mergeNode('tmp:1', 'tmp:1')

    expect(useStore.getState().structureEdits.removed).toEqual([])
  })

  it('重复合并同一个目录时以最后一次为准', () => {
    useStore.setState({ structureEdits: EMPTY_EDITS })
    useStore.getState().mergeNode('tmp:1', 'tmp:2')
    useStore.getState().mergeNode('tmp:1', 'tmp:3')

    const edits = useStore.getState().structureEdits
    expect(edits.mergedInto['tmp:1']).toBe('tmp:3')
    // removed 不该出现重复项
    expect(edits.removed.filter((id) => id === 'tmp:1')).toHaveLength(1)
  })
})

describe('readImportFile', () => {
  const good = JSON.stringify({
    format: 'tidymark/v1', kind: 'tree', exportedAt: '',
    roots: [{ name: 'A', children: [{ name: 'a', url: 'https://a.dev' }] }],
  })

  it('解析成功时存下文件名与预览，并清掉旧错误', () => {
    useStore.setState({ tree, importError: '上一次的错误', importFile: null })
    useStore.getState().readImportFile('x.json', good)

    const state = useStore.getState()
    expect(state.importError).toBeNull()
    expect(state.importFile!.name).toBe('x.json')
    expect(state.importFile!.preview.bookmarkCount).toBe(1)
    expect(state.importFile!.preview.folderCount).toBe(1)
  })

  it('解析失败时存下错误，并清掉旧预览', () => {
    useStore.setState({ tree, importError: null })
    useStore.getState().readImportFile('x.json', good)
    useStore.getState().readImportFile('bad.json', '不是 json')

    const state = useStore.getState()
    expect(state.importError).toBe('这个文件不是有效的 JSON。')
    expect(state.importFile).toBeNull()
  })

  it('重复计数用的是 store 里的书签树', () => {
    // 上面的 tree fixture 里有 https://a.dev
    useStore.setState({ tree, importError: null, importFile: null })
    useStore.getState().readImportFile('x.json', good)
    expect(useStore.getState().importFile!.preview.duplicateCount).toBe(1)
  })

  it('归一过程意外抛异常时落到「文件结构损坏。」而不是抛出去（白屏兜底）', () => {
    // 构造一棵 children getter 会抛异常的书签树，模拟解析/归一阶段任何未预见的运行时异常
    const explosiveTree = [{
      id: '0', title: '',
      get children(): BookmarkNode[] { throw new Error('boom') },
    }] as unknown as BookmarkNode[]
    useStore.setState({ tree: explosiveTree, importError: null, importFile: null, importDone: null })

    expect(() => useStore.getState().readImportFile('x.json', good)).not.toThrow()

    const state = useStore.getState()
    expect(state.importError).toBe('文件结构损坏。')
    expect(state.importFile).toBeNull()
    expect(state.importDone).toBeNull()
  })
})

describe('resetImport', () => {
  it('三段状态一起清空', () => {
    useStore.setState({
      importError: '错误',
      importFile: null,
      importDone: {
        result: { folderId: '1', bookmarks: 1, folders: 0, skipped: [] },
        blocked: [], targetName: '导入', barTitle: '书签栏',
      },
    })
    useStore.getState().resetImport()

    const state = useStore.getState()
    expect(state.importError).toBeNull()
    expect(state.importFile).toBeNull()
    expect(state.importDone).toBeNull()
  })
})

describe('语言跟着设置走', () => {
  afterEach(() => setLocale('zh_CN'))

  it('保存 uiLocale 后 store 的 locale 与 i18n 的当前语言一起变', async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS }, locale: 'zh_CN' })
    await useStore.getState().setSettings({ ...DEFAULT_SETTINGS, uiLocale: 'en' })
    expect(useStore.getState().locale).toBe('en')
    expect(currentLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it("uiLocale 是 'auto' 时回落浏览器语言（桩是 zh-CN）", async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, uiLocale: 'en' }, locale: 'en' })
    await useStore.getState().setSettings({ ...DEFAULT_SETTINGS, uiLocale: 'auto' })
    expect(useStore.getState().locale).toBe('zh_CN')
  })
})

describe('refreshTree 剪掉已经不存在的勾选', () => {
  // 合并会删掉被勾中的源目录，撤销又用新 id 把它们重建出来。
  // reset() 有意保留 checkedIds（「再整理一次」时不用重勾），但没人剪过这个集合：
  // 回到范围页会看到「扫描 2 个文件夹」的按钮亮着、树上却一个勾都没有，
  // 点下去扫的是一批死 id，直接撞 errNoScope——本功能自己的回头路被自己堵死了。
  it('树里已经没有的 id 被剪掉', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'get_tree', tree })
    useStore.setState({ checkedIds: new Set(['10', '11', '900', '901']) })

    await useStore.getState().refreshTree()

    expect([...useStore.getState().checkedIds].sort()).toEqual(['10', '11'])
  })

  it('仍然存在的 id 一个不动——跨 reset 记住选择是有意为之，不能一把清空', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'get_tree', tree })
    useStore.setState({ checkedIds: new Set(['1', '10', '101', '11']) })

    await useStore.getState().refreshTree()

    expect([...useStore.getState().checkedIds].sort()).toEqual(['1', '10', '101', '11'])
  })

  it('读树失败时不动勾选——拿不到新树就无从判断谁还活着', async () => {
    vi.mocked(send).mockResolvedValue({ ok: false, error: '后台没了' })
    useStore.setState({ checkedIds: new Set(['900']) })

    await useStore.getState().refreshTree()

    expect([...useStore.getState().checkedIds]).toEqual(['900'])
  })
})

/**
 * 分析要跑好几分钟，而偏好页的「返回」在这期间是能点的。点了就是 reset()：
 * 这一轮作废、退回选范围页。几分钟后分析回来，它的结果属于一个用户已经放弃的
 * 轮次，不该再落地——落地的后果是 plan 有、scan 没了，结构页照常显示（它只要 plan），
 * 从那儿一点返回就是整页空白的偏好页。
 */
describe('放弃这一轮之后，在途结果不再落地', () => {
  // analyze 开头要问一次 host 权限，jsdom 里没有 chrome.permissions
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
  const originalPermissions = chromeGlobal.chrome.permissions
  beforeEach(() => {
    chromeGlobal.chrome.permissions = { contains: () => Promise.resolve(true) }
  })
  afterEach(() => {
    chromeGlobal.chrome.permissions = originalPermissions
  })

  const scan = {
    bookmarks: [], folders: [],
    stats: { totalBookmarks: 2, totalFolders: 1, emptyFolders: 0, untitledBookmarks: 0, duplicateUrlGroups: 0, duplicateFolderGroups: 0, maxDepth: 1 },
  }

  beforeEach(() => {
    vi.mocked(send).mockReset()
    useStore.setState({
      step: 'preferences', scan, plan: null, checkedIds: new Set(['1']),
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-x' }) },
      busy: null, busyKind: null, error: null, logs: [],
    })
  })

  // 点下「开始 AI 分析」到后台推来第一条日志之间隔着一次 service worker 冷启动加
  // 一整棵书签树的读取，那几百毫秒里界面上只有一个转圈的「正在分析…」，点下去像没反应。
  // 第一行由侧栏自己写，所以「点了就有日志」不依赖后台醒得多快。
  it('分析一发出就有日志，不等后台推第一条', async () => {
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (new Promise(() => {}) as never)
        : (Promise.resolve({ ok: true }) as never))

    void useStore.getState().analyze()
    // 先让开头那次 host 权限询问跑完；日志要断言的是「请求一发出就有」，不是「等后台回来才有」
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useStore.getState().busy).toBe('正在分析…')
    expect(useStore.getState().logs).toHaveLength(1)
    expect(useStore.getState().logs[0]!.message).toMatch(/开始分析/)
  })

  it('分析在途时 reset，分析回来不改步骤也不写 plan', async () => {
    let finish: (v: unknown) => void = () => {}
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (new Promise((r) => { finish = r }) as never)
        : (Promise.resolve({ ok: true }) as never))

    const running = useStore.getState().analyze()
    await Promise.resolve()
    useStore.getState().reset()

    finish({ ok: true, kind: 'analyze', plan: makePlan() })
    await running

    expect(useStore.getState().step).toBe('scope')
    expect(useStore.getState().plan).toBeNull()
  })

  // 作废也要把 busy 收掉，否则选范围页的扫描按钮被一个不存在的任务钉死
  it('作废时 busy 归零，用户能立刻重新开始', async () => {
    let finish: (v: unknown) => void = () => {}
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (new Promise((r) => { finish = r }) as never)
        : (Promise.resolve({ ok: true }) as never))

    const running = useStore.getState().analyze()
    await Promise.resolve()
    useStore.getState().reset()
    finish({ ok: true, kind: 'analyze', plan: makePlan() })
    await running

    expect(useStore.getState().busy).toBeNull()
    expect(useStore.getState().busyKind).toBeNull()
  })

  it('扫描同理：在途时 reset，扫描回来不跳到偏好页', async () => {
    useStore.setState({ step: 'scope', scan: null })
    let finish: (v: unknown) => void = () => {}
    vi.mocked(send).mockImplementation(() => new Promise((r) => { finish = r }) as never)

    const running = useStore.getState().goScan()
    await Promise.resolve()
    useStore.getState().reset()

    finish({ ok: true, kind: 'scan', scan })
    await running

    expect(useStore.getState().step).toBe('scope')
    expect(useStore.getState().scan).toBeNull()
  })

  // 没人打断时一切照旧，别把正常路径也一起废掉
  it('没有 reset 时结果正常落地', async () => {
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({ ok: true, kind: 'analyze', plan: makePlan() }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().analyze()
    expect(useStore.getState().step).toBe('structure')
    expect(useStore.getState().plan).not.toBeNull()
  })

  it('分析完成后默认全部勾选——放错比不放更可接受', async () => {
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({ ok: true, kind: 'analyze', plan: makePlan() }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().analyze()
    const plan = useStore.getState().plan!
    expect(useStore.getState().accepted.size).toBe(plan.rows.length)
  })

  it('分析后去哪一步由 plan 说了算，不看设置——模式是后台判的', async () => {
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({
            ok: true, kind: 'analyze', plan: { ...makePlan(), rebuildStructure: false },
          }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().analyze()
    expect(useStore.getState().step).toBe('review')
  })

  it('推翻自动判断只随这一次请求走，不写进设置', async () => {
    useStore.setState({ modeOverride: 'rebuild' })
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({ ok: true, kind: 'analyze', plan: makePlan() }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().analyze()
    expect(vi.mocked(send).mock.calls.some(
      ([req]) => (req as { kind: string; modeOverride?: string }).kind === 'analyze'
        && (req as { modeOverride?: string }).modeOverride === 'rebuild',
    )).toBe(true)
    expect(vi.mocked(send).mock.calls.some(([req]) => (req as { kind: string }).kind === 'save_settings')).toBe(false)
  })

  it('没推翻时请求里不带 modeOverride，后台自己判', async () => {
    useStore.setState({ modeOverride: null })
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({ ok: true, kind: 'analyze', plan: makePlan() }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().analyze()
    const call = vi.mocked(send).mock.calls
      .map(([req]) => req as { kind: string; modeOverride?: string })
      .find((req) => req.kind === 'analyze')
    expect(call?.modeOverride).toBeUndefined()
  })

  it('重新扫描与 reset 都会把推翻清掉——那是上一批书签的判断', async () => {
    useStore.setState({ modeOverride: 'rebuild' })
    useStore.getState().reset()
    expect(useStore.getState().modeOverride).toBeNull()

    useStore.setState({ modeOverride: 'rebuild' })
    vi.mocked(send).mockImplementation(() => Promise.resolve({ ok: true, kind: 'scan', scan }) as never)
    await useStore.getState().goScan()
    expect(useStore.getState().modeOverride).toBeNull()
  })
})

describe('重新分类选中的建议', () => {
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
  const originalPermissions = chromeGlobal.chrome.permissions
  beforeEach(() => {
    chromeGlobal.chrome.permissions = { contains: () => Promise.resolve(true) }
    vi.mocked(send).mockReset()
    const plan = makePlan()
    useStore.setState({
      step: 'review', plan, accepted: new Set(plan.rows.map((r) => r.bookmarkId)),
      reclassifyMarked: new Set(['g0']),
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-x' }) },
      busy: null, busyKind: null, error: null, logs: [],
    })
  })
  afterEach(() => {
    chromeGlobal.chrome.permissions = originalPermissions
  })

  it('勾选/取消标记', () => {
    useStore.setState({ reclassifyMarked: new Set() })
    useStore.getState().toggleReclassifyMark('g0')
    expect(useStore.getState().reclassifyMarked.has('g0')).toBe(true)
    useStore.getState().toggleReclassifyMark('g0')
    expect(useStore.getState().reclassifyMarked.has('g0')).toBe(false)
  })

  /**
   * 标记重新分类顺手取消接受——不然「应用」看到的还是那份没变过的 accepted，
   * 会把用户明确标了「不满意」的书签，原样按旧目标搬过去。标记这个动作本身
   * 必须能拦住「应用」，不只是一个笔记（见用户原话：「点了重新分类，分类
   * 正确的还没应用，还是先应用」）。
   */
  it('标记重新分类时顺手取消接受——不然会被应用成旧答案', () => {
    useStore.setState({ reclassifyMarked: new Set(), accepted: new Set(['g0', 'g1']) })
    useStore.getState().toggleReclassifyMark('g0')
    expect(useStore.getState().accepted.has('g0')).toBe(false)
    // 只摘标记的那一条，别的书签的接受状态不受影响
    expect(useStore.getState().accepted.has('g1')).toBe(true)
  })

  it('取消标记不自动恢复接受——那是用户自己的决定', () => {
    useStore.setState({ reclassifyMarked: new Set(['g0']), accepted: new Set() })
    useStore.getState().toggleReclassifyMark('g0')
    expect(useStore.getState().reclassifyMarked.has('g0')).toBe(false)
    expect(useStore.getState().accepted.has('g0')).toBe(false)
  })

  it('没有 plan 或没有标记任何书签时什么都不做', async () => {
    useStore.setState({ reclassifyMarked: new Set() })
    await useStore.getState().reclassifySelected()
    expect(send).not.toHaveBeenCalled()
  })

  it('把标记的书签 id 与当前 plan 一起发给后台', async () => {
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'reclassify'
        ? (Promise.resolve({ ok: true, kind: 'reclassify', plan: makePlan() }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().reclassifySelected()
    const call = vi.mocked(send).mock.calls
      .map(([req]) => req as { kind: string; bookmarkIds?: string[] })
      .find((req) => req.kind === 'reclassify')
    expect(call?.bookmarkIds).toEqual(['g0'])
  })

  it('成功后换了目标的书签自动标记 accepted，标记清空，busy 复位', async () => {
    const original = makePlan()
    const changed = {
      ...original,
      rows: original.rows.map((r) => (r.bookmarkId === 'g0' ? { ...r, toCategoryId: 'tmp:3' } : r)),
    }
    useStore.setState({ accepted: new Set(), reclassifyMarked: new Set(['g0']) })
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'reclassify'
        ? (Promise.resolve({ ok: true, kind: 'reclassify', plan: changed }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().reclassifySelected()

    expect(useStore.getState().plan).toBe(changed)
    expect(useStore.getState().accepted.has('g0')).toBe(true)
    expect(useStore.getState().reclassifyMarked.has('g0')).toBe(false)
    expect(useStore.getState().busy).toBeNull()
  })

  it('依然没有更好选择（目标没变）时不动 accepted', async () => {
    const original = makePlan()
    useStore.setState({ accepted: new Set(), reclassifyMarked: new Set(['g0']) })
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'reclassify'
        // 后台返回的 plan 里 g0 的 toCategoryId 跟原来一样——重新分类没换到新目标
        ? (Promise.resolve({ ok: true, kind: 'reclassify', plan: original }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().reclassifySelected()

    expect(useStore.getState().accepted.has('g0')).toBe(false)
    // 标记照样清掉——这一条已经问过了，不该继续挂在「待重新分类」的清单里
    expect(useStore.getState().reclassifyMarked.has('g0')).toBe(false)
  })

  it('失败时不清空标记——用户不用重新勾一遍，再点一次就是完整的重试', async () => {
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'reclassify'
        ? (Promise.resolve({ ok: false, error: '网络错误' }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().reclassifySelected()

    expect(useStore.getState().reclassifyMarked.has('g0')).toBe(true)
    expect(useStore.getState().error).toBe('网络错误')
    expect(useStore.getState().busy).toBeNull()
  })
})

/**
 * A（g0/g1/f0）已经接受、B（r0/o0）还标着重新分类没处理完——「应用」这时候
 * 应该只落地 A，留在复核页让用户接着处理 B，不是把整轮结束跳去结果页
 * （见 issues/45-partial-apply-continue.md）。
 */
describe('应用时还有标记重新分类的书签——只落地已接受的，留在复核页继续', () => {
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
  const originalPermissions = chromeGlobal.chrome.permissions
  beforeEach(() => {
    chromeGlobal.chrome.permissions = { contains: () => Promise.resolve(true) }
  })
  afterEach(() => {
    chromeGlobal.chrome.permissions = originalPermissions
  })

  /**
   * tmp:1（01 GitHub 容器）与 tmp:2（01 AI 工具，g0/g1 的目标）、tmp:3（02 前端，
   * f0 的目标）这次真的建出来了——它们都是 A 的目标、或 A 目标的祖先。
   * tmp:4（r0 的目标）、tmp:5（o0 的目标）没建：r0/o0 都不在 accepted 里，
   * 服务端的 filterAccepted 根本不会把它们的 create_folder 算进「需要建」的名单。
   */
  function applyResultStub(): unknown {
    return {
      status: 'completed', executed: 3, skipped: [],
      createdFolderIds: ['real-1', 'real-2', 'real-3'],
      removedFolders: [], sortedFolders: 0, renamedBookmarkIds: [], mergeRootId: null,
      tempToReal: { 'tmp:1': 'real-1', 'tmp:2': 'real-2', 'tmp:3': 'real-3' },
      failedAt: null, error: null,
    }
  }

  function setup(): void {
    useStore.setState({
      step: 'review', plan: makePlan(),
      accepted: new Set(['g0', 'g1', 'f0']),
      reclassifyMarked: new Set(['r0', 'o0']),
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-x' }) },
      busy: null, busyKind: null, error: null, applyResult: null, undoAvailable: false,
    })
    vi.mocked(send).mockImplementation((req: { kind: string }) => {
      if (req.kind === 'apply') return Promise.resolve({ ok: true, kind: 'apply', result: applyResultStub() }) as never
      if (req.kind === 'get_tree') return Promise.resolve({ ok: true, kind: 'get_tree', tree: [] }) as never
      if (req.kind === 'scan') {
        return Promise.resolve({
          ok: true, kind: 'scan',
          scan: { bookmarks: [], folders: [], stats: {
            totalBookmarks: 0, totalFolders: 0, emptyFolders: 0,
            untitledBookmarks: 0, duplicateUrlGroups: 0, duplicateFolderGroups: 0, maxDepth: 0,
          } },
        }) as never
      }
      return Promise.resolve({ ok: true }) as never
    })
  }

  it('不跳到结果页，留在复核页', async () => {
    setup()
    await useStore.getState().apply()
    expect(useStore.getState().step).toBe('review')
    expect(useStore.getState().applyResult).toBeNull()
  })

  it('已应用的行从方案里摘掉，reclassifyMarked 原样留着', async () => {
    setup()
    await useStore.getState().apply()
    const plan = useStore.getState().plan!
    expect(plan.rows.map((r) => r.bookmarkId).sort()).toEqual(['o0', 'r0'])
    expect(useStore.getState().reclassifyMarked).toEqual(new Set(['r0', 'o0']))
  })

  it('已应用的书签从 accepted 里摘掉', async () => {
    setup()
    await useStore.getState().apply()
    const accepted = useStore.getState().accepted
    expect(accepted.has('g0')).toBe(false)
    expect(accepted.has('g1')).toBe(false)
    expect(accepted.has('f0')).toBe(false)
  })

  it('还没建出来的目录，剩下的行原样指向旧的临时 id——tempToReal 没提到它们', async () => {
    setup()
    await useStore.getState().apply()
    const plan = useStore.getState().plan!
    expect(plan.rows.find((r) => r.bookmarkId === 'r0')!.toCategoryId).toBe('tmp:4')
    expect(plan.rows.find((r) => r.bookmarkId === 'o0')!.toCategoryId).toBe('tmp:5')
  })

  it('设为 undoAvailable，但不落 applyResult——撤销留给结果页，这里不是终点', async () => {
    setup()
    await useStore.getState().apply()
    expect(useStore.getState().undoAvailable).toBe(true)
    expect(useStore.getState().applyResult).toBeNull()
  })

  it('顺手重新扫一遍范围，让 scan.folders 跟得上刚发生的这次应用', async () => {
    setup()
    await useStore.getState().apply()
    const scanCall = vi.mocked(send).mock.calls
      .map(([req]) => req as { kind: string; scopeRootIds?: string[] })
      .find((req) => req.kind === 'scan')
    expect(scanCall?.scopeRootIds).toEqual(makePlan().scopeRootIds)
  })

  // 对照组：一条都没标记重新分类时，行为跟改动前完全一样——这不是新分支，
  // 是「没有还没处理完的」这一支，必须原样走终点
  it('对照：reclassifyMarked 为空时，照旧跳到结果页、落 applyResult', async () => {
    setup()
    useStore.setState({ reclassifyMarked: new Set() })
    await useStore.getState().apply()
    expect(useStore.getState().step).toBe('result')
    expect(useStore.getState().applyResult).not.toBeNull()
  })

  /**
   * applyPlan 中途失败时 res.ok 仍是 true——失败装在 result.status 里返回。
   * 这时 failedAt 之后的移动根本没执行，要是照样走部分应用那条路，会把它们的行
   * 从方案里摘掉（书签还在原地，复核页却再也找不到它），而且 applyResult 不落、
   * error 不设，用户看到进度条转完停在复核页，以为一切正常。必须退回结果页。
   */
  describe('这次应用中途失败了', () => {
    function setupFailed(): void {
      setup()
      vi.mocked(send).mockImplementation((req: { kind: string }) => {
        if (req.kind === 'apply') {
          return Promise.resolve({
            ok: true, kind: 'apply',
            result: {
              status: 'failed', executed: 1, skipped: [], createdFolderIds: ['real-1'],
              removedFolders: [], sortedFolders: 0, renamedBookmarkIds: [], mergeRootId: null,
              tempToReal: { 'tmp:1': 'real-1' }, failedAt: 1, error: '写入失败',
            },
          }) as never
        }
        if (req.kind === 'get_tree') return Promise.resolve({ ok: true, kind: 'get_tree', tree: [] }) as never
        return Promise.resolve({ ok: true }) as never
      })
    }

    it('退回结果页，把失败摆出来，不留在复核页假装成功', async () => {
      setupFailed()
      await useStore.getState().apply()
      expect(useStore.getState().step).toBe('result')
      expect(useStore.getState().applyResult).toMatchObject({ status: 'failed', error: '写入失败' })
    })

    it('一行都不从方案里摘掉——没执行的移动不能被当成已完成', async () => {
      setupFailed()
      const before = useStore.getState().plan!.rows.map((r) => r.bookmarkId)
      await useStore.getState().apply()
      expect(useStore.getState().plan!.rows.map((r) => r.bookmarkId)).toEqual(before)
    })
  })

  /**
   * 合并模式：applyPlan 学到合并容器真实 id 的唯一途径是看着它的 create_folder
   * 触发。容器在第一次应用里已经建好、create_folder 被 applyPartialResult 删掉
   * 之后，第二次应用的 mergeRootId 恒为 null——容器内清不掉空目录、补不了号、
   * 源目录不会被删，scopeRootIds 指向的源根还可能已经不存在（快照是空的，撤销
   * 回不来）。合并是一次性的整体重构，劈成两次会破坏它自己的收尾契约。
   */
  it('合并模式不走部分应用，照旧一次性跳结果页', async () => {
    setup()
    useStore.setState({
      plan: {
        ...makePlan(),
        mergeRoot: { temporaryId: 'tmp:0', title: '合并根', sourceRootIds: ['8', '9'], sourceTitles: ['旧a', '旧b'] },
      },
    })
    await useStore.getState().apply()
    expect(useStore.getState().step).toBe('result')
    expect(useStore.getState().applyResult).not.toBeNull()
    // 方案原样留着，没被 applyPartialResult 动过
    expect(useStore.getState().plan!.rows).toHaveLength(makePlan().rows.length)
  })
})

describe('失败之后的重试', () => {
  // analyze 开头要问一次 host 权限，jsdom 里没有 chrome.permissions（同上面「放弃这一轮」的桩）
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
  const originalPermissions = chromeGlobal.chrome.permissions
  beforeEach(() => {
    chromeGlobal.chrome.permissions = { contains: () => Promise.resolve(true) }
  })
  afterEach(() => {
    chromeGlobal.chrome.permissions = originalPermissions
  })

  it('analyze 失败时记下可重试的是哪一步', async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-x' }) } })
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({ ok: false, error: '后台被中断' }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().analyze()
    expect(useStore.getState().error).toBe('后台被中断')
    expect(useStore.getState().retryable).toBe('analyze')
  })

  it('scan 失败同理', async () => {
    vi.mocked(send).mockImplementation(() => Promise.resolve({ ok: false, error: 'x' }) as never)
    await useStore.getState().goScan()
    expect(useStore.getState().retryable).toBe('scan')
  })

  it('用户主动取消不算失败，不给重试', async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-x' }) } })
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({ ok: false, error: '已取消', cancelled: true }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().analyze()
    expect(useStore.getState().retryable).toBeNull()
  })

  it('retry() 重跑失败的那一步', async () => {
    useStore.setState({
      retryable: 'analyze', error: '后台被中断',
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-x' }) },
    })
    vi.mocked(send).mockImplementation((req: { kind: string }) =>
      req.kind === 'analyze'
        ? (Promise.resolve({ ok: true, kind: 'analyze', plan: makePlan() }) as never)
        : (Promise.resolve({ ok: true }) as never))

    await useStore.getState().retry()
    expect(useStore.getState().plan).not.toBeNull()
    // 成功之后重试入口收起来
    expect(useStore.getState().retryable).toBeNull()
    expect(useStore.getState().error).toBeNull()
  })

  it('reset 之后不再留着重试入口', () => {
    useStore.setState({ retryable: 'analyze', error: 'x' })
    useStore.getState().reset()
    expect(useStore.getState().retryable).toBeNull()
  })

  it('apply 失败不给重试——那一步可能已经动过书签了', async () => {
    useStore.setState({ plan: makePlan(), accepted: new Set(['100']) })
    vi.mocked(send).mockImplementation(() => Promise.resolve({ ok: false, error: '写失败' }) as never)
    await useStore.getState().apply()
    expect(useStore.getState().error).toBe('写失败')
    expect(useStore.getState().retryable).toBeNull()
  })

  // I4：权限被拒不是配置类错误——ensureHostPermission 再调一次会重新弹权限请求，重试真的有用
  it('权限被拒时显式给 retryable: analyze，不是 null', async () => {
    chromeGlobal.chrome.permissions = {
      contains: () => Promise.resolve(false),
      request: () => Promise.resolve(false),
    }
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-x' }) } })

    await useStore.getState().analyze()
    expect(useStore.getState().error).toBe(t('errHostPermission'))
    expect(useStore.getState().retryable).toBe('analyze')
  })

  // I3：导入面板与错误条同屏，扫描失败留下的 'scan' 不该在导入失败时借尸还魂——
  // 走 fail() 之后 confirmImport 自己会显式覆写 retryable，不会继承上一次的值
  it('扫描失败后改走导入，导入失败时不该带着上一次的重试入口', async () => {
    const good = JSON.stringify({
      format: 'tidymark/v1', kind: 'tree', exportedAt: '',
      roots: [{ name: 'A', children: [{ name: 'a', url: 'https://a.dev' }] }],
    })
    vi.mocked(send).mockImplementation((req: { kind: string }) => {
      if (req.kind === 'scan') return Promise.resolve({ ok: false, error: '扫描失败' }) as never
      if (req.kind === 'import') return Promise.resolve({ ok: false, error: '导入失败' }) as never
      return Promise.resolve({ ok: true }) as never
    })
    useStore.setState({ tree, checkedIds: new Set(['1']) })

    await useStore.getState().goScan()
    expect(useStore.getState().retryable).toBe('scan')

    useStore.getState().readImportFile('x.json', good)
    expect(useStore.getState().importFile).not.toBeNull()

    await useStore.getState().confirmImport()
    expect(useStore.getState().error).toBe('导入失败')
    // 点「重试」不该跑扫描——这里必须是 null，不是遗留的 'scan'
    expect(useStore.getState().retryable).toBeNull()
  })
})

/**
 * I2：errBackgroundRecycled 只有 onDisconnect 这一个来源，本票点名要求
 * 「按当时的 busyKind 填」——漏了它，端口断而 SW 未死时用户连「请重试」都看不到。
 */
describe('长连接断开时按 busyKind 派生 retryable（I2）', () => {
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
  const originalRuntime = chromeGlobal.chrome.runtime

  afterEach(() => {
    chromeGlobal.chrome.runtime = originalRuntime
  })

  function stubConnectingPort(): { disconnect: () => void } {
    let handler: (() => void) | undefined
    chromeGlobal.chrome.runtime = {
      connect: () => ({
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: (fn: () => void) => { handler = fn } },
        postMessage: () => {},
        disconnect: () => {},
      }),
    }
    return { disconnect: () => handler?.() }
  }

  it('busyKind 是 analyze 时，给 retryable: analyze', async () => {
    const port = stubConnectingPort()
    vi.mocked(send).mockImplementation(() => Promise.resolve({ ok: true }) as never)

    await useStore.getState().init()
    useStore.setState({ busy: '正在分析…', busyKind: 'analyze' })
    port.disconnect()

    expect(useStore.getState().error).toBe(t('errBackgroundRecycled'))
    expect(useStore.getState().retryable).toBe('analyze')
  })

  it('busyKind 是 apply 这类不可重试的步骤时，不给重试入口', async () => {
    const port = stubConnectingPort()
    vi.mocked(send).mockImplementation(() => Promise.resolve({ ok: true }) as never)

    await useStore.getState().init()
    useStore.setState({ busy: '正在写入…', busyKind: 'apply' })
    port.disconnect()

    expect(useStore.getState().error).toBe(t('errBackgroundRecycled'))
    expect(useStore.getState().retryable).toBeNull()
  })
})

describe('测试连接按对记结果', () => {
  const chromeGlobal = globalThis as unknown as { chrome: { permissions: unknown } }
  const originalPermissions = chromeGlobal.chrome.permissions
  beforeEach(() => {
    chromeGlobal.chrome.permissions = { contains: () => Promise.resolve(true) }
    vi.mocked(send).mockReset()
    useStore.setState({
      modelTests: {},
      settings: {
        ...DEFAULT_SETTINGS,
        endpoints: [{ baseUrl: 'https://x/v1', apiKey: 'k', models: ['a', 'b'] }],
        active: { baseUrl: 'https://x/v1', model: 'a' },
      },
    })
  })
  afterEach(() => {
    chromeGlobal.chrome.permissions = originalPermissions
  })

  it('结果落在被测的那一对上，另一对不受影响', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'test_model', ms: 12 } as never)

    await useStore.getState().testModel('https://x/v1', 'sk', 'a')
    const tests = useStore.getState().modelTests
    expect(tests[modelTestKey('https://x/v1', 'a')]?.state).toBe('ok')
    expect(tests[modelTestKey('https://x/v1', 'b')]).toBeUndefined()
  })

  // 设置页一个模型一行一个测试按钮，后测的那行不该盖掉前一行的结论
  it('测第二对时第一对的结论还在', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'test_model', ms: 12 } as never)
    await useStore.getState().testModel('https://x/v1', 'sk', 'a')

    vi.mocked(send).mockResolvedValue({ ok: false, error: '401', reason: 'auth' } as never)
    await useStore.getState().testModel('https://x/v1', 'sk', 'b')


    const tests = useStore.getState().modelTests
    expect(tests[modelTestKey('https://x/v1', 'a')]?.state).toBe('ok')
    expect(tests[modelTestKey('https://x/v1', 'b')]?.state).toBe('fail')
  })

  it('末尾斜杠不算另一对', () => {
    expect(modelTestKey('https://x/v1/', 'a')).toBe(modelTestKey('https://x/v1', 'a'))
  })

  it('resetModelTest 清空整张表——上次那些结论摆着会撒谎', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'test_model', ms: 12 } as never)
    await useStore.getState().testModel('https://x/v1', 'sk', 'a')

    useStore.getState().resetModelTest()
    expect(useStore.getState().modelTests).toEqual({})
  })

  it('权限被拒时那一对记成 permission，一个请求都不发', async () => {
    chromeGlobal.chrome.permissions = {
      contains: () => Promise.resolve(false), request: () => Promise.resolve(false),
    }
    await useStore.getState().testModel('https://x/v1', 'sk', 'a')

    expect(useStore.getState().modelTests[modelTestKey('https://x/v1', 'a')]?.reason)
      .toBe('permission')
    expect(vi.mocked(send).mock.calls.some(([r]) => (r as { kind: string }).kind === 'test_model'))
      .toBe(false)
  })
})

describe('清理模式的勾选', () => {
  it('切换保留哪条时，原保留项进待删、新保留项出待删', () => {
    const store = useStore.getState()
    store.setMode('cleanup')
    useStore.setState({
      cleanupScan: {
        duplicates: [{
          kind: 'exact', key: 'https://a', keepId: '1',
          items: [
            { id: '1', title: 'a', url: 'https://a', parentId: 'p', index: 0, currentPath: [] },
            { id: '2', title: 'a', url: 'https://a', parentId: 'p', index: 1, currentPath: [] },
          ],
        }],
        emptyFolders: [], items: [], folders: [], scopeRootIds: ['1'],
      },
      cleanupKeep: { 'https://a': '1' },
      cleanupChecked: new Set(['2']),
    })

    useStore.getState().setCleanupKeep('https://a', '2')

    const state = useStore.getState()
    expect(state.cleanupKeep['https://a']).toBe('2')
    expect(state.cleanupChecked.has('2')).toBe(false)
    expect(state.cleanupChecked.has('1')).toBe(true)
  })
})

/**
 * MV3 的 service worker 空闲 30 秒就被回收，而 keepalive 只在长任务期间 ping。
 * 用户在「选范围」勾目录树、翻「偏好」页的那几十秒里没有任何消息流动，SW 被回收、
 * 长连接断开——而 onDisconnect 在空闲时是静默返回的。
 *
 * 改造前 connectProgress 整个生命周期只在 init() 调一次，于是这条死掉的通道再也
 * 不会回来：之后每一次分析，方案照常从 sendMessage 返回，进度事件却全被后台丢掉
 * （sessions.emit 查不到这个 clientId）。用户看到的就是「运行日志 1 条」——只剩
 * 侧栏自己写的那一行，看起来像模型压根没被调用。
 */
describe('长连接断在空闲期时，下一次长任务前重连', () => {
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
  const originalRuntime = chromeGlobal.chrome.runtime
  const originalPermissions = chromeGlobal.chrome.permissions

  beforeEach(() => {
    chromeGlobal.chrome.permissions = { contains: () => Promise.resolve(true) }
  })
  afterEach(() => {
    chromeGlobal.chrome.runtime = originalRuntime
    chromeGlobal.chrome.permissions = originalPermissions
  })

  /** 每次 connect 造一条新通道，各自记着自己的两个回调。 */
  function stubPorts(): {
    count: () => number
    latest: () => { emit: (event: ProgressEvent) => void; disconnect: () => void }
  } {
    const ports: { emit: (e: ProgressEvent) => void; disconnect: () => void }[] = []
    chromeGlobal.chrome.runtime = {
      connect: () => {
        let onEvent: ((e: ProgressEvent) => void) | undefined
        let onGone: (() => void) | undefined
        ports.push({
          emit: (event) => onEvent?.(event),
          disconnect: () => onGone?.(),
        })
        return {
          onMessage: { addListener: (fn: (e: ProgressEvent) => void) => { onEvent = fn } },
          onDisconnect: { addListener: (fn: () => void) => { onGone = fn } },
          postMessage: () => {},
          disconnect: () => {},
        }
      },
    }
    return { count: () => ports.length, latest: () => ports[ports.length - 1]! }
  }

  it('空闲期断线后，analyze 会重新连上并收得到进度事件', async () => {
    const ports = stubPorts()
    vi.mocked(send).mockImplementation((req) =>
      Promise.resolve(
        req.kind === 'analyze'
          ? { ok: true, kind: 'analyze', plan: makePlan() }
          : { ok: true, kind: req.kind, tree: [], settings: DEFAULT_SETTINGS, available: false },
      ) as never,
    )

    await useStore.getState().init()
    expect(ports.count()).toBe(1)

    // 用户在范围页停留超过 30 秒，SW 被回收
    useStore.setState({ busy: null, busyKind: null })
    ports.latest().disconnect()

    await useStore.getState().analyze()

    // 重连过，而且新通道推来的事件真的进得了日志
    expect(ports.count()).toBe(2)
    const before = useStore.getState().logs.length
    ports.latest().emit({ phase: 'classify', message: '分类批次 1/1 完成' })
    expect(useStore.getState().logs.length).toBe(before + 1)
    expect(useStore.getState().logs.at(-1)!.message).toContain('分类批次 1/1 完成')
  })

  it('通道还活着时不重复连', async () => {
    const ports = stubPorts()
    vi.mocked(send).mockImplementation((req) =>
      Promise.resolve(
        req.kind === 'analyze'
          ? { ok: true, kind: 'analyze', plan: makePlan() }
          : { ok: true, kind: req.kind, tree: [], settings: DEFAULT_SETTINGS, available: false },
      ) as never,
    )

    await useStore.getState().init()
    await useStore.getState().analyze()
    expect(ports.count()).toBe(1)
  })
})
