import { resolveLocale, setLocale, t } from '@/i18n'
import { loadSettings } from '@/storage/settings'
import { createChromePorts } from './chrome-ports'
import { PROGRESS_PORT, type TaskStreamMessage } from './events'
import { handle } from './handlers'
import { createTaskHub } from './sessions'
import type { PanelRequest, Request, Response } from './messages'
import type { TaskStorage } from './task-journal'
import { EMPTY_EDITS } from '@/core/structure'
import {
  clearStructureCheckpoint,
  readStructureCheckpoint,
  writeStructureCheckpoint,
} from './structure-checkpoint'

// 启动打点：MV3 的 service worker 会被浏览器回收。
// 若分析过程中这行日志再次出现，说明 worker 被杀过，在途请求会以
// "TypeError: Failed to fetch" 失败。
console.log('[Reshelve] service worker 启动', new Date().toISOString())

// cancel 的日志不走 handle()，没有「刚读过的设置」可用，所以启动时先定一次语言。
// worker 被回收重启时会重新走这里，语言不会丢。
void loadSettings(createChromePorts())
  .then((settings) => setLocale(resolveLocale(settings.uiLocale)))
  .catch(() => {}) // 读不到就用默认语言，不该因此阻塞消息监听

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

/**
 * 每个窗口的侧栏都是同一轮任务的观察者（演进史见 sessions.ts 的头注释）。
 * 任务中枢的进度与终态落在 chrome.storage.session 的 journal 里，
 * 侧栏关了重开也能凭 get_task 接回来。
 */
const sessionStorage: TaskStorage = {
  async get<T>(key: string) {
    const bag = await chrome.storage.session.get(key)
    return (bag[key] as T | undefined) ?? null
  },
  async set(key, value) {
    await chrome.storage.session.set({ [key]: value })
  },
  async remove(key) {
    await chrome.storage.session.remove(key)
  },
}

const task = createTaskHub(sessionStorage)

// 冷启动自愈：journal 里若还躺着 running/cancelling，说明上一任 SW 死在了半路
// （被浏览器回收或扩展重载），在途请求必断——补写 interrupted 终态。
// 锁的持有者不再是内存单槽，任何一次重启都会把没人认的锁当场销掉，
// 「另一个窗口在跑」的幽灵锁从此不可能出现。
void task.heal()
// 保活文档活得比 SW 长不了也不该长：能走到这次冷启动，说明上一任 worker 已经
// 死过一轮（心跳都没撑住它），journal 也已被 heal 判成 interrupted——
// 留下来的文档只会白发消息，直接清掉。今天没有文档时这步是吞掉异常的空操作。
closeKeepaliveDoc()

/**
 * offscreen 保活文档（src/offscreen/keepalive.html）：
 * 任务在跑而侧栏全关时，靠它每 20s 给 SW 发消息续命。任务开跑才创建、收尾即关，
 * 平时不占任何资源。文档不在了还去关、或已存在还去建，Chrome 都会抛错——
 * 这里把两条路都当成「已是想要的状态」吞掉。
 */
const KEEPALIVE_URL = 'src/offscreen/keepalive.html'

function ensureKeepaliveDoc(): void {
  if (chrome.offscreen === undefined) return
  void chrome.offscreen.createDocument({
    url: KEEPALIVE_URL,
    reasons: ['WORKERS'],
    justification: '在侧栏全部关闭时维持 service worker 存活，让用户发起的书签整理任务跑完',
  }).catch(() => {})
}

function closeKeepaliveDoc(): void {
  if (chrome.offscreen === undefined) return
  void chrome.offscreen.closeDocument().catch(() => {})
}

