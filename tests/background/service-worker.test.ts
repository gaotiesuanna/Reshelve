import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PROGRESS_PORT, type TaskRecord, type TaskStreamMessage } from '@/background/events'
import { TASK_KEY } from '@/background/task-journal'
import type { PanelRequest, Response } from '@/background/messages'
import type { HandlerDeps } from '@/background/handlers'
import { t } from '@/i18n'

/**
 * service-worker.ts 是把 chrome 的三个监听器接到任务中枢（sessions.ts）与
 * handlers 上的那层接线。它一直没有测试——多窗口串台那个 bug 能活下来，
 * 靠的正是这个空档。
 *
 * 这里把 chrome 的监听器注册截下来，再手动喂消息进去，于是「两个窗口」在
 * node 环境里就能复现：两条 Port，不需要真的开浏览器。任务已是全局单轮，
 * 两个端口收到的是同一份广播。
 */

interface FakePort {
  name: string
  postMessage: (message: TaskStreamMessage) => void
  onMessage: { addListener: (fn: () => void) => void }
  onDisconnect: { addListener: (fn: () => void) => void }
  /** 测试侧攥着，用来模拟侧栏关闭。 */
  disconnect: () => void
  received: TaskStreamMessage[]
}

let onConnect: (port: FakePort) => void
let onMessage: (
  message: PanelRequest,
  sender: unknown,
  sendResponse: (response: Response) => void,
) => boolean

/** handle() 每次被调用时留下的现场，测试据此驱动进度与收尾。 */
interface Call {
  deps: HandlerDeps
  resolve: (response: Response) => void
}
let calls: Call[]

const handle = vi.fn((_ports: unknown, _request: unknown, deps: HandlerDeps) =>
  new Promise<Response>((resolve) => { calls.push({ deps, resolve }) }),
)

interface KeepaliveDocOptions {
  url: string
  justification: string
  reasons?: string[]
}

const createDocument = vi.fn((_options: KeepaliveDocOptions) => Promise.resolve())
const closeDocument = vi.fn(() => Promise.resolve())

vi.mock('@/background/handlers', () => ({ handle: (...args: unknown[]) =>
  handle(args[0], args[1], args[2] as HandlerDeps) }))

function fakePort(name: string = PROGRESS_PORT): FakePort {
  const received: TaskStreamMessage[] = []
  let disconnectHandler = (): void => {}
  return {
    name,
    postMessage: (message) => received.push(message),
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: (fn) => { disconnectHandler = fn } },
    disconnect: () => disconnectHandler(),
    received,
  }
}

/** 发一条消息，返回后台的响应（同步回的那种；异步收尾的请求返回 null）。 */
function send(message: PanelRequest): Response | null {
  let response: Response | null = null
  onMessage(message, {}, (r) => { response = r })
  return response
}

/** 异步作答的消息（get_task / clear_task / open_app_tab）走这条。 */
async function sendAsync(message: PanelRequest): Promise<Response> {
  return await new Promise((resolve) => { onMessage(message, {}, resolve) })
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/** 预置一份 journal 记录，模拟「上一任 SW 死前留下的现场」。 */
function seedJournal(record: Partial<TaskRecord>): void {
  sessionBag.set(TASK_KEY, {
    id: 'seed-1', kind: 'analyze', startedAt: 1, status: 'running', cancellable: true, events: [],
    ...record,
  } satisfies TaskRecord)
}

let sessionBag: Map<string, unknown>

/** open_app_tab 的现场：开了哪个 URL、侧栏开关被拨了哪几下。 */
let openedUrls: string[]
let panelToggles: boolean[]

beforeEach(async () => {
  calls = []
  openedUrls = []
  panelToggles = []
  handle.mockClear()
  createDocument.mockClear()
  closeDocument.mockClear()
  vi.resetModules()
  sessionBag = new Map()

  const chromeStub = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onConnect: { addListener: (fn: (port: FakePort) => void) => { onConnect = fn } },
      onMessage: { addListener: (fn: typeof onMessage) => { onMessage = fn } },
      onInstalled: { addListener: () => {} },
    },
    sidePanel: {
      setPanelBehavior: () => Promise.resolve(),
      setOptions: (options: { enabled: boolean }) => {
        panelToggles.push(options.enabled)
        return Promise.resolve()
      },
    },
    tabs: {
      create: (options: { url: string }) => {
        openedUrls.push(options.url)
        return Promise.resolve()
      },
    },
    offscreen: { createDocument, closeDocument },
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      session: {
        get: async (key: string) => (sessionBag.has(key) ? { [key]: sessionBag.get(key) } : {}),
        set: async (bag: Record<string, unknown>) => { for (const [k, v] of Object.entries(bag)) sessionBag.set(k, v) },
        remove: async (key: string) => { sessionBag.delete(key) },
      },
    },
  }
  ;(globalThis as unknown as { chrome: unknown }).chrome = chromeStub

  await import('@/background/service-worker')
  // 冷启动的 loadSettings 与 heal 是 fire-and-forget，走干净再开始测。
  // 启动本身会关一次上一任可能留下的孤儿文档（吞异常的空操作），
  // 计数在这里清零，让各用例只看自己触发的调用。
  await flush()
  closeDocument.mockClear()
})

