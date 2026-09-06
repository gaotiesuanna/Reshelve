import { PROGRESS_PORT, type ProgressEvent, type TaskRecord, type TaskStreamMessage } from '@/background/events'

export interface ProgressHandlers {
  onStarted: (record: TaskRecord) => void
  onEvent: (event: ProgressEvent) => void
  /** 后台广播「某轮任务收尾了」，record 是含终态与全部缓冲事件的完整记录。 */
  onFinished: (record: TaskRecord) => void
  /** 长连接断开——通常意味着 service worker 被浏览器回收了。 */
  onDisconnect: () => void
}

export interface ProgressConnection {
  /** 往后台发一个空消息。收到消息会重置 service worker 的空闲计时。 */
  ping(): void
  disconnect(): void
}

/**
 * 订阅后台的任务广播。测试环境没有 chrome API，返回 null 表示没连上。
 *
 * 连接名不带任何身份（演进史见 background/sessions.ts）：任务是全局的，
 * 每个打开的侧栏都是同一轮任务的观察者，收到的广播一模一样。
 */
export function connectProgress(handlers: ProgressHandlers): ProgressConnection | null {
  if (typeof chrome === 'undefined' || chrome.runtime?.connect === undefined) return null
  const port = chrome.runtime.connect({ name: PROGRESS_PORT })
  port.onMessage.addListener((raw) => {
    const message = raw as TaskStreamMessage
    if (message.kind === 'started') handlers.onStarted(message.record)
    else if (message.kind === 'finished') handlers.onFinished(message.record)
    else handlers.onEvent(message.event)
  })
  port.onDisconnect.addListener(() => handlers.onDisconnect())
  return {
    ping: () => {
      try {
        port.postMessage({ kind: 'ping' })
      } catch {
        // 通道已断，onDisconnect 会走它自己的处理
      }
    },
    disconnect: () => port.disconnect(),
  }
}

/** 长任务期间每 20 秒 ping 一次，避免 service worker 因空闲被回收。 */
export const KEEPALIVE_INTERVAL_MS = 20_000

export function startKeepalive(connection: ProgressConnection | null): () => void {
  if (connection === null) return () => {}
  const timer = setInterval(() => connection.ping(), KEEPALIVE_INTERVAL_MS)
  return () => clearInterval(timer)
}
