import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import { summarize } from './plan'
import type { FolderMoveSpec, NewFolderSpec, RenameFolderSpec } from './plan'
import { FALLBACK_TITLE } from './tree'
import type {
  BookmarkOperation,
  CategoryCandidate,
  OrganizePlan,
  PlanRow,
  TagResult,
  UnchangedRow,
} from './types'

export interface EstimatedAssignment {
  bookmarkId: string
  targetCategoryId: string | null
}

export interface AddedStructureNode {
  temporaryId: string
  parentCategoryId: null
  title: string
}

export interface StructureEdits {
  /** candidate id → 用户输入的新名字，不含编号前缀。 */
  renames: Record<string, string>
  /** 被删掉的 candidate id。 */
  removed: string[]
  /**
   * 被合并的 candidate id → 接收方 candidate id。
   *
   * **合并 = 删除 + 指定去处**：被合并的目录同时出现在 `removed` 里，这里只回答「里面的书签去哪」。
   * 两件事必须一起写（store 的 `mergeNode` 保证这一点），只写一处会得到
   * 「目录没了但书签按默认链回落」或「书签改投了但目录还在」两种半截状态。
   */
  mergedInto: Record<string, string>
  added: AddedStructureNode[]
}

export const EMPTY_EDITS: StructureEdits = { renames: {}, removed: [], mergedInto: {}, added: [] }

/** Task 5 removes this compatibility shape when the store switches to StructureDraft. */
type LegacyStructureEdits = Omit<StructureEdits, 'added'> & { added?: AddedStructureNode[] }

export interface StructureDraft {
  id: string
  createdAt: number
  scopeRootIds: string[]
  destinationRootId: string
  locale: Locale
  llm: { baseUrl: string; model: string }
  totalBookmarks: number
  bookmarkFingerprint: Array<{ id: string; url: string }>
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  renameFolders: RenameFolderSpec[]
  folderMoves: FolderMoveSpec[]
  mergeRoot: OrganizePlan['mergeRoot']
  tags: TagResult[]
  sourceTags: TagResult[]
  estimatedAssignments: EstimatedAssignment[]
  rootLevel: number
  deepenCap: number
  warnings: string[]
  rewriteGithubTitles: boolean
}

export interface StructureCheckpoint {
  draft: StructureDraft
  edits: StructureEdits
  state: 'awaiting_confirmation' | 'classifying'
  updatedAt: number
}

export interface StructureValidation {
  errors: Array<{ nodeId: string | null; code: string; message: string }>
  warnings: string[]
}

export interface CompiledStructure {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  renameFolders: RenameFolderSpec[]
  folderMoves: FolderMoveSpec[]
  mergeRoot: OrganizePlan['mergeRoot']
  estimatedAssignments: EstimatedAssignment[]
  validation: StructureValidation
}

