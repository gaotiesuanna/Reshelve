import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchBackoffMs, runLlmBatch, type BatchTask } from '@/llm/batches'
import type { LlmClient } from '@/llm/client'

type Item = { id: string }
const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `b${i}` }))

const retryableError = (): Error => Object.assign(new Error('500'), { retryable: true })
const truncatedError = (): Error => Object.assign(new Error('cut'), { truncated: true })
const timeoutError = (): Error => Object.assign(new Error('slow'), { timedOut: true })

function makeTask(overrides: Partial<BatchTask<Item, string>> = {}): BatchTask<Item, string> {
  return {
    client: { complete: vi.fn() } as unknown as LlmClient,
    buildPrompt: (batch) => `prompt:${batch.map((b) => b.id).join(',')}`,
    schema: {},
    parse: (raw, batch) => {
      const byId = new Map((raw as { results: Array<{ bookmark_id: string; topic: string }> }).results
        .map((r) => [r.bookmark_id, r.topic]))
      return batch.map((item) => byId.get(item.id) ?? '')
    },
    fallback: (item, error) => `fallback:${item.id}:${error}`,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runLlmBatch 的重试口径', () => {
  it('一次成功：只发一个请求，不退避', async () => {
    const task = makeTask()
    ;(task.client.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      results: [{ bookmark_id: 'b0', topic: '工具' }],
    })
    const tally = { attempts: 0 }
    await expect(runLlmBatch(task, items(1), { tally })).resolves.toEqual(['工具'])
    expect(tally.attempts).toBe(1)
  })

  it('可重试错误退避后原样再问，最多 MAX_RETRIES 次重试', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(retryableError())
    complete.mockRejectedValueOnce(retryableError())
    complete.mockResolvedValueOnce({ results: [{ bookmark_id: 'b0', topic: '工具' }] })
    const pending = runLlmBatch(task, items(1))
    // 第一轮失败后退避 500ms，第二轮失败后退避 1s——第三次成功
    await vi.advanceTimersByTimeAsync(batchBackoffMs(0))
    await vi.advanceTimersByTimeAsync(batchBackoffMs(1))
    await expect(pending).resolves.toEqual(['工具'])
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('不可重试的错误当场抛出，不再退避', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(new Error('bad request'))
    await expect(runLlmBatch(task, items(1))).rejects.toThrow('bad request')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('取消之后一个新请求都不再发', async () => {
    const isCancelled = vi.fn().mockReturnValue(true)
    const task = makeTask({ isCancelled })
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(retryableError())
    await expect(runLlmBatch(task, items(2))).rejects.toThrow('500')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('重试次数用尽：抛出最后一个错误', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValue(retryableError())
    const pending = runLlmBatch(task, items(1))
    pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(batchBackoffMs(0))
    await vi.advanceTimersByTimeAsync(batchBackoffMs(1))
    await expect(pending).rejects.toThrow('500')
    expect(complete).toHaveBeenCalledTimes(3)
  })
})

describe('runLlmBatch 的拆批口径', () => {
  it('截断：对半拆开分别问，结果按原顺序拼回去', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(truncatedError())
    complete.mockResolvedValueOnce({ results: [{ bookmark_id: 'b0', topic: '头' }] })
    complete.mockResolvedValueOnce({ results: [{ bookmark_id: 'b1', topic: '尾' }] })
    const onSplit = vi.fn()
    await expect(runLlmBatch(task, items(2), { onSplit })).resolves.toEqual(['头', '尾'])
    expect(onSplit).toHaveBeenCalledWith(2, 'truncated')
    // 顺序问而不是并发：先头半批，再尾半批
    expect(complete.mock.calls[1]![0]).toContain('b0')
    expect(complete.mock.calls[2]![0]).toContain('b1')
  })

  it('单条截断不拆：原样再问没有意义，也没得拆', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(truncatedError())
    await expect(runLlmBatch(task, items(1))).rejects.toThrow('cut')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('超时默认拆一层：半批再超时走重试后认栽，不二分到单条', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(timeoutError())
    complete.mockRejectedValue(timeoutError())
    const onSplit = vi.fn()
    const pending = runLlmBatch(task, items(4), { onSplit })
    pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(batchBackoffMs(0) * 5)
    await expect(pending).rejects.toThrow('slow')
    expect(onSplit).toHaveBeenCalledTimes(1)
    expect(onSplit).toHaveBeenCalledWith(4, 'timeout')
  })

  it('拆开后一半失败：那一半降级为 fallback，成功的半批原样保留，且 onHalfFailed 恰好一次', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(truncatedError())
    complete.mockRejectedValueOnce(new Error('boom'))
    complete.mockResolvedValueOnce({ results: [{ bookmark_id: 'b1', topic: '尾' }] })
    const onHalfFailed = vi.fn()
    await expect(runLlmBatch(task, items(2), { onHalfFailed }))
      .resolves.toEqual(['fallback:b0:Error: boom', '尾'])
    expect(onHalfFailed).toHaveBeenCalledTimes(1)
    expect(onHalfFailed).toHaveBeenCalledWith(1, 'Error: boom')
  })

  it('两半全军覆没：抛出原始错误，onHalfFailed 一次都不调（整批失败由调用方记一条）', async () => {
    const task = makeTask()
    const complete = task.client.complete as ReturnType<typeof vi.fn>
    complete.mockRejectedValueOnce(truncatedError())
    complete.mockRejectedValueOnce(new Error('head dead'))
    complete.mockRejectedValueOnce(new Error('tail dead'))
    const onHalfFailed = vi.fn()
    await expect(runLlmBatch(task, items(2), { onHalfFailed })).rejects.toThrow('cut')
    expect(onHalfFailed).not.toHaveBeenCalled()
  })

  it('拆到一半用户点了取消：把拆批的原因交回去，剩下那半不再问', async () => {
    // 头半批发出去之后就当「已取消」：用调用次数当闸，避免真按墙钟写竞态
    const complete = vi.fn()
      .mockRejectedValueOnce(truncatedError())
      .mockRejectedValueOnce(new Error('head dead'))
    const task = makeTask({
      client: { complete } as unknown as LlmClient,
      isCancelled: () => complete.mock.calls.length >= 2,
    })
    // 与原先 tags.ask 的 cause 语义一致：抛的是触发拆批的那个错误
    await expect(runLlmBatch(task, items(2))).rejects.toThrow('cut')
    expect(complete).toHaveBeenCalledTimes(2)
  })
})