/**
 * 必须独占后台的请求。判准是「会不会动全局单例」，不是「跑得久不久」。
 *
 * analyze / check_links 是长任务，这好理解。真正容易漏的是后面这些：apply、undo、
 * import、apply_cleanup、apply_aggregate 全都在改**同一棵书签树**，而落地操作与 undo
 * 还共用 engine/snapshot.ts 里唯一那个 SNAPSHOT_KEY——两个窗口同时落地，后写的快照会把
 * 先写的整个盖掉，于是先落地那一次**再也撤销不回去**。这比进度串台严重得多。
 *
 * analyze 也必须挡住 apply：分析产出的方案是对着某一刻的书签树算的，
 * 另一个窗口在这中间把树改了，那份方案落地时指向的 id 已经不是原来那个东西。
 *
 * reclassify 同样挡住：它跟 analyze 一样要读写分类缓存（loadCache/saveCache 整块
 * 读写，见 storage/settings.ts），两个窗口同时读改写会互相覆盖对方刚写下的条目。
 * 它不动书签树，但缓存也是要保护的全局单例。
 * classify_structure 同样写分类缓存，并且必须冻结用户确认过的候选树，不能与另一轮
 * 分析或分类交错。
 *
 * 没进来的都是只读或瞬时的（get_tree、scan、cleanup_scan、test_model、list_models…），
 * 并发跑没有互相破坏的余地，挡住它们只会让另一个窗口连书签树都读不了。
 */
const EXCLUSIVE: ReadonlySet<Request['kind']> = new Set([
  'analyze', 'classify_structure', 'check_links', 'apply', 'undo', 'import', 'apply_cleanup', 'apply_aggregate', 'reclassify', 'move_bookmarks',
])

/**
 * 独占任务里**吃取消信号**的那几种。
 *
 * 与 EXCLUSIVE 分开是必须的：apply / undo / import / apply_cleanup / apply_aggregate 从不读
 * isCancelled、不收 signal，界面也不给它们取消按钮。把它们一并当成可取消，
 * 换来的是「点了取消 → 日志说正在取消 → 它照样跑完」这种骗人的三连。
 * classify_structure 与 analyze 一样把 signal 传给 LLM 请求，因此属于可取消任务。
 */
const CANCELLABLE: ReadonlySet<Request['kind']> = new Set([
  'analyze', 'classify_structure', 'check_links', 'reclassify',
])

chrome.runtime.onConnect.addListener((port) => {
  // 连接名不带身份：任务本来就是全局的，每条连接都订阅同一份广播。
  // 升级前旧侧栏用的带 clientId 后缀的名字不再被认——旧文档在扩展更新时
  // 本就失效了，重开一次就是新协议。
  if (port.name !== PROGRESS_PORT) return
  // detach 认的是同一个函数引用，先存住再挂两个监听
  const post = (message: TaskStreamMessage) => port.postMessage(message)
  task.attach(post)
  // 侧栏的 keepalive ping：收到消息本身就会重置空闲计时，不需要回应
  port.onMessage.addListener(() => {})
  port.onDisconnect.addListener(() => task.detach(post))
})

