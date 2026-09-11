import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferStep } from '@/sidepanel/steps/TransferStep'
import { useStore } from '@/sidepanel/store'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
          { id: '100', title: 'hooks', children: [
            { id: '1000', title: '更深一层', children: [] },
          ]},
          { id: '101', title: 'A', url: 'https://a.dev' },
          { id: '102', title: 'B', url: 'https://b.dev' },
      ]},
      { id: '11', title: '工作常用', children: [] },
    ]},
  ]},
]

beforeEach(() => {
  useStore.setState({
    tree, checkedIds: new Set(), busy: null, error: null,
    importFile: null, importError: null, importDone: null,
    moveSelection: new Set(),
  })
})

describe('TransferStep', () => {
  it('是独立页：有目录树和导入导出，没有扫描、也没有整理步骤文案', () => {
    render(<TransferStep />)
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.getByRole('button', { name: '导出' })).toBeDefined()
    expect(screen.getByRole('button', { name: '导入' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /扫描选中的/ })).toBeNull()
    expect(screen.queryByText(/勾选你想让 Reshelve 重构的文件夹/)).toBeNull()
  })

  it('默认收起导出和导入面板，点击导出后才出现导出选项框，再次点击收起', async () => {
    render(<TransferStep />)
    expect(screen.queryByRole('button', { name: '带文件夹结构' })).toBeNull()
    expect(screen.queryByRole('button', { name: '纯链接清单' })).toBeNull()
    expect(screen.queryByRole('button', { name: '浏览器书签文件' })).toBeNull()
    expect(screen.queryByText('选择文件…')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toBeDefined()
    expect(screen.getByRole('button', { name: '纯链接清单' })).toBeDefined()
    expect(screen.getByRole('button', { name: '浏览器书签文件' })).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.queryByRole('button', { name: '带文件夹结构' })).toBeNull()
  })

  it('点导入后展开文件选择，再次点击收起', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(screen.getByText('选择文件…')).toBeDefined()
    expect(screen.queryByRole('button', { name: '带文件夹结构' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(screen.queryByText('选择文件…')).toBeNull()
  })

  it('导出和导入互斥，只展开一边', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(screen.getByText('选择文件…')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toBeDefined()
    expect(screen.queryByText('选择文件…')).toBeNull()
  })
  it('已有导入预览时进页自动展开导入，避免确认界面被收掉', () => {
    useStore.setState({ importError: '这个文件不是有效的 JSON。' })
    render(<TransferStep />)
    expect(screen.getByText('这个文件不是有效的 JSON。')).toBeDefined()
    expect(screen.getByText('重新选择')).toBeDefined()
  })

  it('勾选仍连带子目录，和整理范围共用同一批勾选', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'react' }))
    expect([...useStore.getState().checkedIds].sort()).toEqual(['10', '100', '1000'])
  })

  it('全部展开后按钮变成全部收起，再点则全部收起', async () => {
    render(<TransferStep />)
    expect(screen.getByRole('button', { name: '全部展开' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '全部收起' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '全部展开' }))
    expect(screen.getByText('更深一层')).toBeDefined()
    expect(screen.queryByRole('button', { name: '全部展开' })).toBeNull()
    expect(screen.getByRole('button', { name: '全部收起' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '全部收起' }))
    expect(screen.queryByText('react')).toBeNull()
    expect(screen.getByRole('button', { name: '全部展开' })).toBeTruthy()
  })
  it('搜索书签标题、URL并保留祖先层级', async () => {
    render(<TransferStep />)
    const input = screen.getByRole('searchbox', { name: '搜索书签' })

    await userEvent.type(input, 'a.dev')
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.getByText('react')).toBeDefined()
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.getByText('https://a.dev')).toBeDefined()
  })

  it('浏览模式展开文件夹也显示其中的书签，可直接勾选用于移动', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 react' }))
    expect(screen.getByRole('link', { name: 'A' }).getAttribute('href')).toBe('https://a.dev')
    expect(screen.getByText('https://b.dev')).toBeDefined()

    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))
    expect(screen.getByText('已选中 1 条书签')).toBeDefined()
  })

  it('搜索时自动展开命中路径，清空后恢复搜索前的展开状态', async () => {
    render(<TransferStep />)
    const react = screen.getByText('react')
    expect(screen.queryByText('A')).toBeNull()

    const input = screen.getByRole('searchbox', { name: '搜索书签' })
    await userEvent.type(input, 'a.dev')
    expect(screen.getByText('A')).toBeDefined()

    await userEvent.clear(input)
    expect(screen.queryByText('A')).toBeNull()
    expect(react).toBeDefined()
  })

  it('无匹配时显示提示，匹配结果不清理现有勾选', async () => {
    useStore.setState({ checkedIds: new Set(['10']) })
    render(<TransferStep />)
    const input = screen.getByRole('searchbox', { name: '搜索书签' })

    await userEvent.type(input, 'a.dev')
    expect(screen.getByText('A')).toBeDefined()
    expect((screen.getByRole('checkbox', { name: 'react' }) as HTMLInputElement).checked).toBe(true)

    await userEvent.clear(input)
    await userEvent.type(input, 'does-not-exist')
    expect(screen.getByText('没有找到相关书签')).toBeDefined()
  })

  it('选中书签后先出现移动按钮，点击按钮才展开文件夹选择器', async () => {
    render(<TransferStep />)
    const input = screen.getByRole('searchbox', { name: '搜索书签' })
    await userEvent.type(input, '.dev')
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 B' }))

    // 选中后只出现移动按钮，文件夹选择器不直接弹出
    expect(screen.getByText('已选中 2 条书签')).toBeDefined()
    expect(screen.queryByRole('radiogroup', { name: '移动到文件夹' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /移动选中书签/ }))
    expect(screen.getByRole('radiogroup', { name: '移动到文件夹' })).toBeDefined()
    expect((screen.getByRole('button', { name: '确认移动' }) as HTMLButtonElement).disabled).toBe(true)

    // 点击工作常用文件夹选中目标
    await userEvent.click(screen.getByText('工作常用'))
    expect((screen.getByRole('button', { name: '确认移动' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('再点移动按钮收起面板；取消全部勾选后按钮消失，重新勾选不自动展开', async () => {
    render(<TransferStep />)
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索书签' }), '.dev')
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))

    await userEvent.click(screen.getByRole('button', { name: /移动选中书签/ }))
    expect(screen.getByRole('radiogroup', { name: '移动到文件夹' })).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: /移动选中书签/ }))
    expect(screen.queryByRole('radiogroup', { name: '移动到文件夹' })).toBeNull()

    // 取消勾选后按钮消失；重新勾选时面板不自动展开
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))
    expect(screen.queryByRole('button', { name: /移动选中书签/ })).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))
    expect(screen.getByRole('button', { name: /移动选中书签/ })).toBeDefined()
    expect(screen.queryByRole('radiogroup', { name: '移动到文件夹' })).toBeNull()
  })

  it('切换到新建文件夹时显示名称和父目录树选择器', async () => {
    render(<TransferStep />)
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索书签' }), '.dev')
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))
    await userEvent.click(screen.getByRole('button', { name: /移动选中书签/ }))
    await userEvent.click(screen.getByRole('button', { name: '新建文件夹' }))

    expect(screen.getByRole('textbox', { name: '新文件夹名称' })).toBeDefined()
    expect(screen.getByRole('radiogroup', { name: '新文件夹放在' })).toBeDefined()
    expect((screen.getByRole('button', { name: '确认移动' }) as HTMLButtonElement).disabled).toBe(true)

    // 输入新文件夹名称后可确认移动
    await userEvent.type(screen.getByRole('textbox', { name: '新文件夹名称' }), '新分组')
    expect((screen.getByRole('button', { name: '确认移动' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
