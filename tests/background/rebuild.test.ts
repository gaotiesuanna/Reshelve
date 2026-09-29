import { describe, expect, it, vi } from 'vitest'
import { handle } from '@/background/handlers'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import { DEFAULT_SETTINGS, saveSettings } from '@/storage/settings'
import { withLlm } from '../fakes/settings'
import { EMPTY_EDITS, type StructureDraft, type StructureEdits } from '@/core/structure'
import type { LlmClient, LlmConfig } from '@/llm/client'
import type { OrganizePlan } from '@/core/types'

const tree = [
  { id: '0', title: '', children: [
    { id: '1', title: 'Bookmarks bar', children: [
      { id: '10', title: 'Old folder', children: [
        { id: '100', title: 'React', url: 'https://react.dev' },
        { id: '101', title: 'Vite', url: 'https://vite.dev' },
        { id: '102', title: 'Vitest', url: 'https://vitest.dev' },
      ] },
    ] },
  ] },
]

describe('rebuild structure workflow', () => {
  it('designs a serializable draft without classifying bookmarks', async () => {
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://example.test/v1', apiKey: 'secret', model: 'model-a' }),
      rewriteGithubTitles: true,
      uiLocale: 'en',
    })
    const classifyPrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('one specific topic')) {
        return {
          results: ['100', '101', '102'].map((bookmark_id) => ({
            bookmark_id,
            primary_topic: 'Frontend',
            secondary_topic: null,
          })),
        }
      }
      if (prompt.includes('Design a folder structure')) {
        return { folders: [{ title: 'Frontend', topics: ['Frontend'], children: [] }] }
      }
      classifyPrompts.push(prompt)
      return {
        results: ['100', '101', '102'].map((bookmark_id) => ({
          bookmark_id,
          target_category_id: 'tmp:1',
          confidence: 0.9,
          reason: 'belongs here',
        })),
      }
    })

    const response = await handle(
      ports,
      { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 123 },
    )

    expect(response).toMatchObject({
      ok: true,
      kind: 'analyze',
      outcome: 'structure',
      draft: {
        id: 'structure-123',
        createdAt: 123,
        scopeRootIds: ['1'],
        destinationRootId: '1',
        locale: 'en',
        llm: { baseUrl: 'https://example.test/v1', model: 'model-a' },
        totalBookmarks: 3,
        bookmarkFingerprint: [
          { id: '100', url: 'https://react.dev' },
          { id: '101', url: 'https://vite.dev' },
          { id: '102', url: 'https://vitest.dev' },
        ],
        tags: expect.arrayContaining([
          expect.objectContaining({ bookmarkId: '100', primaryTopic: 'Frontend' }),
        ]),
        sourceTags: expect.arrayContaining([
          expect.objectContaining({ bookmarkId: '100', primaryTopic: 'Frontend' }),
        ]),
        estimatedAssignments: expect.arrayContaining([
          { bookmarkId: '100', targetCategoryId: expect.any(String) },
        ]),
        candidates: expect.any(Array),
        newFolders: expect.any(Array),
        renameFolders: expect.any(Array),
        folderMoves: expect.any(Array),
        warnings: expect.any(Array),
        rootLevel: 0,
        deepenCap: 20,
        rewriteGithubTitles: true,
      },
    })
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
    expect(classifyPrompts).toEqual([])
  })

  // 设计没映射上的书签预计归属是 null，不算进「其他」；按预计数剪枝曾把「其他」
  // 从每一份草稿里撤掉，分类阶段放不进去的书签于是无处可落
  it('keeps the top-level Other in the draft even when no bookmark is estimated into it', async () => {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: 'Bookmarks bar', children: [
          { id: '10', title: 'Old folder', children: [
            { id: '100', title: 'React', url: 'https://react.dev' },
            { id: '101', title: 'Vite', url: 'https://vite.dev' },
            { id: '102', title: 'Svelte', url: 'https://svelte.dev' },
            { id: '103', title: 'Vitest', url: 'https://vitest.dev' },
          ] },
        ] },
      ] },
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://example.test/v1', apiKey: 'secret', model: 'model-a' }),
      uiLocale: 'en',
    })
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('one specific topic')) {
        return {
          results: [
            { bookmark_id: '100', primary_topic: 'Frontend' },
            { bookmark_id: '101', primary_topic: 'Frontend' },
            { bookmark_id: '102', primary_topic: 'Frontend' },
            { bookmark_id: '103', primary_topic: 'Testing' },
          ],
        }
      }
      return { folders: [{ title: 'Frontend', topics: ['Frontend'], children: [] }] }
    })

    const response = await handle(
      ports,
      { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 123 },
    )

    if (!response.ok || response.kind !== 'analyze' || response.outcome !== 'structure') {
      throw new Error(`expected a structure draft, got ${JSON.stringify(response)}`)
    }
    const paths = response.draft.candidates.map((candidate) => candidate.path)
    expect(paths).toContainEqual([expect.stringMatching(/ Other$/)])
    expect(response.draft.estimatedAssignments).toContainEqual({ bookmarkId: '103', targetCategoryId: null })
  })

  function classificationTree(overrides: { rootId?: string; count?: number; github?: boolean } = {}) {
    const rootId = overrides.rootId ?? '1'
    const count = overrides.count ?? 3
    return [
      { id: '0', title: '', children: [
        { id: rootId, title: 'Bookmarks bar', children: [
          { id: '10', title: 'Current', children: Array.from({ length: count }, (_, index) => ({
            id: String(100 + index),
            title: overrides.github && index === 0 ? 'GitHub - sst/opencode' : `Bookmark ${index}`,
            url: overrides.github && index === 0
              ? 'https://github.com/sst/opencode'
              : `https://example.test/${index}`,
          })) },
        ] },
      ] },
    ]
  }

  function draftFor(
    count = 3,
    overrides: Partial<StructureDraft> = {},
  ): StructureDraft {
    return {
      id: 'structure-1',
      createdAt: 1,
      scopeRootIds: ['1'],
      destinationRootId: '1',
      locale: 'en',
      llm: { baseUrl: 'https://example.test/v1', model: 'model-a' },
      totalBookmarks: count,
      bookmarkFingerprint: Array.from({ length: count }, (_, index) => ({
        id: String(100 + index),
        url: `https://example.test/${index}`,
      })),
      candidates: [
        { id: 'tmp:1', path: ['01 Frontend'] },
        { id: 'tmp:2', path: ['02 Other'] },
      ],
      newFolders: [
        { temporaryId: 'tmp:1', parentTemporaryId: null, parentId: '1', title: '01 Frontend' },
        { temporaryId: 'tmp:2', parentTemporaryId: null, parentId: '1', title: '02 Other' },
      ],
      renameFolders: [],
      folderMoves: [],
      mergeRoot: null,
      tags: Array.from({ length: count }, (_, index) => ({
        bookmarkId: String(100 + index), primaryTopic: 'Frontend', secondaryTopic: null,
      })),
      sourceTags: Array.from({ length: count }, (_, index) => ({
        bookmarkId: String(100 + index), primaryTopic: 'React', secondaryTopic: null,
      })),
      estimatedAssignments: Array.from({ length: count }, (_, index) => ({
        bookmarkId: String(100 + index), targetCategoryId: 'tmp:1',
      })),
      rootLevel: 0,
      deepenCap: 20,
      warnings: [],
      rewriteGithubTitles: false,
      ...overrides,
    }
  }

  async function setupClassification(
    tree_ = classificationTree(),
    settings = {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://example.test/v1', apiKey: 'secret', model: 'model-a' }),
      uiLocale: 'en' as const,
    },
  ) {
    const fake = createFakeBookmarks(tree_)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, settings)
    return { fake, ports }
  }

  function classifyClient(
    targetId = 'tmp:1',
    seenPrompts: string[] = [],
  ): LlmClient {
    return {
      complete: vi.fn(async (prompt: string) => {
        seenPrompts.push(prompt)
        const ids = [...prompt.matchAll(/"bookmark_id": "([^"]+)"/g)].map((match) => match[1]!)
        return {
          results: ids.map((bookmark_id) => ({
            bookmark_id,
            target_category_id: targetId,
            confidence: 0.9,
            reason: 'belongs here',
          })),
        }
      }),
    }
  }

  it('classifies once against the exact edited, added, and surviving compiled candidates', async () => {
    const { ports } = await setupClassification()
    const prompts: string[] = []
    const edits: StructureEdits = {
      renames: { 'tmp:1': 'Engineering' },
      removed: ['tmp:2'],
      mergedInto: {},
      added: [{ temporaryId: 'tmp:user:reading', parentCategoryId: null, title: 'Reading' }],
    }

    const response = await handle(
      ports,
      { kind: 'classify_structure', draft: draftFor(), edits } as never,
      { createClient: () => classifyClient('tmp:1', prompts), now: () => 2 },
    )

    expect(response).toMatchObject({ ok: true, kind: 'classify_structure' })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('- id=tmp:1 folder=01 Engineering')
    expect(prompts[0]).toContain('- id=tmp:user:reading folder=02 Reading')
    expect(prompts[0]).not.toContain('tmp:2')
    expect(prompts[0]).not.toContain('If none fit, return null and include a concise topic')
  })

  it('把没有识别结果的书签放入结构草案中的「其他」', async () => {
    const { ports } = await setupClassification()
    const client: LlmClient = {
      complete: vi.fn(async (prompt: string) => {
        const ids = [...prompt.matchAll(/"bookmark_id": "([^"]+)"/g)].map((match) => match[1]!)
        return {
          results: ids.map((bookmark_id) => ({
            bookmark_id,
            target_category_id: bookmark_id === '100' ? null : 'tmp:1',
            confidence: bookmark_id === '100' ? 0 : 0.9,
            reason: bookmark_id === '100' ? 'no suitable folder' : 'belongs here',
          })),
        }
      }),
    }

    const response = await handle(
      ports,
      { kind: 'classify_structure', draft: draftFor(), edits: EMPTY_EDITS } as never,
      { createClient: () => client, now: () => 2 },
    ) as { ok: true; kind: 'classify_structure'; plan: OrganizePlan }

    expect(response.plan.rows.find((row) => row.bookmarkId === '100')).toMatchObject({
      toCategoryId: 'tmp:2', toPath: ['02 Other'],
    })
    expect(response.plan.unchanged).toEqual([])
  })

  it('accepts title, path, and index changes and builds the plan from the fresh scan items', async () => {
    const { fake, ports } = await setupClassification()
    const freshFolder = await fake.api.create({ parentId: '1', title: 'Fresh' })
    await fake.api.update('100', { title: 'Fresh title' })
    await fake.api.move('100', { parentId: freshFolder.id, index: 0 })

    const response = await handle(
      ports,
      { kind: 'classify_structure', draft: draftFor(), edits: EMPTY_EDITS } as never,
      { createClient: () => classifyClient(), now: () => 2 },
    ) as { ok: true; kind: 'classify_structure'; plan: OrganizePlan }

    expect(response.plan.rows.find((row) => row.bookmarkId === '100')).toMatchObject({
      title: 'Fresh title',
      fromPath: ['Bookmarks bar', 'Fresh'],
    })
  })

  it('rejects added, removed, URL-changed, and missing-root scopes before LLM work', async () => {
    const cases = [
      async () => {
        const result = await setupClassification()
        await result.fake.api.create({ parentId: '10', title: 'Added', url: 'https://added.test' })
        return result
      },
      async () => {
        const result = await setupClassification()
        await result.fake.api.remove('102')
        return result
      },
      () => setupClassification([
        { id: '0', title: '', children: [
          { id: '1', title: 'Bookmarks bar', children: [
            { id: '10', title: 'Current', children: [
              { id: '100', title: 'Bookmark 0', url: 'https://changed.test' },
              { id: '101', title: 'Bookmark 1', url: 'https://example.test/1' },
              { id: '102', title: 'Bookmark 2', url: 'https://example.test/2' },
            ] },
          ] },
        ] },
      ]),
      () => setupClassification(classificationTree({ rootId: '2' })),
    ]

    for (const arrange of cases) {
      const { ports } = await arrange()
      const createClient = vi.fn(() => classifyClient())
      const response = await handle(
        ports,
        { kind: 'classify_structure', draft: draftFor(), edits: EMPTY_EDITS } as never,
        { createClient, now: () => 2 },
      )
      expect(response).toMatchObject({ ok: false })
      expect((response as { error: string }).error).toContain('bookmark scope has changed')
      expect(createClient).not.toHaveBeenCalled()
    }
  })

  it('rejects a removed draft-bound model without exposing its API key', async () => {
    const { ports } = await setupClassification(classificationTree(), {
      ...DEFAULT_SETTINGS,
      endpoints: [{ baseUrl: 'https://example.test/v1', apiKey: 'super-secret', models: ['other-model'] }],
      active: { baseUrl: 'https://example.test/v1', model: 'other-model' },
      uiLocale: 'en',
    })
    const createClient = vi.fn(() => classifyClient())

    const response = await handle(
      ports,
      { kind: 'classify_structure', draft: draftFor(), edits: EMPTY_EDITS } as never,
      { createClient },
    )

    expect(response).toMatchObject({ ok: false })
    expect((response as { error: string }).error).not.toContain('super-secret')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('adds actual-occupancy warnings without changing the compiled candidate structure', async () => {
    const count = 13
    const { ports } = await setupClassification(classificationTree({ count }))
    const draft = draftFor(count)
    const expectedCandidates = [
      { id: 'tmp:1', path: ['01 Frontend'] },
      { id: 'tmp:2', path: ['02 Other'] },
    ]

    const response = await handle(
      ports,
      { kind: 'classify_structure', draft, edits: EMPTY_EDITS } as never,
      { createClient: () => classifyClient(), now: () => 2 },
    ) as { ok: true; kind: 'classify_structure'; plan: OrganizePlan }

    expect(response.plan.candidates).toEqual(expectedCandidates)
    expect(response.plan.warnings.some((warning) => warning.includes('13'))).toBe(true)
  })

  it('uses the draft title-rewrite decision even when current settings disagree', async () => {
    const githubTree = classificationTree({ github: true })
    const { ports } = await setupClassification(githubTree)
    const draft = draftFor(3, {
      rewriteGithubTitles: true,
      bookmarkFingerprint: [
        { id: '100', url: 'https://github.com/sst/opencode' },
        { id: '101', url: 'https://example.test/1' },
        { id: '102', url: 'https://example.test/2' },
      ],
    })

    const response = await handle(
      ports,
      { kind: 'classify_structure', draft, edits: EMPTY_EDITS } as never,
      { createClient: () => classifyClient(), now: () => 2 },
    ) as { ok: true; kind: 'classify_structure'; plan: OrganizePlan }

    expect(response.plan.operations).toContainEqual(expect.objectContaining({
      type: 'rename_bookmark', bookmarkId: '100', newTitle: 'opencode (sst)',
    }))
  })

  it('returns the existing cancelled response after a classification batch completes', async () => {
    const { ports } = await setupClassification()
    let cancelled = false
    const client = classifyClient()
    const complete = client.complete
    client.complete = vi.fn(async (...args: Parameters<LlmClient['complete']>) => {
      const result = await complete(...args)
      cancelled = true
      return result
    })

    const response = await handle(
      ports,
      { kind: 'classify_structure', draft: draftFor(), edits: EMPTY_EDITS } as never,
      { createClient: (_config: LlmConfig) => client, isCancelled: () => cancelled },
    )

    expect(response).toMatchObject({ ok: false, cancelled: true })
  })

  describe('分类后收拢装不满的新目录', () => {
    /** 按书签 id 指定分类去向；记下每次分类请求。 */
    function routeClient(route: Record<string, string | null>, prompts: string[] = []): LlmClient {
      return {
        complete: vi.fn(async (prompt: string) => {
          prompts.push(prompt)
          const ids = [...prompt.matchAll(/"bookmark_id": "([^"]+)"/g)].map((match) => match[1]!)
          return {
            results: ids.map((bookmark_id) => ({
              bookmark_id,
              target_category_id: route[bookmark_id] ?? null,
              confidence: 0.9,
              reason: 'belongs here',
            })),
          }
        }),
      }
    }

    const top = (id: string, title: string) =>
      ({ temporaryId: id, parentTemporaryId: null, parentId: '1', title })
    const sub = (id: string, parent: string, title: string) =>
      ({ temporaryId: id, parentTemporaryId: parent, parentId: null, title })

    async function classify(
      draft: StructureDraft,
      route: Record<string, string | null>,
      edits: StructureEdits = EMPTY_EDITS,
      prompts: string[] = [],
    ): Promise<OrganizePlan> {
      const { ports } = await setupClassification(classificationTree({ count: draft.totalBookmarks }))
      const response = await handle(
        ports,
        { kind: 'classify_structure', draft, edits } as never,
        { createClient: () => routeClient(route, prompts), now: () => 2 },
      )
      if (!response.ok || response.kind !== 'classify_structure') {
        throw new Error(`expected a plan, got ${JSON.stringify(response)}`)
      }
      return response.plan
    }

    const targetOf = (plan: OrganizePlan, bookmarkId: string) =>
      plan.rows.find((row) => row.bookmarkId === bookmarkId)?.toCategoryId

    it('预计够数、实际只收到 1 条的新一级目录不建，书签进「其他」且不重问模型', async () => {
      const draft = draftFor(5, {
        candidates: [
          { id: 'tmp:1', path: ['01 Frontend'] },
          { id: 'tmp:3', path: ['02 Backend'] },
          { id: 'tmp:2', path: ['03 Other'] },
        ],
        newFolders: [top('tmp:1', '01 Frontend'), top('tmp:3', '02 Backend'), top('tmp:2', '03 Other')],
      })
      const prompts: string[] = []
      const plan = await classify(draft, {
        100: 'tmp:1', 101: 'tmp:1', 102: 'tmp:1', 103: 'tmp:1', 104: 'tmp:3',
      }, EMPTY_EDITS, prompts)

      expect(plan.candidates.map((c) => c.id)).not.toContain('tmp:3')
      expect(targetOf(plan, '104')).toBe('tmp:2')
      expect(plan.rows.find((row) => row.bookmarkId === '104')!.reason).toContain('Backend')
      expect(prompts).toHaveLength(1)
    })

    it('实际不足 3 条的新子目录并入父目录', async () => {
      const draft = draftFor(5, {
        candidates: [
          { id: 'tmp:1', path: ['01 Frontend'] },
          { id: 'tmp:4', path: ['01 Frontend', '01 React'] },
          { id: 'tmp:2', path: ['02 Other'] },
        ],
        newFolders: [top('tmp:1', '01 Frontend'), sub('tmp:4', 'tmp:1', '01 React'), top('tmp:2', '02 Other')],
      })
      const plan = await classify(draft, {
        100: 'tmp:1', 101: 'tmp:1', 102: 'tmp:1', 103: 'tmp:4', 104: 'tmp:4',
      })

      expect(plan.candidates.map((c) => c.id)).not.toContain('tmp:4')
      expect(targetOf(plan, '103')).toBe('tmp:1')
      expect(targetOf(plan, '104')).toBe('tmp:1')
    })

    it('撤完后新父目录只剩一个子目录、自己不装书签时压平', async () => {
      const draft = draftFor(3, {
        candidates: [
          { id: 'tmp:1', path: ['01 Agents'] },
          { id: 'tmp:4', path: ['01 Agents', '01 Applied agents'] },
          { id: 'tmp:5', path: ['01 Agents', '02 Frameworks'] },
          { id: 'tmp:2', path: ['02 Other'] },
        ],
        newFolders: [
          top('tmp:1', '01 Agents'),
          sub('tmp:4', 'tmp:1', '01 Applied agents'),
          sub('tmp:5', 'tmp:1', '02 Frameworks'),
          top('tmp:2', '02 Other'),
        ],
      })
      const plan = await classify(draft, { 100: 'tmp:4', 101: 'tmp:4', 102: 'tmp:4' })

      expect(plan.candidates.map((c) => c.id)).toEqual(['tmp:1', 'tmp:2'])
      expect(['100', '101', '102'].map((id) => targetOf(plan, id))).toEqual(['tmp:1', 'tmp:1', 'tmp:1'])
      expect(plan.rows[0]!.reason).toContain('Applied agents')
    })

    it('用户在结构页新增的类型只收到 1 条也照建', async () => {
      const edits: StructureEdits = {
        ...EMPTY_EDITS,
        added: [{ temporaryId: 'tmp:user:reading', parentCategoryId: null, title: 'Reading' }],
      }
      const plan = await classify(draftFor(4), {
        100: 'tmp:1', 101: 'tmp:1', 102: 'tmp:1', 103: 'tmp:user:reading',
      }, edits)

      expect(plan.candidates.map((c) => c.id)).toContain('tmp:user:reading')
      expect(targetOf(plan, '103')).toBe('tmp:user:reading')
    })

    it('复用的用户已有目录只收到 1 条也照留', async () => {
      const draft = draftFor(4, {
        candidates: [
          { id: 'tmp:1', path: ['01 Frontend'] },
          { id: '10', path: ['02 Current'] },
          { id: 'tmp:2', path: ['03 Other'] },
        ],
        newFolders: [top('tmp:1', '01 Frontend'), top('tmp:2', '03 Other')],
      })
      const plan = await classify(draft, { 100: 'tmp:1', 101: 'tmp:1', 102: 'tmp:1', 103: '10' })

      expect(plan.candidates.map((c) => c.id)).toContain('10')
      expect(plan.unchanged.find((row) => row.bookmarkId === '103')?.kind).toBe('inPlace')
    })
  })
})
