import { t } from '@/i18n'
import { normalizeName } from '@/core/map'
import {
  collapseSameNameFolders,
  createTemporaryIdFactory,
  expandFolder,
  findOversizedFolders,
  measureFallbackShare,
  measureTopSiblings,
  promoteFallbackChildren,
  type TargetAssignment,
} from '@/core/audit'
import type { Locale } from '@/core/locale'
import { buildPlan, type FolderMoveSpec, type NewFolderSpec } from '@/core/plan'
import { MIN_FOLDER_BOOKMARKS, pruneSmallFolders } from '@/core/prune'
import { FALLBACK_SHARE_LIMIT, MAX_LEAF, SHAPE_MAX_SIBLINGS, deriveShape } from '@/core/shape'
import { planTitleRewrites } from '@/core/titles'
import {
  applyStructureEditsToDraft,
  bookmarkFingerprint,
  estimateAssignments,
  sameBookmarkFingerprint,
  type StructureDraft,
  type StructureEdits,
} from '@/core/structure'
import { buildCategoryTree, FALLBACK_TITLE, MAX_SIBLINGS as PRODUCT_MAX_SIBLINGS } from '@/core/tree'
import type {
  BookmarkItem,
  CachedClassification,
  CategoryCandidate,
  FolderItem,
  OrganizePlan,
  ScanResult,
} from '@/core/types'
import { classifyBookmarks } from '@/llm/classify'
import type { LlmClient } from '@/llm/client'
import {
  applyDesign,
  collectTopics,
  designFolders,
  designTagFolders,
  nameMergedFolder,
} from '@/llm/folders'
import { extractTags } from '@/llm/tags'
import type { EmitProgress, ProgressPhase } from './events'

const MIN_DEEPEN_CALLS = 20

export function deepenBudget(leaves: number): number {
  return Math.max(MIN_DEEPEN_CALLS, leaves)
}

export interface DesignRebuildDraftInput {
  id: string
  createdAt: number
  scopeRootIds: string[]
  destinationRootId: string
  locale: Locale
  llm: { baseUrl: string; model: string }
  rewriteGithubTitles: boolean
  scan: ScanResult
  roots: FolderItem[]
  client: LlmClient
  concurrency: number
  batchSize?: number
  emit: EmitProgress
  isCancelled: () => boolean
}

export interface ClassifyRebuildDraftInput {
  draft: StructureDraft
  edits: StructureEdits
  locale: Locale
  scan: ScanResult
  roots: FolderItem[]
  client: LlmClient
  concurrency: number
  batchSize?: number
  emit: EmitProgress
  isCancelled: () => boolean
  cache: Map<string, CachedClassification>
}

export class RebuildCancelledError extends Error {}
export class StaleStructureDraftError extends Error {}
export class InvalidStructureDraftError extends Error {}
export class RebuildClassificationError extends Error {}

function staleDraftMessage(locale: Locale): string {
  return locale === 'zh_CN'
    ? '书签范围已变化，请重新生成结构'
    : 'The bookmark scope has changed. Please regenerate the structure.'
}

function logWith(input: { emit: EmitProgress }) {
  const log = (phase: ProgressPhase, message: string, level: 'info' | 'warn' | 'error' = 'info'): void =>
    input.emit({ phase, message, level })
  const progress = (phase: ProgressPhase) => (done: number, total: number): void =>
    input.emit({ phase, message: '', done, total })
  return { log, progress }
}

function assertNotCancelled(input: { isCancelled: () => boolean }): void {
  if (input.isCancelled()) throw new RebuildCancelledError('cancelled')
}

/**
 * 结构自检共用的日志口：调用方绑好自己的 phase（本模块用 'tree'，plan-analysis 的
 * 归入现有路径用 'classify'），helper 只管说什么、不管往哪个槽里说。
 */
export type SelfCheckLog = (message: string, level?: 'info' | 'warn') => void