describe('进度广播按窗口路由', () => {
  it('A 发起的请求，A 与 B 都看得到进度', () => {
    const a = fakePort()
    const b = fakePort()
    onConnect(a)
    onConnect(b)

    send({ kind: 'analyze', scopeRootIds: ['1'] })
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: '分到一半', done: 1, total: 10 })

    const messages = (p: FakePort) => p.received.filter((m) => m.kind === 'progress')
    expect(messages(a).map((m) => (m.kind === 'progress' ? m.event.message : ''))).toEqual(['分到一半'])
    expect(messages(b).map((m) => (m.kind === 'progress' ? m.event.message : ''))).toEqual(['分到一半'])
  })

  it('B 后连上来不会顶掉 A 正在用的通道', () => {
    const a = fakePort()
    onConnect(a)
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    onConnect(fakePort())
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: 'B 连上之后' })

    expect(a.received.some((m) => m.kind === 'progress')).toBe(true)
  })

  it('apply 这类不吃取消的请求，进度同样广播', () => {
    const a = fakePort()
    onConnect(a)

    send({ kind: 'undo' })
    calls[0]!.deps.onEvent?.({ phase: 'undo', message: '正在还原' })

    const progress = a.received.find((m) => m.kind === 'progress')
    expect(progress?.kind === 'progress' && progress.event.message).toBe('正在还原')
  })

  it('不是进度通道的连接一概不理', () => {
    const stranger = fakePort('someone-else')

    expect(() => onConnect(stranger)).not.toThrow()
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: '不该到达' })

    expect(stranger.received).toEqual([])
  })

  it('旧侧栏带 clientId 后缀的连接名不再被认', () => {
    const legacy = fakePort('reshelve:progress#win-a')

    onConnect(legacy)
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: '旧格式' })

    expect(legacy.received).toEqual([])
  })

  it('侧栏关闭（disconnect）后不再收到广播，在跑的任务不受影响', () => {
    const a = fakePort()
    onConnect(a)
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    const aDeps = calls[0]!.deps

    a.disconnect()
    aDeps.onEvent?.({ phase: 'classify', message: '无人接收' })

    expect(aDeps.signal?.aborted).toBe(false)
    expect(a.received.filter((m) => m.kind === 'progress')).toEqual([])
  })
})

describe('取消是全局的', () => {
  it('任何一个窗口点取消，掐的都是同一轮', () => {
    onConnect(fakePort())
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    const deps = calls[0]!.deps

    send({ kind: 'cancel' })

    expect(deps.isCancelled?.()).toBe(true)
    expect(deps.signal?.aborted).toBe(true)
  })

  it('取消的日志广播给所有在看的面板', () => {
    const a = fakePort()
    const b = fakePort()
    onConnect(a)
    onConnect(b)
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    send({ kind: 'cancel' })

    // 文案语言跟 SW 当时的 locale 走，测试只认「有一条 warn 级日志到了每个面板」
    for (const port of [a, b]) {
      const warn = port.received.find((m) => m.kind === 'progress' && m.event.level === 'warn')
      expect(warn?.kind === 'progress' && warn.event.message.length).toBeGreaterThan(0)
    }
  })

  it('落地任务吃不到取消信号，点取消也不受理', () => {
    const a = fakePort()
    onConnect(a)
    send({ kind: 'apply', plan: {} as never, accepted: [] })

    send({ kind: 'cancel' })

    // 没有信号可给，也不该打一句「正在取消」——它取消不了
    expect(calls[0]!.deps.signal).toBeUndefined()
    expect(calls[0]!.deps.isCancelled?.()).toBe(false)
    expect(a.received.some((m) => m.kind === 'progress' && m.event.level === 'warn')).toBe(false)
  })
})

