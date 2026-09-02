import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ResultTree } from '@/sidepanel/components/ResultTree'
import type { ResultTreeNode } from '@/core/resultTree'

const nodes: ResultTreeNode[] = [
  {
    id: 'root',
    title: '一个足够长、需要自然换行的根目录标题',
    isNew: false,
    count: 1,
    total: 3,
    children: [
      {
        id: 'child',
        title: '子目录',
        isNew: true,
        count: 2,
        total: 2,
        children: [],
      },
    ],
  },
]

describe('ResultTree', () => {
  it('renders an indexed nested list with stable hierarchy and counts', () => {
    render(<ResultTree nodes={nodes} />)

    const root = screen.getByText('一个足够长、需要自然换行的根目录标题').closest('li')!
    const child = screen.getByText('子目录').closest('li')!

    expect(root.getAttribute('data-index')).toBe('01')
    expect(child.getAttribute('data-index')).toBe('01.01')
    expect(within(root).getByRole('list')).toBeTruthy()
    expect(screen.getByText('新建')).toBeTruthy()
    expect(within(child).getByText('2')).toBeTruthy()
  })

  it('lets three-level outline numbers grow instead of overflowing onto the folder icon', () => {
    const deep: ResultTreeNode[] = [{
      id: 'a',
      title: 'NiceG',
      isNew: false,
      count: 0,
      total: 1,
      children: [{
        id: 'b',
        title: '01 大模型实现',
        isNew: false,
        count: 0,
        total: 1,
        children: [{
          id: 'c',
          title: '01 大模型基础',
          isNew: false,
          count: 1,
          total: 1,
          children: [],
        }],
      }],
    }]
    render(<ResultTree nodes={deep} />)
    const index = screen.getByText('01.01.01.')
    expect(index.className).toMatch(/whitespace-nowrap/)
    expect(index.parentElement?.className).toMatch(/max-content/)
  })

  it('renders nothing for an empty tree', () => {
    const { container } = render(<ResultTree nodes={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
