import type { BookmarkNode, Ports } from '@/core/ports'

export type MoveBookmarksDestination =
  | { kind: 'existing'; folderId: string }
  | { kind: 'new'; parentId: string; title: string }

export interface MoveBookmarksInput {
  /** 要移动的节点：书签或文件夹均可。 */
  nodeIds: string[]
  destination: MoveBookmarksDestination
}

export interface MoveBookmarksResult {
  moved: number
  targetFolderId: string
  createdFolder: boolean
}

export type MoveBookmarksErrorCode =
  | 'emptySelection'
  | 'missingBookmark'
  | 'missingTarget'
  | 'emptyFolderName'
  | 'missingParent'
  | 'invalidTarget'

export class MoveBookmarksError extends Error {
  constructor(public readonly code: MoveBookmarksErrorCode) {
    super(code)
    this.name = 'MoveBookmarksError'
  }
}

/**
 * 从方框勾选的文件夹与圆点勾选的书签里，收成真正要移动的顶层节点：
 * - 文件夹只留父级没被勾上的顶层夹（子夹跟着整夹走，不必再搬一次）
 * - 书签若已落在某个待搬文件夹下，就跳过
 */
export function collectMoveNodeIds(
  tree: BookmarkNode[],
  checkedFolderIds: ReadonlySet<string>,
  selectedBookmarkIds: ReadonlySet<string>,
): string[] {
  const parentById = new Map<string, string | undefined>()
  const folderIds = new Set<string>()

  function walk(node: BookmarkNode, parentId?: string): void {
    parentById.set(node.id, parentId)
    if (node.url === undefined) {
      folderIds.add(node.id)
      for (const child of node.children ?? []) walk(child, node.id)
      return
    }
  }

  for (const node of tree) walk(node)

  const topFolders: string[] = []
  for (const id of checkedFolderIds) {
    if (!folderIds.has(id)) continue
    let ancestor = parentById.get(id)
    let covered = false
    while (ancestor !== undefined) {
      if (checkedFolderIds.has(ancestor) && folderIds.has(ancestor)) {
        covered = true
        break
      }
      ancestor = parentById.get(ancestor)
    }
    if (!covered) topFolders.push(id)
  }

  const coveredByFolder = new Set<string>()
  function markDescendants(node: BookmarkNode): void {
    coveredByFolder.add(node.id)
    for (const child of node.children ?? []) markDescendants(child)
  }
  function findAndMark(nodes: BookmarkNode[], id: string): boolean {
    for (const node of nodes) {
      if (node.id === id) {
        markDescendants(node)
        return true
      }
      if (node.children && findAndMark(node.children, id)) return true
    }
    return false
  }
  for (const id of topFolders) findAndMark(tree, id)

  const bookmarks: string[] = []
  for (const id of selectedBookmarkIds) {
    if (coveredByFolder.has(id)) continue
    if (folderIds.has(id)) continue
    bookmarks.push(id)
  }

  return [...topFolders, ...bookmarks]
}

function isUnderOrSelf(
  tree: BookmarkNode[],
  ancestorId: string,
  candidateId: string,
): boolean {
  if (ancestorId === candidateId) return true
  function find(nodes: BookmarkNode[]): BookmarkNode | null {
    for (const node of nodes) {
      if (node.id === ancestorId) return node
      if (node.children) {
        const found = find(node.children)
        if (found) return found
      }
    }
    return null
  }
  const root = find(tree)
  if (root === null) return false
  function contains(node: BookmarkNode): boolean {
    if (node.id === candidateId) return true
    return (node.children ?? []).some(contains)
  }
  return contains(root)
}

/** 移动用户选中的书签或文件夹；目标可以是已有目录，也可以是新建目录。 */
export async function moveBookmarks(
  ports: Ports,
  input: MoveBookmarksInput,
): Promise<MoveBookmarksResult> {
  const ids = [...new Set(input.nodeIds)]
  if (ids.length === 0) throw new MoveBookmarksError('emptySelection')

  const selected = await Promise.all(ids.map((id) => ports.bookmarks.get(id)))
  const originalNodes = selected.filter((node): node is BookmarkNode => node !== null)
  if (originalNodes.length !== ids.length) {
    throw new MoveBookmarksError('missingBookmark')
  }

  let targetFolderId: string
  let createdFolder = false
  if (input.destination.kind === 'existing') {
    const target = await ports.bookmarks.get(input.destination.folderId)
    if (target === null || target.url !== undefined) throw new MoveBookmarksError('missingTarget')
    targetFolderId = target.id
  } else {
    const title = input.destination.title.trim()
    if (title === '') throw new MoveBookmarksError('emptyFolderName')
    const parent = await ports.bookmarks.get(input.destination.parentId)
    if (parent === null || parent.url !== undefined) throw new MoveBookmarksError('missingParent')
    const created = await ports.bookmarks.create({ parentId: parent.id, title })
    targetFolderId = created.id
    createdFolder = true
  }

  const tree = await ports.bookmarks.getTree()
  for (const node of originalNodes) {
    if (node.url !== undefined) continue
    if (isUnderOrSelf(tree, node.id, targetFolderId)) {
      if (createdFolder) await ports.bookmarks.remove(targetFolderId).catch(() => {})
      throw new MoveBookmarksError('invalidTarget')
    }
  }

  const toMove = originalNodes.filter((node) => node.parentId !== targetFolderId)
  const moved: BookmarkNode[] = []
  try {
    for (const node of toMove) {
      await ports.bookmarks.move(node.id, { parentId: targetFolderId })
      moved.push(node)
    }
  } catch (error) {
    // chrome.bookmarks.move 没有事务；按每个原父目录的原始顺序归位，避免一次失败留下半截移动。
    const byParent = new Map<string, BookmarkNode[]>()
    for (const node of moved) {
      if (node.parentId === undefined) continue
      const group = byParent.get(node.parentId) ?? []
      group.push(node)
      byParent.set(node.parentId, group)
    }
    for (const group of byParent.values()) {
      group.sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
      for (const node of group) {
        await ports.bookmarks.move(node.id, {
          parentId: node.parentId,
          ...(node.index === undefined ? {} : { index: node.index }),
        }).catch(() => {})
      }
    }
    if (createdFolder) await ports.bookmarks.remove(targetFolderId).catch(() => {})
    throw error
  }
  return { moved: toMove.length, targetFolderId, createdFolder }
}