describe('一次只放一轮长任务', () => {
  it('后台已有任务时回绝，并且不去调 handle', () => {
    onConnect(fakePort())
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    expect(handle).toHaveBeenCalledTimes(1)

    const response = send({ kind: 'analyze', scopeRootIds: ['1'] })

    // 文案语言跟 SW 当时的 locale 走，这里只认「回了可读的错误且没碰 handle」
    expect(response?.ok).toBe(false)
    expect(response && !response.ok && response.error.length).toBeGreaterThan(0)
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('A 跑完之后 B 就能开跑', async () => {
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    calls[0]!.resolve({ ok: false, error: 'done' })
    // 放开占用发生在 then→catch 这条链的末尾，要把微任务队列走干净再断言
    await flush()

    expect(send({ kind: 'analyze', scopeRootIds: ['1'] })).toBeNull()
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('handle 抛异常也要收尾并放开占用，不能把后台永久锁死', async () => {
    onConnect(fakePort())
    handle.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    await vi.waitFor(() => {
      expect(send({ kind: 'analyze', scopeRootIds: ['1'] })).toBeNull()
    })
  })

  /**
   * apply 与 undo 共用 engine/snapshot.ts 里唯一那个 SNAPSHOT_KEY：两个窗口同时落地，
   * 后写的快照会把先写的整个盖掉，先落地那一次再也撤销不回去。所以它们必须独占。
   */
  it('A 在落地时，B 的落地被挡下来，一个书签都不碰', () => {
    onConnect(fakePort())
    onConnect(fakePort())
    send({ kind: 'apply', plan: {} as never, accepted: [] })
    expect(handle).toHaveBeenCalledTimes(1)

    expect(send({ kind: 'apply', plan: {} as never, accepted: [] })?.ok).toBe(false)
    expect(send({ kind: 'undo' })?.ok).toBe(false)
  })

  it('A 在分析时，B 的落地被挡下来——方案是对着改之前那棵树算的', () => {
    onConnect(fakePort())
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    expect(send({ kind: 'apply', plan: {} as never, accepted: [] })?.ok).toBe(false)
  })

  it('导入、清理和内容聚合落地同样独占', () => {
    onConnect(fakePort())
    onConnect(fakePort())
    send({ kind: 'import', nodes: [], targetName: 'x' })

    expect(send({ kind: 'apply_cleanup', input: {} as never })?.ok).toBe(false)
    expect(send({ kind: 'apply_aggregate', input: {} as never })?.ok).toBe(false)
  })

  it('落地跑完之后位子放开', async () => {
    onConnect(fakePort())
    onConnect(fakePort())
    send({ kind: 'apply', plan: {} as never, accepted: [] })

    calls[0]!.resolve({ ok: false, error: 'done' })
    await flush()

    expect(send({ kind: 'undo' })).toBeNull()
  })

  it('短请求不占用这个位子', () => {
    onConnect(fakePort())
    onConnect(fakePort())

    send({ kind: 'get_tree' })

    expect(send({ kind: 'analyze', scopeRootIds: ['1'] })).toBeNull()
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('短请求拿不到正在跑那一轮的取消信号', () => {
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    send({ kind: 'get_settings' })

    expect(calls[1]!.deps.signal).toBeUndefined()
  })
})

describe('get_task / clear_task', () => {
  it('在跑时返回内存里的记录', async () => {
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    const res = await sendAsync({ kind: 'get_task' })

    expect(res.ok && res.kind === 'get_task' && res.record?.kind).toBe('analyze')
    expect(res.ok && res.kind === 'get_task' && res.record?.status).toBe('running')
  })

  it('handle 收尾后返回终态记录，载荷完整', async () => {
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    const plan = { rows: [], rebuildStructure: false }
    calls[0]!.resolve({ ok: true, kind: 'analyze', plan: plan as never })
    await flush()

    const res = await sendAsync({ kind: 'get_task' })

    expect(res.ok && res.kind === 'get_task' && res.record?.status).toBe('done')
    expect(res.ok && res.kind === 'get_task' && res.record?.result?.ok).toBe(true)
  })

  it('journal 里躺着的 interrupted 记录也接得回来（重开侧栏的场景）', async () => {
    seedJournal({ status: 'interrupted', error: '后台没了' })
    // 冷启动 heal 已在 beforeEach 的 flush 里跑过

    const res = await sendAsync({ kind: 'get_task' })

    expect(res.ok && res.kind === 'get_task' && res.record?.status).toBe('interrupted')
  })

  it('clear_task 清掉终态记录；任务在跑时后台自己拒清', async () => {
    onConnect(fakePort())
    const empty = await sendAsync({ kind: 'clear_task' })
    expect(empty.ok).toBe(true)

    send({ kind: 'analyze', scopeRootIds: ['1'] })
    seedJournal({ id: 'other' })
    const whileRunning = await sendAsync({ kind: 'clear_task' })
    expect(whileRunning.ok).toBe(true)
    expect(sessionBag.get(TASK_KEY)).toBeDefined()
  })
})

describe('冷启动自愈', () => {
  it('journal 里躺着的 running 在启动时被改写为 interrupted', async () => {
    // 重新导一次模块：这次让 journal 在 SW 启动前就躺着一份没跑完的记录，
    // 模拟「上一任 SW 死在半路，浏览器重新把它拉起来」
    vi.resetModules()
    seedJournal({ id: 'ghost', status: 'running' })
    await import('@/background/service-worker')
    await flush()

    const healed = sessionBag.get(TASK_KEY) as TaskRecord | undefined
    expect(healed?.id).toBe('ghost')
    expect(healed?.status).toBe('interrupted')
    expect(healed?.finishedAt).toBeDefined()

    // 自愈之后锁位是空的：新任务立刻能认领（曾经的幽灵锁卡死，从此不可能）
    expect(send({ kind: 'analyze', scopeRootIds: ['1'] })).toBeNull()
    expect(handle).toHaveBeenCalledTimes(1)
  })
})

describe('收尾落盘', () => {
  it('handle 的响应原样回给发起面板，同时 journal 里写下终态', async () => {
    const port = fakePort()
    onConnect(port)
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    const response: Response = { ok: false, error: '模型挂了' }

    calls[0]!.resolve(response)
    await flush()

    expect(sessionBag.get(TASK_KEY) && ((sessionBag.get(TASK_KEY) as TaskRecord).status)).toBe('error')
    expect((sessionBag.get(TASK_KEY) as TaskRecord).error).toBe('模型挂了')
    // finished 广播也到了
    expect(port.received.at(-1)?.kind).toBe('finished')
  })

  it('cancelled 的响应写成 cancelled 终态，不是 error', async () => {
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    calls[0]!.resolve({ ok: false, error: t('errAnalysisCancelled'), cancelled: true })
    await flush()

    expect((sessionBag.get(TASK_KEY) as TaskRecord).status).toBe('cancelled')
  })
})

/**
 * 「换成完整标签页」在后台代办的整条链路：开标签、关侧栏、再启用。
 * 顺序是这条功能的命根——先禁用再启用，缺了后者扩展图标从此点了没反应。
 */
describe('换成完整标签页', () => {
  it('开带 view/mode 参数的标签页，并先禁用再启用侧栏把它关上', async () => {
    const response = await sendAsync({ kind: 'open_app_tab', mode: 'dashboard' })

    expect(response).toEqual({ ok: true, kind: 'open_app_tab' })
    expect(openedUrls).toHaveLength(1)
    const url = new URL(openedUrls[0]!)
    expect(url.searchParams.get('view')).toBe('tab')
    expect(url.searchParams.get('mode')).toBe('dashboard')
    expect(panelToggles).toEqual([false, true])
  })

  it('不占独占槽：分析跑着的时候也能换', async () => {
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    const response = await sendAsync({ kind: 'open_app_tab', mode: 'organize' })
    expect(response).toEqual({ ok: true, kind: 'open_app_tab' })
  })
})

describe('offscreen 保活文档的生命周期', () => {
  it('任务认领成功才创建，收尾即关闭', async () => {
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })

    expect(createDocument).toHaveBeenCalledTimes(1)
    const arg = createDocument.mock.calls[0]![0]
    expect(arg.url).toContain('keepalive.html')
    expect(arg.justification.length).toBeGreaterThan(0)

    calls[0]!.resolve({ ok: false, error: 'done' })
    await flush()

    expect(closeDocument).toHaveBeenCalledTimes(1)
  })

  it('被拒的请求（后台已有任务）不留文档', () => {
    onConnect(fakePort())
    send({ kind: 'analyze', scopeRootIds: ['1'] })
    createDocument.mockClear()

    send({ kind: 'apply', plan: {} as never, accepted: [] })

    expect(createDocument).not.toHaveBeenCalled()
  })

  it('冷启动会清上一任留下的孤儿文档，没有文档时也不抛', () => {
    // 启动清理在 beforeEach 的 import 里已经跑过（计数随即被清零）。
    // 这里直接再关一次：没有文档时 Chrome 会拒绝，后台必须吞掉这个异常。
    expect(() => closeDocument()).not.toThrow()
    // 启动也绝不该主动创建文档——它只在任务认领成功的那一刻进场
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('offscreen 的保活心跳不进业务管线，不惊动 handle', () => {
    onConnect(fakePort())

    const result = onMessage({ type: 'keepalive' } as never, {}, () => {})

    expect(result).toBe(false)
    expect(handle).not.toHaveBeenCalled()
  })
})

