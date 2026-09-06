import { describe, it, expect, vi } from 'vitest'
import { createTaskHub } from '@/background/sessions'
import { TASK_KEY, appendEvent, MAX_TASK_EVENTS, healTask } from '@/background/task-journal'
import type { TaskRecord, TaskStreamMessage, ProgressEvent } from '@/background/events'
import type { Response } from '@/background/messages'
import type { TaskStorage } from '@/background/task-journal'

function event(message: string): ProgressEvent {
  return { phase: 'classify', message }
}

/** 内存版 storage.session：journal 的读写都落在 bag 里，测试直接翻看。 */
function fakeStorage(): TaskStorage & { bag: Map<string, unknown> } {
  const bag = new Map<string, unknown>()
  return {
    bag,
    get: async <T,>(key: string): Promise<T | null> => (bag.has(key) ? (bag.get(key) as T) : null),
    set: async (key: string, value: unknown): Promise<void> => { bag.set(key, value) },
    remove: async (key: string): Promise<void> => { bag.delete(key) },
  }
}

/** 两个窗口的侧栏各连一条广播，返回各自收到的消息数组。 */
function twoWindows(storage = fakeStorage()) {
  const hub = createTaskHub(storage)
  const a: TaskStreamMessage[] = []
  const b: TaskStreamMessage[] = []
  hub.attach((m) => a.push(m))
  hub.attach((m) => b.push(m))
  return { hub, storage, a, b }
}

describe('进度广播给所有观察的面板', () => {
  it('推给任何一条连接的事件，两条连接都收得到', () => {
    // 与按 clientId 单播的时代正相反：任务是全局的，每个打开的侧栏都该看到它
    const { hub, a, b } = twoWindows()
    expect(hub.begin('analyze', true)).toBe(true)

    hub.emit(event('分到一半'))

    expect(a).toHaveLength(2) // started + progress
    expect(b).toHaveLength(2)
    expect(a[1]!.kind === 'progress' && a[1]!.event.message).toBe('分到一半')
    expect(b[1]!.kind === 'progress' && b[1]!.event.message).toBe('分到一半')
  })

  it('一条连接断了（postMessage 抛出）不影响其他连接，且被当场注销', () => {
    const { hub, b } = twoWindows()
    expect(hub.begin('analyze', true)).toBe(true)
    const broken = vi.fn(() => { throw new Error('Attempting to use a disconnected port object') })
    hub.attach(broken)
    b.length = 0 // 只看这条 emit 之后收到的

    hub.emit(event('第一条'))

    expect(broken).toHaveBeenCalledTimes(1)
    expect(b.map((m) => m.kind)).toEqual(['progress'])
  })

  it('detach 之后不再收到广播', () => {
    const hub = createTaskHub(fakeStorage())
    const received: TaskStreamMessage[] = []
    const post = (m: TaskStreamMessage) => received.push(m)
    hub.attach(post)
    hub.detach(post)

    expect(hub.begin('undo', false)).toBe(true)

    // undo 不可取消、started 广播照发，但已退订的连接不该再收到
    expect(received).toEqual([])
  })

  it('没有在跑的任务时 emit 是空操作', () => {
    const { hub, a } = twoWindows()
    expect(() => hub.emit(event('无人 hear'))).not.toThrow()
    expect(a).toEqual([])
  })
})

describe('一次只放一轮任务', () => {
  it('已有任务在跑时认领失败', () => {
    const { hub } = twoWindows()
    expect(hub.begin('analyze', true)).toBe(true)
    expect(hub.begin('analyze', true)).toBe(false)
  })

  it('收尾之后别人才能认领', () => {
    const { hub } = twoWindows()
    hub.begin('analyze', true)
    hub.end({ ok: false, error: 'done' })

    expect(hub.begin('apply', false)).toBe(true)
  })

  it('end 之后的进度事件不再受理、不再广播', () => {
    const { hub, a } = twoWindows()
    hub.begin('analyze', true)
    hub.end({ ok: false, error: 'done' })

    hub.emit(event('迟到的进度'))

    expect(a).toHaveLength(2) // started + finished，没有第三条
  })
})

