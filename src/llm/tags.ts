import type { Locale } from '@/core/locale'
import { isSkillBookmark, SKILL_TOPIC } from '@/core/rules'
import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, TagResult } from '@/core/types'
import type { LlmClient } from './client'
import { logBatch, logBatchFailed, logBatchOutputs, logBatchPartFailed, logBatchSplit } from './logs'
import { tagsPrompt } from './prompts'
import { runLlmBatch, type BatchTally } from './batches'

export type { TagResult }

/**
 * 抽取失败或模型漏返回时使用的空主题。
 * 空字符串会被 buildCategoryTree 跳过，这些书签因此不参与目录设计，
 * 既不会凑出一个假目录，也不会污染主题统计。分类阶段仍会正常处理它们。
 */
export const NO_TOPIC = ''

/** 宽泛词黑名单现在按语言分表维护，定义搬去了 prompts.ts，这里只是重新导出，避免两处定义。 */
export { BROAD_WORDS } from './prompts'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bookmark_id', 'primary_topic'],
        properties: {
          bookmark_id: { type: 'string' },
          primary_topic: { type: 'string' },
        },
      },
    },
  },
}

function payloadOf(items: BookmarkItem[]): unknown[] {
  return items.map((item) => {
    const url = sanitizeUrl(item.url)
    return {
      bookmark_id: item.id,
      title: item.title,
      domain: url?.domain ?? '',
      path: url?.path ?? '',
      current_folder: item.currentPath.join(' / '),
    }
  })
}

function buildPrompt(locale: Locale, items: BookmarkItem[]): string {
  return [
    ...tagsPrompt(locale),
    '',
    locale === 'zh_CN' ? '书签列表：' : 'Bookmark list:',
    JSON.stringify(payloadOf(items), null, 2),
  ].join('\n')
}

export interface ExtractOptions {
  batchSize?: number
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void
  /** 每批开始前检查一次，返回 true 就停止派发后续批次。 */
  isCancelled?: () => boolean
}

