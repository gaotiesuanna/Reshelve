import type { BookmarkNode, Ports } from '@/core/ports'

export type EditNodesErrorCode =
  | 'missingNode'
  | 'immutableFolder'
  | 'emptyTitle'
  | 'emptyUrl'
  | 'invalidUrl'
  | 'notFolder'
  | 'notBookmark'

export class EditNodesError extends Error {
  constructor(public readonly code: EditNodesErrorCode) {
    super(code)
    this.name = 'EditNodesError'
  }
}

/** Chrome 永久目录：书签栏 / 其他书签 / 移动设备书签（parentId === '0'）。 */
export function isImmutableFolder(node: BookmarkNode): boolean {
  return node.url === undefined && node.parentId === '0'
}

export async function updateTreeNode(
  ports: Ports,
  id: string,
  changes: { title?: string; url?: string },
): Promise<BookmarkNode> {
  const node = await ports.bookmarks.get(id)
  if (node === null) throw new EditNodesError('missingNode')
  if (isImmutableFolder(node)) throw new EditNodesError('immutableFolder')

  const next: { title?: string; url?: string } = {}
  if (changes.title !== undefined) {
    const title = changes.title.trim()
    if (title === '') throw new EditNodesError('emptyTitle')
    next.title = title
  }
  if (changes.url !== undefined) {
    if (node.url === undefined) throw new EditNodesError('notBookmark')
    const url = changes.url.trim()
    if (url === '') throw new EditNodesError('emptyUrl')
    try {
      // eslint-disable-next-line no-new
      new URL(url)
    } catch {
      throw new EditNodesError('invalidUrl')
    }
    next.url = url
  }
  if (next.title === undefined && next.url === undefined) return node
  return ports.bookmarks.update(id, next)
}

export async function removeTreeNode(ports: Ports, id: string): Promise<void> {
  const node = await ports.bookmarks.get(id)
  if (node === null) throw new EditNodesError('missingNode')
  if (isImmutableFolder(node)) throw new EditNodesError('immutableFolder')
  if (node.url !== undefined) {
    await ports.bookmarks.remove(id)
    return
  }
  await ports.bookmarks.removeTree(id)
}

export async function createChildFolder(
  ports: Ports,
  parentId: string,
  title: string,
): Promise<BookmarkNode> {
  const trimmed = title.trim()
  if (trimmed === '') throw new EditNodesError('emptyTitle')
  const parent = await ports.bookmarks.get(parentId)
  if (parent === null) throw new EditNodesError('missingNode')
  if (parent.url !== undefined) throw new EditNodesError('notFolder')
  return ports.bookmarks.create({ parentId: parent.id, title: trimmed })
}