/**
 * 结构自检其一：塌掉与上层同名的穿透层。两种模式共用——非推翻模式下
 * core/newTopics.ts 同样会在范围根下建新目录，同名套娃是同一个 bug。
 * 只动 newFolders 里的目录，用户自己的目录一根手指都不碰。
 * 必须排在下切之前——塌完之后原本第 2 层的目录升到第 1 层，深度预算凭空多出一层。
 */
export function collapseSameNameLayer<T extends TargetAssignment>(input: {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: T[]
  existingFolders: FolderItem[]
  locale: Locale
  mergeRootTemporaryId: string | null
}, log: SelfCheckLog): { candidates: CategoryCandidate[]; newFolders: NewFolderSpec[]; classifications: T[] } {
  const collapsed = collapseSameNameFolders({
    candidates: input.candidates,
    newFolders: input.newFolders,
    classifications: input.classifications,
    existingFolders: input.existingFolders,
    mergeRootTemporaryId: input.mergeRootTemporaryId,
  })
  if (collapsed.collapsedTitles.length > 0) {
    log(t('logReviewCollapsed', String(collapsed.collapsedTitles.length)))
  }
  return { candidates: collapsed.candidates, newFolders: collapsed.newFolders, classifications: collapsed.classifications }
}

/**
 * 结构自检其三：把「其他」切出来的族提到一级。「其他」是收容所，不应成为主题
 * 目录的父级。推翻模式下处理本轮新建的子目录；归入现有模式下则生成 move_folder，
 * 把已有子目录整体移到范围根。
 */
export function promoteFallbackLayer<T extends TargetAssignment>(input: {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: T[]
  locale: Locale
  rootIds: string[]
  existingFolders: Array<Pick<FolderItem, 'id' | 'parentId' | 'index'>>
  scanBookmarks: BookmarkItem[]
}, log: SelfCheckLog): {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: T[]
  folderMoves: FolderMoveSpec[]
  warnings: string[]
} {
  const bookmarkCountByFolder = new Map<string, number>()
  for (const bookmark of input.scanBookmarks) {
    bookmarkCountByFolder.set(
      bookmark.parentId,
      (bookmarkCountByFolder.get(bookmark.parentId) ?? 0) + 1,
    )
  }
  const promotion = promoteFallbackChildren({
    candidates: input.candidates,
    newFolders: input.newFolders,
    classifications: input.classifications,
    locale: input.locale,
    rootIds: input.rootIds,
    existingFolders: input.existingFolders,
    bookmarkCountByFolder,
  })
  for (const warning of promotion.warnings) log(warning, 'warn')
  if (promotion.promoted.length > 0) {
    const detail = promotion.promoted
      .map((item) => (input.locale === 'zh_CN'
        ? `「${item.title}」${item.count} 条`
        : `"${item.title}" (${item.count})`))
      .join(input.locale === 'zh_CN' ? '、' : ', ')
    log(t('logPromotedFallback', String(promotion.promoted.length), detail))
  }
  return {
    candidates: promotion.candidates,
    newFolders: promotion.newFolders,
    classifications: promotion.classifications,
    folderMoves: promotion.folderMoves,
    warnings: promotion.warnings,
  }
}

export function appendMeasurementWarnings(
  warnings: string[],
  candidates: StructureDraft['candidates'],
  assignments: StructureDraft['estimatedAssignments'],
  newFolders: StructureDraft['newFolders'],
  locale: Locale,
  total: number,
): void {
  const topSiblings = measureTopSiblings(candidates)
  if (topSiblings !== null) {
    warnings.push(topSiblings.tier === 'product'
      ? t('warnTopSiblingsProduct', String(topSiblings.count), String(PRODUCT_MAX_SIBLINGS))
      : t('warnTopSiblingsJudgment', String(topSiblings.count), String(SHAPE_MAX_SIBLINGS)))
  }
  for (const folder of findOversizedFolders({
    candidates,
    newFolders,
    classifications: assignments,
    locale,
    scope: 'all',
    maxLevel: Number.MAX_SAFE_INTEGER,
  })) {
    warnings.push(folder.kind === 'leftovers'
      ? t('warnStrandedLeftovers', folder.title, String(folder.count))
      : t('warnOversizedFolder', folder.title, String(folder.count)))
  }
  const fallbackShare = measureFallbackShare({
    candidates,
    classifications: assignments,
    locale,
    total,
  })
  if (fallbackShare !== null && fallbackShare.share > FALLBACK_SHARE_LIMIT) {
    warnings.push(t(
      'warnFallbackShare',
      String(fallbackShare.count),
      (fallbackShare.share * 100).toFixed(1),
      String(FALLBACK_SHARE_LIMIT * 100),
    ))
  }
}

