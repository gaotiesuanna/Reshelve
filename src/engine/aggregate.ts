import type { Locale } from '@/core/locale'
import type { BookmarkNode, Ports } from '@/core/ports'
import type { SkipRecord } from './apply'
import {
  msgAggregateFolderCreateFailed,
  msgAggregateFolderNameRequired,
  msgAggregateTargetUnavailable,
  msgCleanupBookmarkGone,
  msgCleanupMoveFailed,
} from './messages'
import {
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  type BookmarkSnapshot,
  type SnapshotNode,
} from './snapshot'

export type AggregateDestination =
  | { kind: 'existing'; folderId: string }
  | { kind: 'path'; segments: string[] }

export interface AggregateInput {
  planId: string
  bookmarkIds: string[]
  destination: AggregateDestination
  folderTitle: string
}

export interface AggregateResult {
  status: 'completed' | 'failed'
  moved: number
  alreadyInTarget: number
  targetFolderId: string | null
  folderTitle: string
  createdFolder: boolean
  /** 本轮是否真的改过书签树；false 时不能把旧快照冒充成本轮撤销。 */
  changed: boolean
  skipped: SkipRecord[]
  error: string | null
}

function findNode(nodes: readonly BookmarkNode[], id: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children ?? [], id)
    if (child !== null) return child
  }
  return null
}

interface PreparedDestination {
  /** 已经存在的最深一级；missingTitles 从它下面开始创建。 */
  parent: BookmarkNode
  missingTitles: string[]
}

function prepareDestination(
  tree: readonly BookmarkNode[],
  destination: AggregateDestination,
): PreparedDestination | null {
  if (destination.kind === 'existing') {
    const parent = findNode(tree, destination.folderId)
    return parent === null || parent.url !== undefined ? null : { parent, missingTitles: [] }
  }

  const segments = destination.segments.map((part) => part.trim()).filter((part) => part !== '')
  if (segments.length === 0) return null
  const roots = tree
    .flatMap((node) => (node.title === '' ? (node.children ?? []) : [node]))
    .filter((node) => node.url === undefined)
  if (roots.length === 0) return null

  const explicitRoot = roots.find((node) => node.title === segments[0])
  let parent = explicitRoot ?? roots[0]!
  let index = explicitRoot === undefined ? 0 : 1
  while (index < segments.length) {
    const title = segments[index]!
    const child = (parent.children ?? []).find(
      (node) => node.url === undefined && node.title === title,
    )
    if (child === undefined) break
    parent = child
    index++
  }
  return { parent, missingTitles: segments.slice(index) }
}

/**
 * 把用户明确选中的书签移动进聚合文件夹。
 *
 * 目标可以是下拉框选中的既有目录，也可以是用户手写的路径。手写路径从第一个
 * Chrome 顶层目录（通常是书签栏）开始；若第一段就是某个顶层目录名，则以那一项
 * 为根。缺失的中间目录按顺序创建，并与聚合文件夹、书签移动共用一份撤销快照。
 */
