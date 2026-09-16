import { describe, expect, it } from 'vitest'
import {
  createChildFolder,
  isImmutableFolder,
  removeTreeNode,
  updateTreeNode,
} from '@/engine/editNodes'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import type { BookmarkNode } from '@/core/ports'

function setup() {
  const bookmarks = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '来源', children: [
          { id: '100', title: 'A', url: 'https://a.dev' },
          { id: '12', title: '子夹', children: [
            { id: '120', title: 'C', url: 'https://c.dev' },
          ]},
        ]},
        { id: '11', title: '空夹', children: [] },
      ]},
      { id: '2', title: '其他书签', children: [] },
    ]},
  ])
  return { bookmarks, ports: { bookmarks: bookmarks.api, storage: createFakeStorage() } }
}

describe('isImmutableFolder', () => {
  it('marks Chrome permanent roots (parentId 0) as immutable', () => {
    const bar: BookmarkNode = { id: '1', parentId: '0', title: '书签栏' }
    const normal: BookmarkNode = { id: '10', parentId: '1', title: '来源' }
    expect(isImmutableFolder(bar)).toBe(true)
    expect(isImmutableFolder(normal)).toBe(false)
    expect(isImmutableFolder({ id: '100', parentId: '10', title: 'A', url: 'https://a.dev' })).toBe(false)
  })
})

describe('updateTreeNode', () => {
  it('renames a normal folder', async () => {
    const { bookmarks, ports } = setup()
    const updated = await updateTreeNode(ports, '10', { title: '归档' })
    expect(updated.title).toBe('归档')
    expect(bookmarks.structure()).toContain('书签栏/归档/')
  })

  it('updates bookmark title and url', async () => {
    const { bookmarks, ports } = setup()
    const updated = await updateTreeNode(ports, '100', { title: 'Alpha', url: 'https://alpha.dev/' })
    expect(updated).toMatchObject({ title: 'Alpha', url: 'https://alpha.dev/' })
    expect(bookmarks.structure()).toContain('书签栏/来源/Alpha')
  })

  it('rejects renaming permanent roots', async () => {
    const { ports } = setup()
    await expect(updateTreeNode(ports, '1', { title: '改名' })).rejects.toThrow('immutableFolder')
  })

  it('rejects empty title and invalid url', async () => {
    const { ports } = setup()
    await expect(updateTreeNode(ports, '10', { title: '  ' })).rejects.toThrow('emptyTitle')
    await expect(updateTreeNode(ports, '100', { url: 'not-a-url' })).rejects.toThrow('invalidUrl')
  })
})

describe('removeTreeNode', () => {
  it('removes a bookmark', async () => {
    const { bookmarks, ports } = setup()
    await removeTreeNode(ports, '100')
    expect(bookmarks.structure()).not.toContain('A')
  })

  it('removes a non-empty folder and its descendants', async () => {
    const { bookmarks, ports } = setup()
    await removeTreeNode(ports, '10')
    expect(bookmarks.structure()).not.toContain('来源')
    expect(bookmarks.structure()).not.toContain('子夹')
    expect(bookmarks.structure()).not.toContain('C')
  })

  it('rejects deleting permanent roots', async () => {
    const { ports } = setup()
    await expect(removeTreeNode(ports, '1')).rejects.toThrow('immutableFolder')
  })
})

describe('createChildFolder', () => {
  it('creates a subfolder under the chosen parent', async () => {
    const { bookmarks, ports } = setup()
    const created = await createChildFolder(ports, '10', '新建文件夹')
    expect(created.title).toBe('新建文件夹')
    expect(created.parentId).toBe('10')
    expect(bookmarks.structure()).toContain('书签栏/来源/新建文件夹/')
  })

  it('allows creating under a permanent root', async () => {
    const { bookmarks, ports } = setup()
    const created = await createChildFolder(ports, '1', '专题')
    expect(created.parentId).toBe('1')
    expect(bookmarks.structure()).toContain('书签栏/专题/')
  })

  it('rejects creating under a bookmark', async () => {
    const { ports } = setup()
    await expect(createChildFolder(ports, '100', 'x')).rejects.toThrow('notFolder')
  })
})