describe('取消', () => {
  it('任何连接点取消，掐的都是同一轮', () => {
    // 曾经按 clientId 分家，A 的取消掐不到 B；现在任务是全局的，取消也是
    const { hub } = twoWindows()
    hub.begin('analyze', true)
    const signal = hub.signal()

    expect(hub.cancel()).toBe(true)
    expect(hub.isCancelled()).toBe(true)
    expect(signal?.aborted).toBe(true)
  })

  it('取消后 journal 的状态改为 cancelling，重开侧栏看得到', async () => {
    const { hub, storage } = twoWindows()
    hub.begin('analyze', true)

    hub.cancel()
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    const record = storage.bag.get(TASK_KEY) as TaskRecord
    expect(record.status).toBe('cancelling')
  })

  it('不可取消的任务连取消都不受理，免得日志说一句做不到的话', () => {
    const { hub } = twoWindows()
    hub.begin('apply', false)

    expect(hub.cancel()).toBe(false)
    expect(hub.isCancelled()).toBe(false)
    expect(hub.signal()).toBeUndefined()
  })
})

describe('journal 落盘', () => {
  it('begin 就把任务记录写进 storage.session', async () => {
    const { hub, storage } = twoWindows()
    expect(hub.begin('analyze', true)).toBe(true)
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    const record = storage.bag.get(TASK_KEY) as TaskRecord
    expect(record.kind).toBe('analyze')
    expect(record.status).toBe('running')
    expect(record.cancellable).toBe(true)
    expect(record.events).toEqual([])
    expect(record.id).toBeTruthy()
  })

  it('emit 追加事件并落盘', async () => {
    const { hub, storage } = twoWindows()
    hub.begin('analyze', true)
    hub.emit(event('批次 1/3'))
    hub.emit(event('批次 2/3'))
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    const record = storage.bag.get(TASK_KEY) as TaskRecord
    expect(record.events.map((e) => e.message)).toEqual(['批次 1/3', '批次 2/3'])
  })

  it('事件超过上限时丢掉最旧的（环形缓冲）', async () => {
    const { hub, storage } = twoWindows()
    hub.begin('analyze', true)
    for (let i = 0; i < MAX_TASK_EVENTS + 10; i++) hub.emit(event(`第 ${i} 条`))
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    const record = storage.bag.get(TASK_KEY) as TaskRecord
    expect(record.events).toHaveLength(MAX_TASK_EVENTS)
    expect(record.events[0]!.message).toBe(`第 10 条`)
    expect(record.events.at(-1)!.message).toBe(`第 ${MAX_TASK_EVENTS + 9} 条`)
  })

  it('正常收尾写 done 与完整响应载荷', async () => {
    const { hub, storage } = twoWindows()
    hub.begin('analyze', true)
    hub.emit(event('跑了几分钟'))
    const response: Response = { ok: true, kind: 'analyze', plan: { rows: [] } as never }

    hub.end(response)
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    const record = storage.bag.get(TASK_KEY) as TaskRecord
    expect(record.status).toBe('done')
    expect(record.result).toEqual(response)
    expect(record.error).toBeUndefined()
    // 同一毫秒内开始与收尾时取等即可，别要求严格大于
    expect(record.finishedAt).toBeGreaterThanOrEqual(record.startedAt)
  })

  it('失败收尾写 error，取消收尾写 cancelled', async () => {
    const first = twoWindows()
    first.hub.begin('undo', false)
    first.hub.end({ ok: false, error: 'boom' })

    const second = twoWindows()
    second.hub.begin('analyze', true)
    second.hub.cancel()
    second.hub.end({ ok: false, error: 'cancelled', cancelled: true })

    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect((first.storage.bag.get(TASK_KEY) as TaskRecord).status).toBe('error')
    expect((first.storage.bag.get(TASK_KEY) as TaskRecord).error).toBe('boom')
    expect((second.storage.bag.get(TASK_KEY) as TaskRecord).status).toBe('cancelled')
    expect((second.storage.bag.get(TASK_KEY) as TaskRecord).result).toBeUndefined()
  })

  it('收尾广播的 finished 携带完整记录（含缓冲的事件）', () => {
    const { hub, a } = twoWindows()
    hub.begin('analyze', true)
    hub.emit(event('历史事件'))

    hub.end({ ok: true, kind: 'scan', scan: { stats: {} } as never })

    expect(a).toHaveLength(3)
    const finished = a[2]!
    expect(finished.kind === 'finished' && finished.record.status).toBe('done')
    expect(finished.kind === 'finished' && finished.record.events.map((e) => e.message)).toEqual(['历史事件'])
  })
})

