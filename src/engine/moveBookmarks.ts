import type { BookmarkNode, Ports } from '@/core/ports'

export type MoveBookmarksDestination =
  | { kind: 'existing'; folderId: string }
  | { kind: 'new'; parentId: string; title: string }

export interface MoveBookmarksInput {
  bookmarkIds: string[]
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

export class MoveBookmarksError extends Error {
  constructor(public readonly code: MoveBookmarksErrorCode) {
    super(code)
    this.name = 'MoveBookmarksError'
  }
}

/** 只移动用户明确选中的书签；目标可以是已有目录，也可以是新建目录。 */
export async function moveBookmarks(
  ports: Ports,
  input: MoveBookmarksInput,
): Promise<MoveBookmarksResult> {
  const ids = [...new Set(input.bookmarkIds)]
  if (ids.length === 0) throw new MoveBookmarksError('emptySelection')

  const selected = await Promise.all(ids.map((id) => ports.bookmarks.get(id)))
  const originalNodes = selected.filter(
    (node): node is BookmarkNode => node !== null && node.url !== undefined,
  )
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
