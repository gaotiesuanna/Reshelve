import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * offscreen 保活文档的全部职责就一件事：每 20 秒往 SW 送一条消息。
 * 不可见的文档没有别的可测界面，fake timers 把这条节拍钉死就够了。
 */

const sendMessage = vi.fn(() => Promise.resolve())

beforeEach(async () => {
  vi.useFakeTimers()
  sendMessage.mockClear()
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage },
  }
  await import('@/offscreen/keepalive')
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe('保活心跳', () => {
  it('每 20 秒给 SW 送一条消息，收到即重置空闲计时', () => {
    expect(sendMessage).not.toHaveBeenCalled()

    await3h()

    // 3 小时 = 540 次；至少确认它一直在跳，且间隔是 20s 不是别的
    expect(sendMessage).toHaveBeenCalledTimes(540)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'keepalive' })
  })

  it('SW 正在重启、消息送不到时静默等下一轮，不停摆', async () => {
    sendMessage.mockImplementationOnce(() => Promise.reject(new Error('Extension context invalidated')))

    vi.advanceTimersByTime(20_000) // 第一次触发，reject
    await Promise.resolve() // 让 .catch 走完
    vi.advanceTimersByTime(20_000) // 下一轮照常

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  function await3h(): void {
    vi.advanceTimersByTime(3 * 60 * 60 * 1000)
  }
})
