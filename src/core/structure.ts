import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import type { FolderMoveSpec, NewFolderSpec, RenameFolderSpec } from './plan'
import { FALLBACK_TITLE, MAX_SIBLINGS } from './tree'
import type {
  CategoryCandidate,
  OrganizePlan,
  TagResult,
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

  const topLevelCount = remaining.filter((candidate) => candidate.path.length === 1).length
    + additions.length
  const warnings = [...draft.warnings]
  if (topLevelCount > MAX_SIBLINGS) {
    warnings.push(locale === 'zh_CN'
      ? `同层目录建议不超过 ${MAX_SIBLINGS} 个；你仍可按当前结构继续。`
      : `Keeping sibling folders to ${MAX_SIBLINGS} or fewer is recommended; you can still continue.`)
  }

  return { errors, warnings }
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

export function buildStructureView(
  draft: StructureDraft, edits: StructureEdits, locale: Locale,
): StructureNode[] {
  const compiled = applyStructureEditsToDraft(draft, edits, locale)
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
