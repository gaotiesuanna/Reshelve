import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BookmarkNode } from '@/core/ports'
import { FolderPicker } from '@/sidepanel/components/FolderPicker'

const testTree: BookmarkNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          {
            id: '10',
            title: 'LLMStudy',
            children: [
              {
                id: '100',
                title: '06 Databases & Search',
                children: [
                  { id: '1000', title: 'DBeaver', url: 'https://dbeaver.io' },
                ],
              },
            ],
          },
          {
            id: '11',
            title: 'temp',
            children: [
              { id: '110', title: '02 UI Design', children: [] },
              { id: '111', title: 'Article', url: 'https://example.com' },
            ],
          },
        ],
      },
    ],
  },
]

describe('FolderPicker', () => {
  it('只显示文件夹，不显示书签网页链接', () => {
    render(<FolderPicker tree={testTree} selectedId="" onSelect={vi.fn()} />)

    expect(screen.getByText('Bookmarks Bar')).toBeDefined()
    expect(screen.getByText('LLMStudy')).toBeDefined()
    expect(screen.getByText('temp')).toBeDefined()
    expect(screen.queryByText('DBeaver')).toBeNull()
    expect(screen.queryByText('Article')).toBeNull()
  })

  it('展示各文件夹下的书签数量', () => {
    render(<FolderPicker tree={testTree} selectedId="" onSelect={vi.fn()} />)

    // Bookmarks Bar 下有 2 个书签 (DBeaver + Article)
    expect(screen.getByText('2')).toBeDefined()
  })

  it('点击文件夹行或单选框触发 onSelect', async () => {
    const onSelect = vi.fn()
    render(<FolderPicker tree={testTree} selectedId="10" onSelect={onSelect} />)

    await userEvent.click(screen.getByText('temp'))
    expect(onSelect).toHaveBeenCalledWith('11')

    const radio = screen.getByRole('radio', { name: '选择文件夹 LLMStudy' })
    expect((radio as HTMLInputElement).checked).toBe(true)
  })

  it('展示当前已选文件夹的面包屑完整路径', () => {
    render(<FolderPicker tree={testTree} selectedId="100" onSelect={vi.fn()} />)

    expect(
      screen.getByText('已选：Bookmarks Bar / LLMStudy / 06 Databases & Search'),
    ).toBeDefined()
  })
  it('支持展开和收起子文件夹', async () => {
    render(<FolderPicker tree={testTree} selectedId="" onSelect={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '全部展开' }))
    expect(screen.getByText('06 Databases & Search')).toBeDefined()

    const collapseButton = screen.getByRole('button', { name: '收起 LLMStudy' })
    await userEvent.click(collapseButton)

    expect(screen.queryByText('06 Databases & Search')).toBeNull()

    const expandButton = screen.getByRole('button', { name: '展开 LLMStudy' })
    await userEvent.click(expandButton)

    expect(screen.getByText('06 Databases & Search')).toBeDefined()
  })

  it('全部展开与全部收起按钮功能正常', async () => {
    render(<FolderPicker tree={testTree} selectedId="" onSelect={vi.fn()} />)

    const expandAllBtn = screen.getByRole('button', { name: '全部展开' })
    await userEvent.click(expandAllBtn)

    expect(screen.getByText('LLMStudy')).toBeDefined()
    expect(screen.getByText('06 Databases & Search')).toBeDefined()

    const collapseAllBtn = screen.getByRole('button', { name: '全部收起' })
    await userEvent.click(collapseAllBtn)

    expect(screen.queryByText('LLMStudy')).toBeNull()
    expect(screen.queryByText('temp')).toBeNull()
  })

  it('按关键字搜索过滤，自动展开命中路径，无匹配时展示空提示', async () => {
    render(<FolderPicker tree={testTree} selectedId="" onSelect={vi.fn()} />)

    const searchInput = screen.getByRole('searchbox', { name: '搜索文件夹' })
    await userEvent.type(searchInput, 'Databases')

    expect(screen.getByText('06 Databases & Search')).toBeDefined()
    expect(screen.queryByText('temp')).toBeNull()

    await userEvent.clear(searchInput)
    await userEvent.type(searchInput, 'notfound')

    expect(screen.getByText('没有找到匹配的文件夹')).toBeDefined()
  })
})