export async function aggregateBookmarks(
  ports: Ports,
  input: AggregateInput,
  locale: Locale,
  options: { onProgress?: (done: number, total: number) => void; now?: () => number } = {},
): Promise<AggregateResult> {
  const folderTitle = input.folderTitle.trim()
  if (folderTitle === '') {
    return {
      status: 'failed', moved: 0, alreadyInTarget: 0, targetFolderId: null,
      folderTitle, createdFolder: false, changed: false, skipped: [],
      error: msgAggregateFolderNameRequired(locale),
    }
  }

  const tree = await ports.bookmarks.getTree()
  const prepared = prepareDestination(tree, input.destination)
  if (prepared === null) {
    return {
      status: 'failed', moved: 0, alreadyInTarget: 0, targetFolderId: null,
      folderTitle, createdFolder: false, changed: false, skipped: [],
      error: msgAggregateTargetUnavailable(locale),
    }
  }

  const existing = prepared.missingTitles.length === 0
    ? (prepared.parent.children ?? []).find(
      (node) => node.url === undefined && node.title === folderTitle,
    )
    : undefined
  const skipped: SkipRecord[] = []
  const nodes: SnapshotNode[] = []
  let alreadyInTarget = 0
  const uniqueIds = [...new Set(input.bookmarkIds)]
  const currentNodes = await Promise.all(uniqueIds.map((id) => ports.bookmarks.get(id)))
  for (let index = 0; index < uniqueIds.length; index++) {
    const id = uniqueIds[index]!
    const node = currentNodes[index] ?? null
    if (node === null || node.url === undefined || node.parentId === undefined) {
      skipped.push({ bookmarkId: id, reason: msgCleanupBookmarkGone(locale, id) })
      continue
    }
    if (existing !== undefined && node.parentId === existing.id) {
      alreadyInTarget++
      continue
    }
    nodes.push({
      id: node.id,
      parentId: node.parentId,
      index: node.index ?? 0,
      title: node.title,
      url: node.url,
    })
  }

  if (nodes.length === 0) {
    return {
      status: 'completed', moved: 0, alreadyInTarget,
      targetFolderId: existing?.id ?? null, folderTitle,
      createdFolder: false, changed: false, skipped, error: null,
    }
  }

  const snapshot: BookmarkSnapshot = {
    createdAt: options.now?.() ?? Date.now(),
    planId: input.planId,
    scopeRootIds: [prepared.parent.id],
    nodes,
    createdFolderIds: [],
    renamedBookmarkIds: [],
    rootNodes: [],
    deletedBookmarkIds: [],
  }
  const previousSnapshot = await loadSnapshot(ports)
  await saveSnapshot(ports, snapshot)

  const createdFolderIds: string[] = []
  let parentId = prepared.parent.id
  let targetFolderId = existing?.id ?? null
  let createdFolder = false
  try {
    for (const title of prepared.missingTitles) {
      const created = await ports.bookmarks.create({ parentId, title })
      parentId = created.id
      createdFolderIds.push(created.id)
      await saveSnapshot(ports, { ...snapshot, createdFolderIds: [...createdFolderIds] })
    }
    if (targetFolderId === null) {
      const created = await ports.bookmarks.create({ parentId, title: folderTitle })
      targetFolderId = created.id
      createdFolder = true
      createdFolderIds.push(created.id)
      await saveSnapshot(ports, { ...snapshot, createdFolderIds: [...createdFolderIds] })
    }
  } catch (error) {
    for (const id of [...createdFolderIds].reverse()) {
      try {
        await ports.bookmarks.remove(id)
      } catch {
        // 都还没移动书签，创建失败时这些目录应为空；删除失败不掩盖原始错误。
      }
    }
    if (previousSnapshot === null) await clearSnapshot(ports)
    else await saveSnapshot(ports, previousSnapshot)
    return {
      status: 'failed', moved: 0, alreadyInTarget, targetFolderId: null,
      folderTitle, createdFolder: false, changed: false, skipped,
      error: msgAggregateFolderCreateFailed(locale, String(error)),
    }
  }

  let moved = 0
  const onProgress = options.onProgress
  let processed = 0
  onProgress?.(0, nodes.length)
  for (const node of nodes) {
    try {
      if ((await ports.bookmarks.get(node.id)) === null) {
        skipped.push({ bookmarkId: node.id, reason: msgCleanupBookmarkGone(locale, node.id) })
        continue
      }
      await ports.bookmarks.move(node.id, { parentId: targetFolderId })
      moved++
    } catch (error) {
      skipped.push({ bookmarkId: node.id, reason: msgCleanupMoveFailed(locale, String(error)) })
    } finally {
      onProgress?.(++processed, nodes.length)
    }
  }

  const changed = createdFolderIds.length > 0 || moved > 0
  if (!changed) {
    if (previousSnapshot === null) await clearSnapshot(ports)
    else await saveSnapshot(ports, previousSnapshot)
  }
  return {
    status: 'completed', moved, alreadyInTarget, targetFolderId, folderTitle,
    createdFolder, changed, skipped, error: null,
  }
}