export async function designRebuildDraft(
  input: DesignRebuildDraftInput,
): Promise<StructureDraft> {
  const { log, progress } = logWith(input)
  const rootId = input.destinationRootId
  const hasPermanent = input.roots.some((root) => (root.parentId ?? '0') === '0')
  const merging = input.roots.length >= 2 && !hasPermanent
  const rootLevel = input.scan.folders.find((folder) => folder.id === rootId)?.level ?? 0
  const startLevel = rootLevel + 1
  const shape = deriveShape(input.scan.bookmarks.length)
  const deepenCap = deepenBudget(shape.leaves)
  const allowChildren = shape.depth >= 2
  const topWithFallback = shape.top === 0 ? SHAPE_MAX_SIBLINGS : shape.top
  const maxTopFolders = topWithFallback + 1
  const maxChildFolders = Math.ceil(shape.leaves / topWithFallback)
  const containerTitle = merging
    ? undefined
    : input.roots.find((root) => root.id === rootId)?.title

  log('tags', t('logTagsStart', String(input.scan.bookmarks.length)))
  let sourceTags = await extractTags(input.scan.bookmarks, input.client, input.locale, {
    onProgress: progress('tags'),
    onLog: (message, level) => log('tags', message, level),
    isCancelled: input.isCancelled,
    batchSize: input.batchSize,
    concurrency: input.concurrency,
  })
  assertNotCancelled(input)

  log('tree', t('logTreeStart', String(input.scan.bookmarks.length)))
  const tags = await designTagFolders(sourceTags, input.client, input.locale, {
    onLog: (message, level) => log('tree', message, level),
    isCancelled: input.isCancelled,
    maxTopFolders,
    maxChildFolders,
    allowChildren,
    startLevel,
    ...(containerTitle === undefined ? {} : { containerTitle }),
    minFolderSize: MIN_FOLDER_BOOKMARKS,
  })
  assertNotCancelled(input)

  let mergeRoot: { parentId: string; title: string } | undefined
  if (merging) {
    const sourceTitles = input.roots.map((root) => root.title)
    const named = await nameMergedFolder(
      collectTopics(tags),
      sourceTitles,
      input.client,
      input.locale,
      { onLog: (message, level) => log('tree', message, level) },
    )
    assertNotCancelled(input)
    const title = named ?? sourceTitles.map((title_) => title_.replace(/^\d{2}\s+/, '')).join(' + ')
    if (named === null) log('tree', t('logMergeNameFailed', title), 'warn')
    else log('tree', t('logMergeNamed', title))
    mergeRoot = { parentId: input.roots[0]!.parentId!, title }
  }

  const built = buildCategoryTree({
    tags,
    rootId,
    existingFolders: input.scan.folders,
    locale: input.locale,
    mergeRoot,
    maxTopFolders,
    maxChildFolders,
    allowChildren,
    minFolderSize: MIN_FOLDER_BOOKMARKS,
  })
  let candidates = built.candidates
  let newFolders = built.newFolders
  let estimatedAssignments = estimateAssignments(tags, candidates)
  let folderMoves: StructureDraft['folderMoves'] = []
  const planMergeRoot: StructureDraft['mergeRoot'] =
    mergeRoot !== undefined && built.mergeRootTemporaryId !== null
      ? {
          temporaryId: built.mergeRootTemporaryId,
          title: mergeRoot.title,
          sourceRootIds: input.roots.map((root) => root.id),
          sourceTitles: input.roots.map((root) => root.title),
        }
      : null
  log('tree', t('logTreeDone', String(newFolders.length), String(candidates.length - newFolders.length)))
  const actualTop = newFolders.filter((folder) =>
    built.mergeRootTemporaryId === null
      ? folder.parentTemporaryId === null && folder.parentId === rootId
      : folder.parentTemporaryId === built.mergeRootTemporaryId,
  ).length
  log('tree', t('logShapeCompared', String(maxTopFolders), String(actualTop), String(allowChildren ? 2 : 1)))

  const pruned = pruneSmallFolders({
    candidates,
    newFolders,
    classifications: estimatedAssignments,
    locale: input.locale,
    minFolderSize: MIN_FOLDER_BOOKMARKS,
    mergeRootTemporaryId: planMergeRoot?.temporaryId ?? null,
  })
  // A tiny or degraded design can otherwise prune every candidate and produce a draft
  // that the compiler must reject. Keep the original minimal tree in that one case.
  if (pruned.candidates.length > 0) {
    candidates = pruned.candidates
    newFolders = pruned.newFolders
    estimatedAssignments = pruned.classifications
  }
  if (pruned.candidates.length > 0 && pruned.prunedTitles.length > 0) {
    log('tree', t('logPrunedSmall', String(pruned.prunedTitles.length), String(MIN_FOLDER_BOOKMARKS)))
  }

  const collapsed = collapseSameNameLayer({
    candidates,
    newFolders,
    classifications: estimatedAssignments,
    existingFolders: input.scan.folders,
    locale: input.locale,
    mergeRootTemporaryId: planMergeRoot?.temporaryId ?? null,
  }, (message, level) => log('tree', message, level))
  candidates = collapsed.candidates
  newFolders = collapsed.newFolders
  estimatedAssignments = collapsed.classifications

  const nextTemporaryId = createTemporaryIdFactory(newFolders)
  let deepenCalls = 0
  let previousMax = Number.MAX_SAFE_INTEGER
  const gaveUp = new Set<string>()
  const fallbackKey = normalizeName(FALLBACK_TITLE[input.locale])
  for (;;) {
    const oversized = findOversizedFolders({
      candidates,
      newFolders,
      classifications: estimatedAssignments,
      locale: input.locale,
      scope: 'all',
    }).filter((folder) => !gaveUp.has(folder.id))
    if (oversized.length === 0 || oversized[0]!.count >= previousMax) break
    previousMax = oversized[0]!.count
    let expandedAny = false

    for (const folder of oversized) {
      if (deepenCalls >= deepenCap) break
      const mine = new Set(
        estimatedAssignments
          .filter((assignment) => assignment.targetCategoryId === folder.id)
          .map((assignment) => assignment.bookmarkId),
      )
      let subTags = sourceTags.filter((tag) => mine.has(tag.bookmarkId))
      let topics = collectTopics(subTags)
      const isFallback = normalizeName(folder.title) === fallbackKey
      if (topics.length < 2 && isFallback && mine.size > MAX_LEAF) {
        assertNotCancelled(input)
        const items = input.scan.bookmarks.filter((bookmark) => mine.has(bookmark.id))
        log('tree', t('logDeepenRetag', folder.title, String(items.length)))
        const fresh = await extractTags(items, input.client, input.locale, {
          onLog: (message, level) => log('tree', message, level),
          isCancelled: input.isCancelled,
          batchSize: input.batchSize,
          concurrency: input.concurrency,
        })
        assertNotCancelled(input)
        const freshById = new Map(fresh.map((tag) => [tag.bookmarkId, tag]))
        sourceTags = [
          ...sourceTags.filter((tag) => !freshById.has(tag.bookmarkId)),
          ...fresh,
        ]
        subTags = fresh
        topics = collectTopics(subTags)
      }
      if (topics.length < 2) {
        log('tree', t('logDeepenNoTopics', folder.title, String(folder.count), String(topics.length)), 'warn')
        gaveUp.add(folder.id)
        continue
      }
      assertNotCancelled(input)
      log('tree', t('logDeepenStart', folder.title, String(folder.count), String(MAX_LEAF)))
      deepenCalls += 1
      const design = await designFolders(topics, input.client, input.locale, {
        oneLevel: true,
        ...(isFallback ? {} : { parentTitle: folder.title }),
        minFolderSize: MIN_FOLDER_BOOKMARKS,
        startLevel: rootLevel + folder.level + 1,
        onLog: (message, level) => log('tree', message, level),
        isCancelled: input.isCancelled,
      })
      assertNotCancelled(input)
      if (design === null) {
        gaveUp.add(folder.id)
        continue
      }
      const parent = candidates.find((candidate) => candidate.id === folder.id)
      if (parent === undefined) {
        gaveUp.add(folder.id)
        continue
      }
      const expanded = expandFolder({
        parent,
        tags: applyDesign(subTags, design),
        classifications: estimatedAssignments,
        nextTemporaryId,
        count: folder.count,
        maxLeaf: MAX_LEAF,
        locale: input.locale,
      })
      if (expanded.createdCount === 0) {
        log('tree', t('logDeepenNoSplit', folder.title, String(folder.count)), 'warn')
        gaveUp.add(folder.id)
        continue
      }
      newFolders = [...newFolders, ...expanded.newFolders]
      candidates = [...candidates, ...expanded.candidates]
      estimatedAssignments = expanded.classifications
      expandedAny = true
      log('tree', t('logDeepenDone', folder.title, String(expanded.createdCount)))
    }
    if (!expandedAny || deepenCalls >= deepenCap) break
    const rePruned = pruneSmallFolders({
      candidates,
      newFolders,
      classifications: estimatedAssignments,
      locale: input.locale,
      minFolderSize: MIN_FOLDER_BOOKMARKS,
      mergeRootTemporaryId: planMergeRoot?.temporaryId ?? null,
    })
    if (rePruned.candidates.length > 0) {
      candidates = rePruned.candidates
      newFolders = rePruned.newFolders
      estimatedAssignments = rePruned.classifications
    }
    if (rePruned.candidates.length > 0 && rePruned.prunedTitles.length > 0) {
      log('tree', t('logPrunedSmall', String(rePruned.prunedTitles.length), String(MIN_FOLDER_BOOKMARKS)))
    }
  }

  const promotion = promoteFallbackLayer({
    candidates,
    newFolders,
    classifications: estimatedAssignments,
    locale: input.locale,
    rootIds: input.roots.map((root) => root.id),
    existingFolders: input.scan.folders.map((folder) => ({
      id: folder.id,
      parentId: folder.parentId,
      index: folder.index,
    })),
    scanBookmarks: input.scan.bookmarks,
  }, (message, level) => log('tree', message, level))
  candidates = promotion.candidates
  newFolders = promotion.newFolders
  estimatedAssignments = promotion.classifications
  folderMoves = promotion.folderMoves
  const warnings = [...promotion.warnings]
  appendMeasurementWarnings(
    warnings,
    candidates,
    estimatedAssignments,
    newFolders,
    input.locale,
    input.scan.bookmarks.length,
  )

  return {
    id: input.id,
    createdAt: input.createdAt,
    scopeRootIds: input.scopeRootIds,
    destinationRootId: input.destinationRootId,
    locale: input.locale,
    llm: input.llm,
    totalBookmarks: input.scan.bookmarks.length,
    bookmarkFingerprint: bookmarkFingerprint(input.scan.bookmarks),
    candidates,
    newFolders,
    renameFolders: built.renameFolders,
    folderMoves,
    mergeRoot: planMergeRoot,
    tags,
    sourceTags,
    estimatedAssignments,
    rootLevel,
    deepenCap,
    warnings,
    rewriteGithubTitles: input.rewriteGithubTitles,
  }
}

