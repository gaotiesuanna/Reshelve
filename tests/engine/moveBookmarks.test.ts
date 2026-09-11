import { describe, expect, it } from 'vitest'
import { moveBookmarks, type MoveBookmarksInput } from '@/engine/moveBookmarks'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'

function setup() {
  const bookmarks = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '来源', children: [
          { id: '100', title: 'A', url: 'https://a.dev' },
          { id: '101', title: 'B', url: 'https://b.dev' },
        ]},
        { id: '11', title: '归档', children: [] },
      ]},
    ]},
  ])
  return { bookmarks, ports: { bookmarks: bookmarks.api, storage: createFakeStorage() } }
}

function input(overrides: Partial<MoveBookmarksInput> = {}): MoveBookmarksInput {
  return { bookmarkIds: ['100', '101'], destination: { kind: 'existing', folderId: '11' }, ...overrides }
}

describe('moveBookmarks', () => {
  it('moves selected bookmarks to an existing folder in selection order', async () => {
    const { bookmarks, ports } = setup()

    const result = await moveBookmarks(ports, input())

    expect(result).toEqual({ moved: 2, targetFolderId: '11', createdFolder: false })
    expect(bookmarks.structure()).toContain('书签栏/归档/A')
    expect(bookmarks.structure()).toContain('书签栏/归档/B')
    expect(bookmarks.structure()).toContain('书签栏/来源')
  })

  it('creates a folder under the chosen parent before moving selected bookmarks', async () => {
    const { bookmarks, ports } = setup()

    const result = await moveBookmarks(ports, input({
      destination: { kind: 'new', parentId: '11', title: '稍后阅读' },
    }))

    expect(result.moved).toBe(2)
    expect(result.createdFolder).toBe(true)
    expect(bookmarks.structure()).toContain('书签栏/归档/稍后阅读/A')
    expect(bookmarks.structure()).toContain('书签栏/归档/稍后阅读/B')
  })

  it('does not leave an empty new folder when a selected bookmark disappeared', async () => {
    const { bookmarks, ports } = setup()
    await bookmarks.api.remove('101')

    await expect(moveBookmarks(ports, input({
      destination: { kind: 'new', parentId: '11', title: '不应留下' },
    }))).rejects.toThrow('missingBookmark')

    expect(bookmarks.structure()).not.toContain('不应留下')
  })

  it('rolls back already moved bookmarks and removes a new folder when a later move fails', async () => {
    const { bookmarks, ports } = setup()
    const move = bookmarks.api.move.bind(bookmarks.api)
    bookmarks.api.move = async (id, destination) => {
      if (id === '101' && destination.parentId !== '10') throw new Error('目标暂时不可用')
      return move(id, destination)
    }

    await expect(moveBookmarks(ports, input({
      destination: { kind: 'new', parentId: '11', title: '失败后清理' },
    }))).rejects.toThrow('目标暂时不可用')

    expect(bookmarks.structure()).toContain('书签栏/来源/A')
    expect(bookmarks.structure()).toContain('书签栏/来源/B')
    expect(bookmarks.structure()).not.toContain('失败后清理')
  })
})