async function runExtraction(
  items: BookmarkItem[],
  client: LlmClient,
  buildOnePrompt: (batch: BookmarkItem[]) => string,
  options: ExtractOptions,
  label: string,
  locale: Locale,
): Promise<TagResult[]> {
  const batchSize = options.batchSize ?? 10
  const concurrency = options.concurrency ?? 4

  const batches: BookmarkItem[][] = []
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize))

  const resolved = new Map<string, TagResult>()
  let done = 0
  let cursor = 0
  /** 已派发但还没回来的批次序号。日志靠它点名「仍在跑」的是哪几批。 */
  const inflight = new Set<number>()
  /** 已收场（成功或失败）的批次数，与按书签条数算的 done 是两个口径。 */
  let completedBatches = 0

  /**
   * 问一批，返回 bookmark_id → primary_topic；这一批彻底没救时抛出最后一个错误。
   *
   * 三种失败分开收场：
   * - 可重试（429 / 5xx / 网络）——退避后原样再问，最多 MAX_RETRIES 次；
   * - 截断（client.ts 的 LlmError.truncated）——不重试，原样再问只会在同一个字上
   *   再断一次，改成对半拆开分别问。拆完仍失败的那一半只丢那一半，同批的另一半
   *   已经拿到手了，没有理由陪葬。
   * - 超时（LlmError.timedOut）且一批多于一条——同一批再问三次只会再死三次，
   *   同样拆开。只拆一层：半批再超时走普通重试后认栽，避免死端点上二分到单条。
   */
  /**
   * 问一批，返回 bookmark_id → primary_topic（null = 没问到：模型漏返回，
   * 或拆批后那一半没救）。重试、拆批的口径在 llm/batches.ts 一份：
   * 可重试的退避再问、截断对半拆、超时只拆一层。
   */
  async function ask(
    batch: BookmarkItem[],
    index: number,
    tally: BatchTally,
    timeoutSplit = true,
  ): Promise<Map<string, string | null>> {
    const tuples = await runLlmBatch(
      {
        client,
        buildPrompt: buildOnePrompt,
        schema: SCHEMA,
        parse: (raw, b) => {
          const byId = new Map(
            ((raw as { results?: Array<{ bookmark_id: string; primary_topic: string }> }).results ?? [])
              .map((r) => [r.bookmark_id, r.primary_topic]),
          )
          return b.map((item) => [item.id, byId.get(item.id) ?? null] as const)
        },
        // 拆开后仍没救的那一半 = 没问到：worker 的 ?? NO_TOPIC / ?? '' 兜底照常生效
        fallback: (item) => [item.id, null] as const,
        isCancelled: options.isCancelled,
        onError: (error) => {
          // 只进开发者控制台，不必双语。
          console.error('[Reshelve] 标签抽取失败：', error)
        },
      },
      batch,
      {
        tally,
        timeoutSplit,
        onSplit: (size, cause) =>
          options.onLog?.(logBatchSplit(locale, label, index, batches.length, size, cause), 'warn'),
        onHalfFailed: (size, error) =>
          options.onLog?.(logBatchPartFailed(locale, label, index, batches.length, size, error), 'error'),
      },
    )
    return new Map(tuples)
  }

  async function worker(): Promise<void> {
    while (cursor < batches.length) {
      if (options.isCancelled?.() === true) return
      const index = cursor++
      const batch = batches[index]!
      inflight.add(index)
      // 这一批一共问出去多少次——含重试，也含拆批后每一半各自的尝试。
      const tally = { attempts: 0 }
      try {
        const topics = await ask(batch, index, tally)
        for (const item of batch) {
          resolved.set(item.id, {
            bookmarkId: item.id,
            primaryTopic: topics.get(item.id) ?? NO_TOPIC,
            secondaryTopic: null,
          })
        }
        // 先从在跑集合里摘掉自己，再打日志——否则这一行会把刚完成的这批也算进「仍在跑」
        inflight.delete(index)
        completedBatches += 1
        options.onLog?.(
          logBatch(locale, label, index, batches.length, batch.length, {
            done: completedBatches,
            inflight: [...inflight].sort((a, b) => a - b),
          }),
          'info',
        )
        options.onLog?.(
          logBatchOutputs(
            locale,
            label,
            index,
            batch.map((item) => ({ title: item.title, output: topics.get(item.id) ?? '' })),
          ),
          'info',
        )
      } catch (error) {
        inflight.delete(index)
        completedBatches += 1
        for (const item of batch) {
          resolved.set(item.id, { bookmarkId: item.id, primaryTopic: NO_TOPIC, secondaryTopic: null })
        }
        // 取消导致的失败不写日志：用户已经知道自己点了取消，再刷四条（concurrency 条）
        // 红色的「批次失败」只是噪音，还会盖住他真正该看的那几条。
        if (options.isCancelled?.() !== true) {
          options.onLog?.(
            logBatchFailed(locale, label, index, batches.length, String(error), tally.attempts),
            'error',
          )
        }
      }
      done += batch.length
      options.onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  return items.map(
    (item) =>
      resolved.get(item.id) ?? { bookmarkId: item.id, primaryTopic: NO_TOPIC, secondaryTopic: null },
  )
}

export async function extractTags(
  items: BookmarkItem[],
  client: LlmClient,
  locale: Locale,
  options: ExtractOptions = {},
): Promise<TagResult[]> {
  const label = locale === 'zh_CN' ? '标签批次' : 'Tag batch'
  const tags = await runExtraction(items, client, (batch) => buildPrompt(locale, batch), options, label, locale)
  return tags.map((tag, index) => (
    isSkillBookmark(items[index]!)
      ? { ...tag, primaryTopic: SKILL_TOPIC[locale], secondaryTopic: null }
      : tag
  ))
}