export function bookmarkFingerprint(
  bookmarks: Array<{ id: string; url: string }>,
): Array<{ id: string; url: string }> {
  return bookmarks
    .map(({ id, url }) => ({ id, url }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.url.localeCompare(b.url))
}

export function sameBookmarkFingerprint(
  a: Array<{ id: string; url: string }>,
  b: Array<{ id: string; url: string }>,
): boolean {
  const left = bookmarkFingerprint(a)
  const right = bookmarkFingerprint(b)
  return left.length === right.length && left.every(
    (item, index) => item.id === right[index]!.id && item.url === right[index]!.url,
  )
}

const normalizedPath = (path: string[]): string[] =>
  path.map((segment) => normalizeName(stripNumberPrefix(segment)))

export function estimateAssignments(
  tags: TagResult[],
  candidates: CategoryCandidate[],
): EstimatedAssignment[] {
  const candidatesByPath = new Map<string, CategoryCandidate[]>()
  for (const candidate of candidates) {
    const key = JSON.stringify(normalizedPath(candidate.path))
    const matches = candidatesByPath.get(key) ?? []
    matches.push(candidate)
    candidatesByPath.set(key, matches)
  }

  return tags.map((tag) => {
    const path = tag.secondaryTopic === null
      ? [tag.primaryTopic]
      : [tag.primaryTopic, tag.secondaryTopic]
    const matches = candidatesByPath.get(JSON.stringify(normalizedPath(path))) ?? []
    return {
      bookmarkId: tag.bookmarkId,
      targetCategoryId: matches.length === 1 ? matches[0]!.id : null,
    }
  })
}

type StructureError = StructureValidation['errors'][number]

const USER_TEMPORARY_ID = /^tmp:user:[A-Za-z0-9][A-Za-z0-9._-]*$/

function validationMessage(code: string, locale: Locale): string {
  const messages: Record<string, [string, string]> = {
    blank_name: ['名称不能为空', 'Folder names cannot be blank'],
    duplicate_sibling_name: ['同一层不能有重名目录', 'Sibling folders must have unique names'],
    reserved_fallback_name: ['不能新增保留的兜底目录名', 'The fallback folder name is reserved'],
    unknown_merge_source: ['找不到要合并的目录', 'The merge source does not exist'],
    unknown_merge_destination: ['找不到合并接收目录', 'The merge destination does not exist'],
    cross_parent_merge: ['只能合并同一层的目录', 'Only folders with the same parent can be merged'],
    merge_cycle: ['目录合并不能形成循环', 'Folder merges cannot form a cycle'],
    empty_structure: ['至少保留一个分类目录', 'At least one category must remain'],
    invalid_temporary_id: ['新增目录的临时 ID 无效', 'The added folder has an invalid temporary ID'],
    nested_addition: ['目前只能新增一级目录', 'Only top-level folders can be added'],
    duplicate_temporary_id: ['新增目录的临时 ID 重复', 'The added folder has a duplicate temporary ID'],
  }
  return messages[code]?.[locale === 'zh_CN' ? 0 : 1] ?? code
}

function structureError(nodeId: string | null, code: string, locale: Locale): StructureError {
  return { nodeId, code, message: validationMessage(code, locale) }
}

function removedCandidateIds(draft: StructureDraft, edits: StructureEdits): Set<string> {
  const removed = new Set([...edits.removed, ...Object.keys(edits.mergedInto)])
  const parentOf = buildParentMap(draft.candidates)

  for (const candidate of draft.candidates) {
    const parentId = parentOf.get(candidate.id)
    if (parentId !== undefined && removed.has(parentId)) removed.add(candidate.id)
  }
  return removed
}

function editedTitle(candidate: CategoryCandidate, edits: StructureEdits): string {
  const renamed = edits.renames[candidate.id]
  return renamed === undefined || renamed.trim() === ''
    ? stripNumberPrefix(candidate.path.at(-1)!)
    : stripNumberPrefix(renamed.trim())
}

export function validateStructureEdits(
  draft: StructureDraft,
  edits: StructureEdits,
  locale: Locale,
): StructureValidation {
  const errors: StructureError[] = []
  const byId = new Map(draft.candidates.map((candidate) => [candidate.id, candidate]))
  const parentOf = buildParentMap(draft.candidates)
  const additions = edits.added ?? []

  for (const [nodeId, title] of Object.entries(edits.renames)) {
    if (title.trim() === '') errors.push(structureError(nodeId, 'blank_name', locale))
  }

  const seenIds = new Set(draft.candidates.map((candidate) => candidate.id))
  for (const added of additions) {
    if (added.title.trim() === '') errors.push(structureError(added.temporaryId, 'blank_name', locale))
    if (!USER_TEMPORARY_ID.test(added.temporaryId)) {
      errors.push(structureError(added.temporaryId, 'invalid_temporary_id', locale))
    }
    if (seenIds.has(added.temporaryId)) {
      errors.push(structureError(added.temporaryId, 'duplicate_temporary_id', locale))
    }
    seenIds.add(added.temporaryId)
    if (added.parentCategoryId !== null) {
      errors.push(structureError(added.temporaryId, 'nested_addition', locale))
    }
    if (
      normalizeName(stripNumberPrefix(added.title.trim())) ===
      normalizeName(FALLBACK_TITLE[locale])
    ) {
      errors.push(structureError(added.temporaryId, 'reserved_fallback_name', locale))
    }
  }

  for (const [sourceId, destinationId] of Object.entries(edits.mergedInto)) {
    const source = byId.get(sourceId)
    const destination = byId.get(destinationId)
    if (source === undefined) {
      errors.push(structureError(sourceId, 'unknown_merge_source', locale))
      continue
    }
    if (destination === undefined) {
      errors.push(structureError(destinationId, 'unknown_merge_destination', locale))
      continue
    }
    if ((parentOf.get(sourceId) ?? null) !== (parentOf.get(destinationId) ?? null)) {
      errors.push(structureError(sourceId, 'cross_parent_merge', locale))
    }
  }

  const cycleNodes = new Set<string>()
  for (const sourceId of Object.keys(edits.mergedInto)) {
    const seen = new Set<string>()
    let current: string | undefined = sourceId
    while (current !== undefined) {
      if (seen.has(current)) {
        cycleNodes.add(current)
        break
      }
      seen.add(current)
      current = edits.mergedInto[current]
    }
  }
  for (const nodeId of cycleNodes) errors.push(structureError(nodeId, 'merge_cycle', locale))

  const removed = removedCandidateIds(draft, edits)
  const remaining = draft.candidates.filter((candidate) => !removed.has(candidate.id))
  if (remaining.length === 0 && additions.length === 0) {
    errors.push(structureError(null, 'empty_structure', locale))
  }

  const siblingNames = new Map<string, Map<string, string>>()
  const registerName = (parentId: string | null, nodeId: string, title: string): void => {
    const parentKey = parentId ?? '__root__'
    const normalized = normalizeName(stripNumberPrefix(title.trim()))
    if (normalized === '') return
    const names = siblingNames.get(parentKey) ?? new Map<string, string>()
    const duplicateOf = names.get(normalized)
    if (duplicateOf !== undefined) {
      errors.push(structureError(nodeId, 'duplicate_sibling_name', locale))
    } else {
      names.set(normalized, nodeId)
    }
    siblingNames.set(parentKey, names)
  }
  for (const candidate of remaining) {
    registerName(parentOf.get(candidate.id) ?? null, candidate.id, editedTitle(candidate, edits))
  }
  for (const added of additions) registerName(null, added.temporaryId, added.title)

  return { errors, warnings: [...draft.warnings] }
}

function resolveEstimatedTarget(
  targetId: string | null,
  edits: StructureEdits,
  candidateIds: Set<string>,
  removed: Set<string>,
): string | null {
  if (targetId === null || !candidateIds.has(targetId)) return null
  const seen = new Set<string>()
  let current = targetId
  while (edits.mergedInto[current] !== undefined) {
    if (seen.has(current)) return null
    seen.add(current)
    const destination = edits.mergedInto[current]!
    if (!candidateIds.has(destination)) return null
    current = destination
  }
  return removed.has(current) ? null : current
}

export function applyStructureEditsToDraft(
  draft: StructureDraft,
  edits: StructureEdits,
  locale: Locale,
): CompiledStructure {
  const validation = validateStructureEdits(draft, edits, locale)
  const additions = edits.added ?? []
  const removed = removedCandidateIds(draft, edits)
  const mergeRoot = draft.mergeRoot === null
    ? null
    : {
        ...draft.mergeRoot,
        title:
          edits.renames[draft.mergeRoot.temporaryId]?.trim() || draft.mergeRoot.title,
      }
  const originalFallbackId = draft.candidates.find((candidate) => isFallback(candidate, locale))?.id
  const parentOf = buildParentMap(draft.candidates)

  const survivingOriginals = draft.candidates.filter((candidate) => !removed.has(candidate.id))
  const firstFallbackIndex = survivingOriginals.findIndex(
    (candidate) => candidate.id === originalFallbackId,
  )
  const addedCandidates: CategoryCandidate[] = additions.map((added) => ({
    id: added.temporaryId,
    path: [stripNumberPrefix(added.title.trim())],
  }))
  const insertionIndex = firstFallbackIndex === -1 ? survivingOriginals.length : firstFallbackIndex
  const orderedCandidates = [
    ...survivingOriginals.slice(0, insertionIndex),
    ...addedCandidates,
    ...survivingOriginals.slice(insertionIndex),
  ]
  const orderedById = new Map(orderedCandidates.map((candidate) => [candidate.id, candidate]))
  const addedIds = new Set(additions.map((added) => added.temporaryId))

  const topIds = orderedCandidates
    .filter((candidate) => candidate.path.length === 1)
    .map((candidate) => candidate.id)
  const topTitleById = new Map<string, string>()
  const numberedPathById = new Map<string, string[]>()
  topIds.forEach((topId, index) => {
    const candidate = orderedById.get(topId)!
    const bareTitle = addedIds.has(topId)
      ? stripNumberPrefix(candidate.path[0]!)
      : editedTitle(candidate, edits)
    const title = `${String(index + 1).padStart(2, '0')} ${bareTitle}`
    topTitleById.set(topId, title)
    numberedPathById.set(topId, [title])
  })

  for (const topId of topIds) {
    const childIds = orderedCandidates
      .filter((candidate) => parentOf.get(candidate.id) === topId)
      .map((candidate) => candidate.id)
    childIds.forEach((childId, index) => {
      const candidate = orderedById.get(childId)!
      numberedPathById.set(childId, [
        topTitleById.get(topId)!,
        `${String(index + 1).padStart(2, '0')} ${editedTitle(candidate, edits)}`,
      ])
    })
  }

  const candidates = orderedCandidates.map((candidate) => ({
    ...candidate,
    path: numberedPathById.get(candidate.id) ?? candidate.path.map(stripNumberPrefix),
  }))
  const pathById = new Map(candidates.map((candidate) => [candidate.id, candidate.path]))
  const originalNewFolderById = new Map(
    draft.newFolders.map((folder) => [folder.temporaryId, folder]),
  )
  const addedById = new Map(additions.map((added) => [added.temporaryId, added]))
  const mergeRootFolder =
    mergeRoot === null ? undefined : originalNewFolderById.get(mergeRoot.temporaryId)
  const categoryNewFolders = candidates.flatMap((candidate): NewFolderSpec[] => {
    const path = pathById.get(candidate.id)!
    const existing = originalNewFolderById.get(candidate.id)
    if (existing !== undefined) return [{ ...existing, title: path.at(-1)! }]
    const added = addedById.get(candidate.id)
    if (added === undefined) return []
    return [{
      temporaryId: added.temporaryId,
      parentTemporaryId: draft.mergeRoot?.temporaryId ?? null,
      parentId: draft.mergeRoot === null ? draft.destinationRootId : null,
      title: path.at(-1)!,
    }]
  })
  const newFolders: NewFolderSpec[] = [
    ...(mergeRootFolder === undefined || mergeRoot === null
      ? []
      : [{ ...mergeRootFolder, title: mergeRoot.title }]),
    ...categoryNewFolders,
  ]

  const renameFolders = draft.renameFolders.flatMap((folder): RenameFolderSpec[] => {
    const path = pathById.get(folder.folderId)
    return path === undefined ? [] : [{ ...folder, newTitle: path.at(-1)! }]
  })
  const folderMoves = draft.folderMoves
    .filter((move) => !removed.has(move.folderId))
    .map((move) => ({ ...move }))
  const candidateIds = new Set(draft.candidates.map((candidate) => candidate.id))
  const estimatedAssignments = draft.estimatedAssignments.map((assignment) => ({
    bookmarkId: assignment.bookmarkId,
    targetCategoryId: resolveEstimatedTarget(
      assignment.targetCategoryId, edits, candidateIds, removed,
    ),
  }))
  return {
    candidates,
    newFolders,
    renameFolders,
    folderMoves,
    mergeRoot,
    estimatedAssignments,
    validation,
  }
}

/** 结构确认页渲染用的两层视图。 */
export interface StructureNode {
  id: string
  title: string
  /** 本节点及其子节点将移入的书签数。 */
  count: number
  removable: boolean
  children: StructureNode[]
}

const isFallback = (candidate: CategoryCandidate, locale: Locale): boolean =>
  candidate.path.length === 1 &&
  normalizeName(stripNumberPrefix(candidate.path[0]!)) === normalizeName(FALLBACK_TITLE[locale])

/**
 * 结构页删掉一个目录后，`resolve()` 找不到回落点时用的理由——
 * 「没有合适目录」是模型说的，这里不是，是用户自己删掉了收留它的地方，说法要分清。
 */
function noFallbackReason(locale: Locale): string {
  return locale === 'zh_CN'
    ? '你删掉了本来要收它的目录，现在没有别的地方可去'
    : 'The folder that was going to hold it got deleted, and there is nowhere else for it to go'
}

/** 编辑后的裸名字：用户改过就用他的，否则用去掉编号的原名。 */
const titleOf = (candidate: CategoryCandidate, edits: LegacyStructureEdits): string =>
  edits.renames[candidate.id] ?? stripNumberPrefix(candidate.path.at(-1)!)

/** 子目录 → 它所属的一级目录 id。靠 path[0] 关联，同一个 plan 内唯一。 */
function buildParentMap(candidates: CategoryCandidate[]): Map<string, string> {
  const topByPath = new Map<string, string>()
  for (const candidate of candidates) {
    if (candidate.path.length === 1) topByPath.set(candidate.path[0]!, candidate.id)
  }
  const parentOf = new Map<string, string>()
  for (const candidate of candidates) {
    if (candidate.path.length !== 2) continue
    const parent = topByPath.get(candidate.path[0]!)
    if (parent !== undefined) parentOf.set(candidate.id, parent)
  }
  return parentOf
}

/** 每个书签本次会被移到哪个 candidate。没有移动操作的书签不在表里。 */
function buildTargetMap(operations: BookmarkOperation[]): Map<string, string> {
  const targets = new Map<string, string>()
  for (const operation of operations) {
    if (operation.type === 'move_bookmark') targets.set(operation.bookmarkId, operation.toCategoryId)
  }
  return targets
}

export function buildStructureView(
  draft: StructureDraft, edits: StructureEdits, locale: Locale,
): StructureNode[]
export function buildStructureView(
  plan: OrganizePlan, edits: LegacyStructureEdits, locale: Locale,
): StructureNode[]
export function buildStructureView(
  input: StructureDraft | OrganizePlan, edits: LegacyStructureEdits, locale: Locale,
): StructureNode[] {
  if ('estimatedAssignments' in input) {
    const compiled = applyStructureEditsToDraft(
      input, { ...edits, added: edits.added ?? [] }, locale,
    )
    const parentOf = buildParentMap(compiled.candidates)
    const directCount = new Map<string, number>()
    for (const assignment of compiled.estimatedAssignments) {
      if (assignment.targetCategoryId === null) continue
      directCount.set(
        assignment.targetCategoryId,
        (directCount.get(assignment.targetCategoryId) ?? 0) + 1,
      )
    }

    return compiled.candidates
      .filter((candidate) => candidate.path.length === 1)
      .map((candidate) => {
        const children: StructureNode[] = compiled.candidates
          .filter((child) => parentOf.get(child.id) === candidate.id)
          .map((child) => ({
            id: child.id,
            title: stripNumberPrefix(child.path.at(-1)!),
            count: directCount.get(child.id) ?? 0,
            removable: true,
            children: [],
          }))
        return {
          id: candidate.id,
          title: stripNumberPrefix(candidate.path[0]!),
          count:
            (directCount.get(candidate.id) ?? 0) +
            children.reduce((sum, child) => sum + child.count, 0),
          removable: !isFallback(candidate, locale),
          children,
        }
      })
  }

  const plan = input
  const removed = new Set(edits.removed)
  const parentOf = buildParentMap(plan.candidates)
  const targets = buildTargetMap(plan.operations)

  const directCount = new Map<string, number>()
  for (const categoryId of targets.values()) {
    directCount.set(categoryId, (directCount.get(categoryId) ?? 0) + 1)
  }

  const nodes: StructureNode[] = []
  for (const candidate of plan.candidates) {
    if (candidate.path.length !== 1 || removed.has(candidate.id)) continue
    const children: StructureNode[] = plan.candidates
      .filter((c) => c.path.length === 2 && parentOf.get(c.id) === candidate.id && !removed.has(c.id))
      .map((c) => ({
        id: c.id,
        title: titleOf(c, edits),
        count: directCount.get(c.id) ?? 0,
        removable: true,
        children: [],
      }))
    nodes.push({
      id: candidate.id,
      title: titleOf(candidate, edits),
      count: (directCount.get(candidate.id) ?? 0) + children.reduce((sum, c) => sum + c.count, 0),
      removable: !isFallback(candidate, locale),
      children,
    })
  }
  return nodes
}

export function applyStructureEdits(
  plan: OrganizePlan, edits: LegacyStructureEdits, locale: Locale,
): OrganizePlan {
  const removed = new Set(edits.removed)
  // 合并根是容器不是分类，删掉它整棵树就无处可去
  if (plan.mergeRoot !== null) removed.delete(plan.mergeRoot.temporaryId)

  /** 合并根改名后的标题；用户清空输入时退回模型给的原名。 */
  const mergeRootTitle =
    plan.mergeRoot === null
      ? null
      : (edits.renames[plan.mergeRoot.temporaryId]?.trim() ?? '') === ''
        ? plan.mergeRoot.title
        : edits.renames[plan.mergeRoot.temporaryId]!.trim()

  const byId = new Map(plan.candidates.map((c) => [c.id, c]))
  const parentOf = buildParentMap(plan.candidates)
  const fallbackId = plan.candidates.find((c) => isFallback(c, locale))?.id ?? null

  // 一级目录被删时，它的子目录一并消失
  for (const candidate of plan.candidates) {
    const parent = parentOf.get(candidate.id)
    if (parent !== undefined && removed.has(parent)) removed.add(candidate.id)
  }

  /** 书签原本的目标目录若被删，算出它该落到哪里；null 表示无处可去、不再移动。 */
  function resolve(categoryId: string, seen: Set<string>): string | null {
    if (!removed.has(categoryId)) return categoryId
    if (seen.has(categoryId)) return fallbackId
    seen.add(categoryId)

    // 用户指定的去处优先于所有默认回落：他刚刚亲手说了这批书签该去哪，
    // 比「二级回落到父目录」这类默认规则算数。接收方自己也被合并时继续往下走，
    // 成环由上面的 seen 兜住（落回「其他」，不会转圈）
    const merged = edits.mergedInto[categoryId]
    if (merged !== undefined) return resolve(merged, seen)

    const candidate = byId.get(categoryId)
    if (candidate === undefined) return fallbackId

    // 二级目录回落到父目录，而不是「其他」
    const parent = parentOf.get(categoryId)
    if (parent !== undefined) return resolve(parent, seen)

    return fallbackId
  }

  const candidates: CategoryCandidate[] = plan.candidates
    .filter((c) => !removed.has(c.id))
    .map((c) => {
      const own = titleOf(c, edits)
      if (c.path.length === 1) return { ...c, path: [own] }
      const parent = parentOf.get(c.id)
      const parentCandidate = parent === undefined ? undefined : byId.get(parent)
      const parentTitle =
        parentCandidate === undefined ? stripNumberPrefix(c.path[0]!) : titleOf(parentCandidate, edits)
      return { ...c, path: [parentTitle, own] }
    })

  const pathById = new Map(candidates.map((c) => [c.id, c.path]))
  const survivingTempIds = new Set(candidates.map((c) => c.id))

  const retarget = new Map<string, string | null>()
  for (const operation of plan.operations) {
    if (operation.type !== 'move_bookmark') continue
    retarget.set(operation.bookmarkId, resolve(operation.toCategoryId, new Set()))
  }

  const operations = plan.operations.flatMap((operation): BookmarkOperation[] => {
    if (operation.type === 'create_folder') {
      if (operation.temporaryId === plan.mergeRoot?.temporaryId) {
        return [{ ...operation, title: mergeRootTitle! }]
      }
      if (removed.has(operation.temporaryId)) return []
      return [{ ...operation, title: pathById.get(operation.temporaryId)?.at(-1) ?? operation.title }]
    }
    if (operation.type === 'move_folder') return [operation]
    if (operation.type === 'rename_folder') {
      if (removed.has(operation.folderId)) return []
      return [{ ...operation, newTitle: pathById.get(operation.folderId)?.at(-1) ?? operation.newTitle }]
    }
    // 标题改写与目录结构无关，原样带过
    if (operation.type === 'rename_bookmark') return [operation]
    const target = retarget.get(operation.bookmarkId) ?? null
    if (target === null) return []
    return [{
      ...operation,
      toCategoryId: target,
      // 目标若不是本批新建的目录（例如复用的真实目录），toTemporaryId 必须是 null
      toTemporaryId: survivingTempIds.has(target) && target.startsWith('tmp:') ? target : null,
    }]
  })

  const prefix = mergeRootTitle === null ? [] : [mergeRootTitle]
  // resolve() 找不到回落点时（删掉的目录没有兜底目录可去）这条书签不再进 rows，
  // 但「rows 与 unchanged 互斥且完备」这条不变式出了 buildPlan 也必须成立——
  // 不能像早先那样直接丢弃，得给它在 unchanged 里补一个位置，否则复核页上这条书签
  // 会一个字都不出现（见 issues/05「决定 3」，正是这一轮要消灭的状态）。
  const orphaned: UnchangedRow[] = []
  const rows: PlanRow[] = plan.rows.flatMap((row) => {
    const target = retarget.get(row.bookmarkId) ?? null
    if (target === null) {
      orphaned.push({
        bookmarkId: row.bookmarkId, title: row.title, url: row.url, currentPath: row.fromPath,
        kind: 'noTarget', reason: noFallbackReason(locale),
      })
      return []
    }
    const path = pathById.get(target)
    return [{
      ...row,
      toPath: path === undefined ? row.toPath : [...prefix, ...path],
      toCategoryId: target,
    }]
  })
  const unchanged = orphaned.length === 0 ? plan.unchanged : [...plan.unchanged, ...orphaned]

  const next: OrganizePlan = {
    ...plan, candidates, operations, rows, unchanged,
    mergeRoot: plan.mergeRoot === null ? null : { ...plan.mergeRoot, title: mergeRootTitle! },
  }
  return {
    ...next,
    summary: summarize(next, new Set(rows.map((r) => r.bookmarkId)), plan.summary.totalBookmarks),
  }
}
