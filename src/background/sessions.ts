import type { ProgressEvent, TaskRecord, TaskStreamMessage } from './events'
import type { Request, Response } from './messages'
import { appendEvent, clearTask, healTask, readTask, writeTask, type TaskStorage } from './task-journal'

/**
 * 后台唯一那轮独占任务的管理：认领、进度广播、取消、收尾。
 *
 * 历史包袱说明这一层为什么长这样。Chrome 的侧栏每个窗口一个实例，而 SW 全局只有
 * 一个；最早三样东西（progressPort、cancelled、AbortController）都是模块级单槽，
 * 两个窗口同时开侧栏会撞出两种事故：后连上的把 progressPort 顶掉、先开那个窗口的
 * 进度当场哑掉；在任一窗口点取消会掐掉另一窗口那轮已经花了钱的分析。后来按
 * clientId 把每个窗口分了家。
 *
 * 再后来发现分家分错了方向：**任务是全局的，不是窗口的**。独占锁本来就只放一轮；
 * 按 clientId 认主，意味着持有者一关侧栏就成了没人认领的幽灵锁——新面板认领被拒、
 * 取消又不认新 id，只能重载扩展才能脱困（线上复现）。而任务进度与结果也随着持有者
 * 的文档一起消失。
 *
 * 现在的语义：**同一时刻至多一轮任务，任何侧栏都是它的观察者**——进度广播给所有
 * 连着的面板，取消任意面板都能按，进度与终态落进 task-journal（storage.session），
 * 面板关了重开凭 get_task 接回来。窗口身份（clientId）从此不再需要。
 *
 * 不做的事：**不支持两轮长任务同时跑**。SW 里还有一批真正的单例——撤销快照只有
 * 一个 SNAPSHOT_KEY、分类缓存整块读写、i18n 的 setLocale 是模块级状态——放两轮
 * 并发进来，它们会互相覆盖，那是比进度串台严重得多的事故。第二个想开跑的请求收到
 * 的是一句说得清的「后台已有任务在跑」，而不是一次静默的互相破坏。
 */

export interface TaskHub {
  /** 面板连上来。post 由调用方绑到具体的 chrome.runtime.Port 上，本模块不碰 chrome。 */
  attach(post: (message: TaskStreamMessage) => void): void
  detach(post: (message: TaskStreamMessage) => void): void
  /**
   * 认领「当前唯一那轮独占任务」。已有任务在跑时返回 false，调用方据此回绝，
   * 且**必须在动手之前**回绝——被拒的那次请求一个书签都没碰，再点一次是安全的。
   *
   * cancellable 没有默认值，是有意的：漏传会让 analyze 悄悄失去取消能力，
   * 那种 bug 编译器抓不到，必须由调用方每次显式回答。
   */
  begin(kind: Request['kind'], cancellable: boolean): boolean
  /** 广播一条进度事件给所有面板，并追加进 journal。没有在跑的任务时是空操作。 */
  emit(event: ProgressEvent): void
  /** 收尾。终态写进 journal 并广播 finished；此后锁位放开，进度事件不再受理。 */
  end(response: Response): void
  /** 取消当前任务。没有在跑的任务、或那轮本就不可取消时返回 false。 */
  cancel(): boolean
  isCancelled(): boolean
  /** 当前那轮的取消信号；没有任务、或那轮不可取消时为 undefined。 */
  signal(): AbortSignal | undefined
  /** 当前任务记录：内存优先（比落盘新），没有再读 journal。 */
  record(): Promise<TaskRecord | null>
  /**
   * 清掉 journal 里的终态记录（结果被消费、用户开新的一轮时调）。
   * 还有任务在跑时是有意不动的——跑着的东西不因没人看就失去记录。
   */
  clear(): Promise<void>
  /** SW 冷启动自愈：journal 里还躺着的 running/cancelling 改写为 interrupted。 */
  heal(): Promise<void>
}

interface Run {
  record: TaskRecord
  cancelled: boolean
  /**
   * 只有可取消的那几种请求才有 controller。
   *
   * 「独占后台」与「吃取消信号」是两件事，不能并成一件：apply / undo / import /
   * apply_cleanup 都必须独占（它们在动书签树与撤销快照），但它们从头到尾不读
   * isCancelled、也不收 signal，界面上压根不给取消按钮——真给它们发一个信号，
   * 只会造出「点了取消、日志说正在取消、然后它照样跑完」这种假象。
   */
  controller: AbortController | null
}

function createId(): string {
  const uuid = globalThis.crypto?.randomUUID
  if (uuid !== undefined) return globalThis.crypto.randomUUID()
  return `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function createTaskHub(storage: TaskStorage): TaskHub {
  const posts = new Set<(message: TaskStreamMessage) => void>()
  let run: Run | null = null

  const broadcast = (message: TaskStreamMessage): void => {
    for (const post of posts) {
      try {
        post(message)
      } catch {
        // 通道已断（侧栏关了但 onDisconnect 还没到）。丢掉这条并注销，
        // 不影响正在进行的任务。
        posts.delete(post)
      }
    }
  }

  /** 落盘是尽力而为：内存里的 run 才是权威，写失败不该打断任务。 */
  const persist = (record: TaskRecord): void => {
    void writeTask(storage, record).catch(() => {})
  }

  return {
    attach(post) {
      posts.add(post)
    },

    detach(post) {
      posts.delete(post)
      // 有意不动 run：侧栏关掉不等于要中止已经在跑的任务。它照常跑完，
      // 终态进 journal，下一个打开侧栏的人照样看得到。
    },

    begin(kind, cancellable) {
      if (run !== null) return false
      const record: TaskRecord = {
        id: createId(),
        kind,
        startedAt: Date.now(),
        status: 'running',
        cancellable,
        events: [],
      }
      run = { record, cancelled: false, controller: cancellable ? new AbortController() : null }
      broadcast({ kind: 'started', record })
      persist(record)
      return true
    },

    emit(event) {
      if (run === null) return
      run.record = appendEvent(run.record, event)
      broadcast({ kind: 'progress', event })
      persist(run.record)
    },

    end(response) {
      if (run === null) return
      const finished: TaskRecord = {
        ...run.record,
        status: response.ok ? 'done' : response.cancelled === true ? 'cancelled' : 'error',
        ...(response.ok ? { result: response } : { error: response.error }),
        finishedAt: Date.now(),
      }
      run = null
      broadcast({ kind: 'finished', record: finished })
      persist(finished)
    },

    cancel() {
      if (run === null || run.controller === null) return false
      run.cancelled = true
      run.record = { ...run.record, status: 'cancelling' }
      run.controller.abort()
      persist(run.record)
      return true
    },

    isCancelled() {
      return run?.cancelled ?? false
    },

    signal() {
      return run?.controller?.signal
    },

    async record() {
      return run?.record ?? (await readTask(storage))
    },

    async clear() {
      if (run !== null) return
      await clearTask(storage)
    },

    async heal() {
      await healTask(storage)
    },
  }
}
