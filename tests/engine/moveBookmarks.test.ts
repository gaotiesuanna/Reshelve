import { describe, expect, it } from 'vitest'
import {
  collectMoveNodeIds,
  moveBookmarks,
  type MoveBookmarksInput,
} from '@/engine/moveBookmarks'
import type { BookmarkNode } from '@/core/ports'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'

function setup() {
  const bookmarks = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '来源', children: [
          { id: '100', title: 'A', url: 'https://a.dev' },
          { id: '101', title: 'B', url: 'https://b.dev' },
          { id: '12', title: '子夹', children: [
            { id: '120', title: 'C', url: 'https://c.dev' },
          ]},
        ]},
        { id: '11', title: '归档', children: [] },
      ]},
    ]},
  ])
  return { bookmarks, ports: { bookmarks: bookmarks.api, storage: createFakeStorage() } }
}

function input(overrides: Partial<MoveBookmarksInput> = {}): MoveBookmarksInput {
  return { nodeIds: ['100', '101'], destination: { kind: 'existing', folderId: '11' }, ...overrides }
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

  it('moves a whole folder and keeps its nested structure', async () => {
    const { bookmarks, ports } = setup()

    const result = await moveBookmarks(ports, input({ nodeIds: ['10'] }))

    expect(result).toEqual({ moved: 1, targetFolderId: '11', createdFolder: false })
    expect(bookmarks.structure()).toContain('书签栏/归档/来源/A')
    expect(bookmarks.structure()).toContain('书签栏/归档/来源/子夹/C')
    expect(bookmarks.structure()).not.toMatch(/书签栏\/来源/)
  })

  it('rejects moving a folder into itself or one of its descendants', async () => {
    const { ports } = setup()

    await expect(moveBookmarks(ports, input({
      nodeIds: ['10'],
      destination: { kind: 'existing', folderId: '12' },
    }))).rejects.toThrow('invalidTarget')

    await expect(moveBookmarks(ports, input({
      nodeIds: ['10'],
      destination: { kind: 'existing', folderId: '10' },
    }))).rejects.toThrow('invalidTarget')
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

  it('reorders selected sibling folders before the target without changing their parent', async () => {
    const bookmarks = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '7', title: '07 Utilities', children: [] },
          { id: '8', title: '08 团队通讯', children: [
            { id: '80', title: '保留的书签', url: 'https://example.com' },
          ] },
          { id: '9', title: '09 Other', children: [] },
        ] },
      ] },
    ])
    const ports = { bookmarks: bookmarks.api, storage: createFakeStorage() }

    const result = await moveBookmarks(ports, {
      nodeIds: ['8'],
      destination: { kind: 'position', targetId: '7', position: 'before' },
    })

    expect(result).toEqual({ moved: 1, targetFolderId: '1', createdFolder: false })
    expect(bookmarks.structure()).toMatch(
      /书签栏\/08 团队通讯\/[\s\S]*书签栏\/07 Utilities\/[\s\S]*书签栏\/09 Other/,
    )
    expect(bookmarks.structure()).toContain('书签栏/08 团队通讯/保留的书签')
  })

  it('reorders multiple selected siblings after the target while preserving their relative order', async () => {
    const bookmarks = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '7', title: '07', children: [] },
          { id: '8', title: '08', children: [] },
          { id: '9', title: '09', children: [] },
          { id: '10', title: '10', children: [] },
        ] },
      ] },
    ])
    const ports = { bookmarks: bookmarks.api, storage: createFakeStorage() }

    await moveBookmarks(ports, {
      nodeIds: ['7', '8'],
      destination: { kind: 'position', targetId: '9', position: 'after' },
    })

    const lines = bookmarks.structure().split('\n')
    expect(lines.indexOf('/书签栏/09/')).toBeLessThan(lines.indexOf('/书签栏/07/'))
    expect(lines.indexOf('/书签栏/07/')).toBeLessThan(lines.indexOf('/书签栏/08/'))
    expect(lines.indexOf('/书签栏/08/')).toBeLessThan(lines.indexOf('/书签栏/10/'))
  })

  it('rejects sibling reordering when selected nodes have different parents', async () => {
    const { ports } = setup()

    await expect(moveBookmarks(ports, {
      nodeIds: ['100', '12'],
      destination: { kind: 'position', targetId: '11', position: 'before' },
    })).rejects.toThrow('invalidTarget')
  })
})

describe('collectMoveNodeIds', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '来源', children: [
          { id: '100', title: 'A', url: 'https://a.dev' },
          { id: '12', title: '子夹', children: [
            { id: '120', title: 'C', url: 'https://c.dev' },
          ]},
        ]},
        { id: '11', title: '归档', children: [] },
      ]},
    ]},
  ]

  it('takes topmost checked folders and bookmark picks outside them', () => {
    expect(collectMoveNodeIds(tree, new Set(['10', '12']), new Set(['100', '120']))).toEqual(['10'])
    expect(collectMoveNodeIds(tree, new Set(['12']), new Set(['100']))).toEqual(['12', '100'])
    expect(collectMoveNodeIds(tree, new Set(), new Set(['100', '120']))).toEqual(['100', '120'])
  })
})
