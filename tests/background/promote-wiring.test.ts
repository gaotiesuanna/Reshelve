import { describe, it, expect, vi } from 'vitest'
import { handle } from '@/background/handlers'
import { DEFAULT_SETTINGS, saveSettings } from '@/storage/settings'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import { withLlm } from '../fakes/settings'
import type { LlmClient } from '@/llm/client'
import type { StructureDraft } from '@/core/structure'

/**
 * 16 条书签，标签分两族（构建工具 8 / 测试框架 8），全局目录设计先把两族映射到
 * 「其他」。预估分配因此能在分类前发现这个目录过大，把它下切成两个子目录，
 * 再把这两族提到一级。
 */
function setup() {
  const fake = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '11', title: '收件箱', children: Array.from({ length: 16 }, (_, i) => ({
          id: `b${i}`, title: `书签 ${i}`, url: `https://example.com/${i}`,
        })) },
      ]},
    ]},
  ])
  const complete = vi.fn(async (prompt: string) => {
    if (prompt.includes('标签清单：')) {
      // 下切那一轮的提示词带着父目录名「其他」
      return prompt.includes('其他')
        ? { folders: [
            { title: '构建', topics: ['构建工具'], children: [] },
            { title: '测试', topics: ['测试框架'], children: [] },
          ] }
        // 全局那一轮：先把两族都设计到「其他」，让预估分配触发下切与提升
        : { folders: [{ title: '其他', topics: ['构建工具', '测试框架'], children: [] }] }
    }
    if (!prompt.includes('候选目录')) {
      return { results: Array.from({ length: 16 }, (_, i) => ({
        bookmark_id: `b${i}`,
        primary_topic: i < 8 ? '构建工具' : '测试框架',
        secondary_topic: null,
      })) }
    }
    const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
    const target = ids.find((m) => m[2]!.includes('其他'))?.[1] ?? ids[0]?.[1] ?? null
    const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
    return { results: bookmarkIds.map((id) => (
      { bookmark_id: id, target_category_id: target, confidence: 0.9, reason: 'r' }
    )) }
  })
  return {
    ports: { bookmarks: fake.api, storage: createFakeStorage() },
    deps: { createClient: () => ({ complete } as unknown as LlmClient), now: () => 1 },
  }
}

const settings = {
  ...DEFAULT_SETTINGS,
  ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
  removeEmptyFolders: false,
  rewriteGithubTitles: false,
}

describe('「其他」切出来的族提到一级', () => {
  it('推翻模式下提上一级，父指针不再指向「其他」', async () => {
    const { ports, deps } = setup()
    await saveSettings(ports, settings)
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps,
    ) as { outcome: 'structure'; draft: StructureDraft }

    expect(res.outcome).toBe('structure')
    const promoted = res.draft.newFolders.filter((folder) => /构建|测试/.test(folder.title))
    expect(promoted).toHaveLength(2)
    // 提到一级 = 直接挂在范围根上，不再挂在「其他」这个临时目录下
    for (const folder of promoted) {
      expect(folder.parentTemporaryId).toBeNull()
      expect(folder.parentId).toBe('1')
    }
  })

  it('分类前的预估分配跟着提升结果改投两个一级目录', async () => {
    const { ports, deps } = setup()
    await saveSettings(ports, settings)
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps,
    ) as { outcome: 'structure'; draft: StructureDraft }

    const promotedIds = new Set(
      res.draft.candidates
        .filter((candidate) => /构建|测试/.test(candidate.path.at(-1) ?? ''))
        .map((candidate) => candidate.id),
    )
    const counts = new Map<string, number>()
    for (const assignment of res.draft.estimatedAssignments) {
      expect(promotedIds.has(assignment.targetCategoryId ?? '')).toBe(true)
      counts.set(
        assignment.targetCategoryId!,
        (counts.get(assignment.targetCategoryId!) ?? 0) + 1,
      )
    }
    expect([...counts.values()].sort((a, b) => a - b)).toEqual([8, 8])
  })
})