describe('record 与 clear', () => {
  /** persist 是 fire-and-forget，把微任务与定时器队列走干净再断言落盘。 */
  const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

  it('在跑时内存优先，收尾后回落到 journal', async () => {
    const { hub } = twoWindows()
    hub.begin('check_links', true)
    expect(((await hub.record()) as TaskRecord).status).toBe('running')

    hub.end({ ok: true, kind: 'check_links', results: [] })
    expect(((await hub.record()) as TaskRecord).status).toBe('done')

    await flush()
    await hub.clear()
    expect(await hub.record()).toBeNull()
  })

  it('任务在跑时 clear 是有意不动的，收尾后才能清', async () => {
    const { hub, storage } = twoWindows()
    hub.begin('analyze', true)

    await hub.clear()
    expect(storage.bag.has(TASK_KEY)).toBe(true)

    hub.end({ ok: false, error: 'done' })
    await hub.clear()
    expect(storage.bag.has(TASK_KEY)).toBe(false)
  })
})

describe('冷启动自愈', () => {
  it('journal 里躺着的 running 被改写为 interrupted', async () => {
    const storage = fakeStorage()
    storage.bag.set(TASK_KEY, {
      id: 't1', kind: 'analyze', startedAt: 1, status: 'running', cancellable: true, events: [],
    } satisfies TaskRecord)

    const healed = await healTask(storage)

    expect(healed?.status).toBe('interrupted')
    expect((storage.bag.get(TASK_KEY) as TaskRecord).status).toBe('interrupted')
  })

  it('cancelling 同样算半路死亡', async () => {
    const storage = fakeStorage()
    storage.bag.set(TASK_KEY, {
      id: 't1', kind: 'analyze', startedAt: 1, status: 'cancelling', cancellable: true, events: [],
    } satisfies TaskRecord)

    expect((await healTask(storage))?.status).toBe('interrupted')
  })

  it('终态记录原样放过，不动也不重写', async () => {
    const storage = fakeStorage()
    const done: TaskRecord = {
      id: 't1', kind: 'apply', startedAt: 1, status: 'done', cancellable: false, events: [],
      result: { ok: true, kind: 'apply', result: {} as never }, finishedAt: 2,
    }
    storage.bag.set(TASK_KEY, done)

    expect(await healTask(storage)).toBe(done)
  })

  it('journal 为空时无事可做', async () => {
    expect(await healTask(fakeStorage())).toBeNull()
  })
})

describe('appendEvent 是纯函数', () => {
  it('不改原记录，返回新记录', () => {
    const before: TaskRecord = {
      id: 't1', kind: 'analyze', startedAt: 1, status: 'running', cancellable: true, events: [],
    }
    const after = appendEvent(before, event('一条'))

    expect(before.events).toEqual([])
    expect(after.events.map((e) => e.message)).toEqual(['一条'])
    expect(after).not.toBe(before)
  })
})
