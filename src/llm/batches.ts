import type { LlmClient } from './client'

/**
 * 一批的重试次数。曾经这份口径在 classify.ts 与 tags.ts 各誊一份（tags 那份的头
 * 注明说是「与 classify.ts 同一口径」，folders.ts 则干脆没有传输层重试）——收进
 * 这个模块之后口径只此一份，测试矩阵也只测一遍（tests/llm/batches.test.ts）。
 */
export const MAX_RETRIES = 2

/** 指数退避：500ms、1s。测试里可用 backoffMs 注入别的节奏。 */
export const batchBackoffMs = (attempt: number): number => 2 ** attempt * 500

/** 这一批一共问出去多少次——含重试，也含拆批后每一半各自的尝试。 */
export interface BatchTally {
  attempts: number
}

export interface BatchTask<TIn, TOut> {
  client: LlmClient
  buildPrompt: (batch: TIn[]) => string
  schema: object
  /**
   * 返回值必须与 batch 一一对应（同序同长）——拆批合并靠这条契约：
   * 两半各自返回与自己逐位对齐的结果，顺序拼回去，契约不变。
   */
  parse: (raw: unknown, batch: TIn[]) => TOut[]
  /**
   * 一半拆批后仍没救时，这一半每个条目的降级产物。整批的降级策略归调用方
   * （classify 逐条未分类、tags 整批 NO_TOPIC）——引擎只负责把「没救」如实抛出。
   */
  fallback: (item: TIn, error: string) => TOut
  /** 每次失败后、发下一个请求之前问一次。日志由调用方记。 */
  isCancelled?: () => boolean
  /** 每次失败先进开发者控制台（调用方各带各的前缀），不进侧栏日志，不必双语。 */
  onError?: (error: unknown) => void
}

export interface BatchRunOptions {
  /** 失败次数（含拆批后半批的尝试）记在这本账上，供调用方的失败日志点名。 */
  tally?: BatchTally
  /** 拆批时调一次（规模 + 原因）；日志归调用方。 */
  onSplit?: (size: number, cause: 'truncated' | 'timeout') => void
  /**
   * 拆开后**仍有半批成功**时，对每个失败的半批调一次；两半全灭时不调——
   * 那种情形抛出原始错误，由调用方统一记一条「整批失败」，
   * 再补两条「拆开后仍失败」只是把同一件事说三遍。
   */
  onHalfFailed?: (size: number, error: string) => void
  /** 超时拆批只做一层（子批强制 false）：死端点会把 25 条二分到单条，每条再吃满重试 × 超时。 */
  timeoutSplit?: boolean
  backoffMs?: (attempt: number) => number
}

/**
 * 一批条目问一次模型的重试引擎，classify 与 tags 共用的那一份。
 *
 * 三种失败分开收场：
 * - 可重试（429 / 5xx / 网络，client.ts 标了 retryable）——退避后原样再问，
 *   最多 MAX_RETRIES 次；
 * - 截断（LlmError.truncated）——不重试，原样再问只会在同一个字上再断一次，
 *   改成对半拆开分别问。拆完仍失败的那一半走 task.fallback 逐条降级，
 *   同批的另一半已经拿到手了，没有理由陪葬；
 * - 超时（LlmError.timedOut）且一批多于一条——同样拆开，只拆一层。
 *
 * 全部路子都走完仍没拿到结果时，抛出**最后一个原始错误**：整批怎么降级
 * （逐条 fallback 还是整体失败）是调用方的政策，引擎不替它决定。
 * 拆批的另一半在跑时用户点了取消：把触发拆批的那个错误交回去，剩下那半不再问。
 *
 * 拆开的两半**顺序问**而不是并发：外层已经有 concurrency 个 worker 在跑，
 * 一批刚被截断/超时说明这条线正吃力，没必要再往上叠一倍请求。
 */
export async function runLlmBatch<TIn, TOut>(
  task: BatchTask<TIn, TOut>,
  batch: TIn[],
  opts: BatchRunOptions = {},
): Promise<TOut[]> {
  const backoffMs = opts.backoffMs ?? batchBackoffMs
  const flagged = (error: unknown, key: 'retryable' | 'truncated' | 'timedOut'): boolean =>
    (error as Record<string, unknown> | null)?.[key] === true

  // 仅用于满足初始化：走到抛出前必然先经过 catch 覆盖成真实错误。
  let lastError: unknown = new Error('未知错误')
  let truncated = false
  let timedOut = false

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (opts.tally !== undefined) opts.tally.attempts++
    try {
      const raw = await task.client.complete(task.buildPrompt(batch), task.schema)
      return task.parse(raw, batch)
    } catch (error) {
      lastError = error
      truncated = flagged(error, 'truncated')
      timedOut = flagged(error, 'timedOut')
      task.onError?.(error)
      // 取消之后一个新请求都不再发：那几次注定失败，用户却要眼看着「正在取消」
      // 多等三个请求加 1.5 秒的退避。
      if (task.isCancelled?.() === true) break
      // 截断或（可拆的）超时：原样再问同一批没有意义，跳出重试去拆。
      // 一条的超时、已经拆过一层的超时，仍走下面的可重试退避。
      const willSplit = batch.length > 1 && (truncated || (timedOut && opts.timeoutSplit !== false))
      if (willSplit) break
      if (!flagged(error, 'retryable')) break
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
      }
    }
  }

  const splitTimeout = timedOut && batch.length > 1 && opts.timeoutSplit !== false
  if (task.isCancelled?.() !== true && batch.length > 1 && (truncated || splitTimeout)) {
    const cause: 'truncated' | 'timeout' = splitTimeout ? 'timeout' : 'truncated'
    opts.onSplit?.(batch.length, cause)
    const mid = Math.ceil(batch.length / 2)
    const childOpts: BatchRunOptions = { ...opts, timeoutSplit: cause === 'truncated' ? opts.timeoutSplit : false }
    const settle = async (half: TIn[]): Promise<TOut[] | { error: unknown }> => {
      if (task.isCancelled?.() === true) throw lastError
      try {
        return await runLlmBatch(task, half, childOpts)
      } catch (error) {
        return { error }
      }
    }
    const head = await settle(batch.slice(0, mid))
    const tail = await settle(batch.slice(mid))
    if ('error' in head && 'error' in tail) throw lastError
    const merged: TOut[] = []
    for (const [half, result] of [[batch.slice(0, mid), head], [batch.slice(mid), tail]] as const) {
      if ('error' in result) {
        opts.onHalfFailed?.(half.length, String(result.error))
        merged.push(...half.map((item) => task.fallback(item, String(result.error))))
      } else {
        merged.push(...result)
      }
    }
    return merged
  }

  throw lastError
}