chrome.runtime.onMessage.addListener((message: PanelRequest, _sender, sendResponse) => {
  // offscreen 文档的保活心跳：收到即重置空闲计时，目的已达，不进业务管线
  if ((message as { type?: string }).type === 'keepalive') return false

  if (message.kind === 'cancel') {
    // 任务是全局的，任何侧栏的取消掐的都是同一轮。日志广播给所有面板：
    // 每个正在看这轮任务的人都该知道它正在收尾。
    const stopped = task.cancel()
    if (stopped) {
      task.emit({ phase: 'classify', message: t('logCancelRequested'), level: 'warn' })
    }
    sendResponse({ ok: true, kind: 'cancel' })
    return false
  }

  if (message.kind === 'open_app_tab') {
    const url = new URL(chrome.runtime.getURL('src/sidepanel/index.html'))
    // view=tab 给标签页形态一个能被自己读到的标记（按钮因此收起），
    // mode / step / ids 让新页面落在侧栏正停在的位置上，「换过去」而不是「重新打开」。
    url.searchParams.set('view', 'tab')
    url.searchParams.set('mode', message.mode)
    url.searchParams.set('step', message.step)
    if (message.checkedIds.length > 0) url.searchParams.set('ids', message.checkedIds.join(','))
    void (async () => {
      await chrome.tabs.create({ url: url.toString() })
      // 侧栏没有 close API，关它的唯一办法是禁用再立刻启用。
      // 代价是全局的：别的窗口开着的侧栏也会一起被关掉——可接受，
      // 反过来的方案（让侧栏自己做）是图标从此失效，严重得多。
      await chrome.sidePanel.setOptions({ enabled: false })
      await chrome.sidePanel.setOptions({ enabled: true })
      sendResponse({ ok: true, kind: 'open_app_tab' })
    })().catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (message.kind === 'get_task') {
    void task.record().then(
      (record) => sendResponse({ ok: true, kind: 'get_task', record }),
      () => sendResponse({ ok: true, kind: 'get_task', record: null }),
    )
    return true
  }

  if (message.kind === 'clear_task') {
    void task.clear().then(
      () => sendResponse({ ok: true, kind: 'clear_task' }),
      () => sendResponse({ ok: false, error: t('errClearTaskFailed') }),
    )
    return true
  }

  if (message.kind === 'get_structure_checkpoint') {
    void readStructureCheckpoint(sessionStorage).then(
      (checkpoint) => sendResponse({ ok: true, kind: 'get_structure_checkpoint', checkpoint }),
      (error: unknown) => sendResponse({ ok: false, error: String(error) }),
    )
    return true
  }

  if (message.kind === 'save_structure_checkpoint') {
    void writeStructureCheckpoint(sessionStorage, message.checkpoint).then(
      () => sendResponse({ ok: true, kind: 'save_structure_checkpoint' }),
      (error: unknown) => sendResponse({ ok: false, error: String(error) }),
    )
    return true
  }

  if (message.kind === 'clear_structure_checkpoint') {
    void clearStructureCheckpoint(sessionStorage).then(
      () => sendResponse({ ok: true, kind: 'clear_structure_checkpoint' }),
      (error: unknown) => sendResponse({ ok: false, error: String(error) }),
    )
    return true
  }

  const request = message as Request
  const exclusive = EXCLUSIVE.has(request.kind)
  if (exclusive && !task.begin(request.kind, CANCELLABLE.has(request.kind))) {
    // 说清楚比静默排队强：用户看得见是「后台有一轮在跑」，而不是自己这边没反应。
    // 这一步是**在动手之前**回绝的，一个书签都没碰，所以再点一次是安全的——
    // 与 apply/undo 那几处「失败了不给重试入口」不是一回事，那些是可能已经改了一半。
    sendResponse({ ok: false, error: t('errTaskRunning') })
    return false
  }
  // 认领成功才请保活文档进场；用 begin 的结果当闸，被拒的请求不留痕迹
  if (exclusive) ensureKeepaliveDoc()

  // 两道闸都要：task.signal 只回答「当前这轮可不可取消」，回答不了
  // 「眼下这条请求**是不是**那一轮」。少了 exclusive 这一道，同一个窗口在分析途中
  // 发的 get_settings 会拿到分析那一轮的 signal，用户点取消时它跟着莫名其妙地断掉。
  const signal = exclusive ? task.signal() : undefined

  void (async () => {
    if (request.kind === 'classify_structure') {
      await writeStructureCheckpoint(sessionStorage, {
        draft: request.draft,
        edits: request.edits,
        state: 'classifying',
        updatedAt: Date.now(),
      })
    }

    const response = await handle(createChromePorts(), request, {
      // 进度与终态广播给所有连着的侧栏——任务在后台跑，谁都可能随时打开面板来看。
      onEvent: (event) => task.emit(event),
      isCancelled: () => task.isCancelled(),
      ...(signal === undefined ? {} : { signal }),
    })

    if (response.ok && response.kind === 'analyze' && response.outcome === 'structure') {
      await writeStructureCheckpoint(sessionStorage, {
        draft: response.draft,
        edits: EMPTY_EDITS,
        state: 'awaiting_confirmation',
        updatedAt: Date.now(),
      })
    }

    task.end(response)
    closeKeepaliveDoc()
    sendResponse(response)
  })().catch((error: unknown) => {
    const response: Response = { ok: false, error: String(error) }
    task.end(response)
    closeKeepaliveDoc()
    sendResponse(response)
  })
  return true // 保持消息通道开启以支持异步响应
})
