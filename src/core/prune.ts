import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec } from './plan'
import { FALLBACK_TITLE } from './tree'
import type { TargetAssignment } from './audit'
import type { CategoryCandidate, Classification } from './types'

export interface PruneInput<T extends TargetAssignment = Classification> {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: T[]
  /** 目录至少要装下几个书签。1 或更小表示用户关掉了这项约束。 */
  minFolderSize: number
  locale: Locale
  /** 合并模式下容器目录的临时 id。它是容器不是分类，收不到书签是正常的。 */
  mergeRootTemporaryId?: string | null
}

export interface PruneResult<T extends TargetAssignment = Classification> {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: T[]
  /** 被撤掉的目录名（带编号），供日志与排查。 */
  prunedTitles: string[]
}

/** 改判后的理由会原样显示在结果页，必须双语，且讲的是「为什么不在原来那个目录」。 */
export function pruneReason(
  locale: Locale,
  title: string,
  count: number,
  minFolderSize: number,
  targetTitle: string | null,
): string {
  if (locale === 'zh_CN') {
    const head = `「${title}」只装下 ${count} 个书签，不足 ${minFolderSize} 个`
    return targetTitle === null ? `${head}，不再建这个目录` : `${head}，已并入「${targetTitle}」`
  }
  const head = `"${title}" holds only ${count} of the required ${minFolderSize} bookmarks`
  return targetTitle === null ? `${head}, so it is not created` : `${head}, so it was merged into "${targetTitle}"`
}

function isClassification(assignment: TargetAssignment): assignment is Classification {
  return 'confidence' in assignment && 'reason' in assignment && 'source' in assignment
}

/** Legacy post-classification callers still surface this reason in the review UI. */
function rewritePruneReason<T extends TargetAssignment>(
  assignment: T,
  locale: Locale,
  title: string,
  count: number,
  minFolderSize: number,
  targetTitle: string | null,
): void {
  if (isClassification(assignment)) {
    assignment.reason = pruneReason(locale, title, count, minFolderSize, targetTitle)
  }
}

/**
 * 撤掉按归属数仍然装不满的新目录，把里面的书签上提一层。
 *
 * 这是目录下限的最后一道：提示词（llm/prompts.ts）和建树（core/tree.ts）都只看
 * 主题的标签数，而目录还会被合并、下切、塌层改掉形状，只有逐条数过归属才知道结果
 * 长什么样。推翻模式在结构确认**之前**调用它，数的是 estimateAssignments 的预计归属；
 * 确认后结构冻结，逐条分类的真实结果只测量、不再剪枝。
 *
 * 三条不撤的规矩：
 * - 用户已有的目录不撤。里面只有一个书签是他自己的安排，整理不该顺手拆了它。
 * - 合并模式的容器目录不撤。它是容器不是分类。
 * - 还有存活子目录的父目录不撤，否则那些子目录没有父目录可挂。
 *
 * 还有一处看着矛盾、其实是对的：**建树时无条件放行「其他」，prune 这里却会撤它**。
 * 两处知道的信息不同——建树时它还没收到任何书签，拿标签数去判它毫无意义；
 * prune 时它的容量已经数得出来，装不满就不值得建。撤掉它之后没有下一站，
 * 里面的书签在这一步退回原位，而这正好与非推翻模式的「放不进就原地不动」是同一个行为
 * （见 issues/05-homeless-bookmarks.md「决定 4」）。
 *
 * 顺序也是语义的一部分：深的先判，父目录要等子目录并进来之后才知道自己够不够；
 * 同深度时「其他」最后判，它是所有撤销的去处，先判它就会在书签并进来之前被误撤。
 */
export function pruneSmallFolders<T extends TargetAssignment>(input: PruneInput<T>): PruneResult<T> {
  const { minFolderSize, locale } = input
  if (minFolderSize <= 1) {
    return {
      candidates: input.candidates,
      newFolders: input.newFolders,
      classifications: input.classifications,
      prunedTitles: [],
    }
  }

  const specById = new Map(input.newFolders.map((f) => [f.temporaryId, f]))
  const candidateById = new Map(input.candidates.map((c) => [c.id, c]))
  const fallbackKey = normalizeName(FALLBACK_TITLE[locale])
  const isFallback = (c: CategoryCandidate): boolean =>
    c.path.length === 1 && normalizeName(stripNumberPrefix(c.path[0]!)) === fallbackKey
  const fallback = input.candidates.find(isFallback) ?? null

  const prunable = input.candidates.filter(
    (c) => specById.has(c.id) && c.id !== input.mergeRootTemporaryId,
  )
  const order = [...prunable].sort(
    (a, b) => b.path.length - a.path.length || Number(isFallback(a)) - Number(isFallback(b)),
  )

  /** 新目录挂在谁下面。挂在范围根这类非候选目录下时，上提就没有下一站了。 */
  const parentIdOf = (id: string): string | null => {
    const spec = specById.get(id)
    if (spec === undefined) return null
    return spec.parentTemporaryId ?? spec.parentId
  }

  const classifications = input.classifications.map((c) => ({ ...c }))
  const removed = new Set<string>()
  const prunedTitles: string[] = []

  for (const folder of order) {
    const hasLiveChild = input.newFolders.some(
      (f) => f.temporaryId !== folder.id
        && !removed.has(f.temporaryId)
        && (f.parentTemporaryId ?? f.parentId) === folder.id,
    )
    if (hasLiveChild) continue

    const mine = classifications.filter((c) => c.targetCategoryId === folder.id)
    if (mine.length >= minFolderSize) continue

    const parentId = parentIdOf(folder.id)
    const parent = parentId === null || removed.has(parentId)
      ? null
      : candidateById.get(parentId) ?? null
    // 父目录没了就退到「其他」；正在撤的就是「其他」自己时没有下一站，书签保持原位
    const target = parent
      ?? (fallback !== null && fallback.id !== folder.id && !removed.has(fallback.id) ? fallback : null)

    removed.add(folder.id)
    prunedTitles.push(specById.get(folder.id)!.title)

    // 编号是建树阶段的内部产物，讲给用户听时不必带上
    const title = stripNumberPrefix(folder.path.at(-1) ?? '')
    const targetTitle = target === null ? null : stripNumberPrefix(target.path.at(-1) ?? '')
    for (const assignment of mine) {
      assignment.targetCategoryId = target?.id ?? null
      rewritePruneReason(assignment, locale, title, mine.length, minFolderSize, targetTitle)
    }
  }

  return {
    candidates: input.candidates.filter((c) => !removed.has(c.id)),
    newFolders: input.newFolders.filter((f) => !removed.has(f.temporaryId)),
    classifications,
    prunedTitles,
  }
}