function requiredRootIds(draft: StructureDraft): string[] {
  return draft.mergeRoot?.sourceRootIds ?? [draft.destinationRootId]
}

export function isRebuildDraftFresh(
  draft: StructureDraft,
  scan: ScanResult,
  roots: FolderItem[],
): boolean {
  const rootIds = new Set(roots.map((root) => root.id))
  return requiredRootIds(draft).every((rootId) => rootIds.has(rootId))
    && sameBookmarkFingerprint(draft.bookmarkFingerprint, scan.bookmarks)
}

export function staleRebuildDraftError(locale: Locale): StaleStructureDraftError {
  return new StaleStructureDraftError(staleDraftMessage(locale))
}

export async function classifyRebuildDraft(
  input: ClassifyRebuildDraftInput,
): Promise<OrganizePlan> {
  const { log, progress } = logWith(input)
  const compiled = applyStructureEditsToDraft(input.draft, input.edits, input.locale)
  if (compiled.validation.errors.length > 0) {
    throw new InvalidStructureDraftError(compiled.validation.errors[0]!.message)
  }
  if (!isRebuildDraftFresh(input.draft, input.scan, input.roots)) {
    throw staleRebuildDraftError(input.locale)
  }

  log('classify', t('logClassifyStart', String(input.scan.bookmarks.length), String(compiled.candidates.length)))
  const classifications = await classifyBookmarks({
    items: input.scan.bookmarks,
    candidates: compiled.candidates,
    client: input.client,
    cache: input.cache,
    batchSize: input.batchSize,
    concurrency: input.concurrency,
    onProgress: progress('classify'),
    onLog: (message, level) => log('classify', message, level),
    isCancelled: input.isCancelled,
    locale: input.locale,
    model: input.draft.llm.model,
    includeTopicRule: false,
  })
  assertNotCancelled(input)

  const failed = classifications.filter((classification) => classification.source === 'none')
  if (input.scan.bookmarks.length > 0 && failed.length === input.scan.bookmarks.length) {
    throw new RebuildClassificationError(t('errClassifyAllFailed', failed[0]!.reason))
  }
  // 用户新增的一级目录只有真的收到书签才应进入最终计划。它与模型设计出的目录不同：
  // 用户明确新增后即使只收到一条也要保留，但零命中时创建一个空目录没有任何可见收益。
  const usedTargets = new Set(classifications.flatMap((classification) =>
    classification.targetCategoryId === null ? [] : [classification.targetCategoryId]))
  const emptyAddedIds = new Set(input.edits.added
    .filter((added) => !usedTargets.has(added.temporaryId))
    .map((added) => added.temporaryId))
  const candidates = compiled.candidates.filter((candidate) => !emptyAddedIds.has(candidate.id))
  const newFolders = compiled.newFolders.filter((folder) => !emptyAddedIds.has(folder.temporaryId))
  const warnings = [...compiled.validation.warnings]
  if (failed.length > 0) {
    warnings.push(t(
      'logClassifyFailed',
      String(failed.length),
      failed[0]!.detail ?? failed[0]!.reason,
    ))
  }
  appendMeasurementWarnings(
    warnings,
    candidates,
    classifications,
    newFolders,
    input.locale,
    input.scan.bookmarks.length,
  )
  const uniqueWarnings = [...new Set(warnings)]
  const titleRewrites = input.draft.rewriteGithubTitles
    ? planTitleRewrites(input.scan.bookmarks)
    : []
  const createdAt = Date.now()
  const plan = buildPlan({
    id: `plan-${createdAt}`,
    createdAt,
    scopeRootIds: input.draft.scopeRootIds,
    rebuildStructure: true,
    items: input.scan.bookmarks,
    candidates,
    classifications,
    newFolders,
    renameFolders: compiled.renameFolders,
    folderMoves: compiled.folderMoves,
    mergeRoot: compiled.mergeRoot ?? undefined,
    warnings: uniqueWarnings,
    tags: input.draft.tags,
    titleRewrites,
  })
  for (const warning of uniqueWarnings) log('classify', warning, 'warn')
  log('classify', t('logAnalyzeDone', String(plan.rows.length)))
  return plan
}
