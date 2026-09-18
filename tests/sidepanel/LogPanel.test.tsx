import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LogPanel } from '@/sidepanel/components/LogPanel'
import type { LogLine } from '@/sidepanel/store'

const logs: LogLine[] = [
  { id: 1, phase: 'tags', level: 'info', message: '正在提取标签…' },
  { id: 2, phase: 'classify', level: 'warn', message: '第 2 批稍慢，继续等待' },
]

describe('LogPanel', () => {
  it('空闲时仍显示右侧日志面板和等待提示', () => {
    render(<LogPanel status={null} busy={null} progress={null} logs={[]} />)

    expect(screen.getByTestId('tab-llm-log')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'LLM 日志' })).toBeDefined()
    expect(screen.getAllByText('等待 AI 分析开始…')).toHaveLength(2)
  })

  it('日志面板默认展示全部调用日志', () => {
    render(<LogPanel status="running" busy="正在分析…" progress={{ phase: 'classify', done: 12, total: 30 }} logs={logs} />)

    expect(screen.getByText('正在提取标签…')).toBeDefined()
    expect(screen.getByText('第 2 批稍慢，继续等待')).toBeDefined()
    expect(screen.getByTestId('llm-log-progress').textContent).toContain('分类12/30')
  })

  it('顶栏副标题显示当前阶段与计数', () => {
    render(
      <LogPanel
        status="running"
        busy="正在分析…"
        progress={{ phase: 'tags', done: 120, total: 210 }}
        logs={[{ id: 1, phase: 'tags', level: 'info', message: '标签批次 3/5' }]}
      />,
    )

    expect(screen.getByTestId('llm-log-stage').textContent).toMatch(/抽取标签.*120\/210/)
    expect(screen.getByTestId('llm-log-progress').textContent).toMatch(/抽取标签.*120\/210/)
  })

  it('无计数阶段时顶栏只显示阶段名，不挂上一阶段的数字', () => {
    render(
      <LogPanel
        status="running"
        busy="正在分析…"
        progress={{ phase: 'tree' }}
        logs={[
          { id: 1, phase: 'tags', level: 'info', message: '标签批次完成' },
          { id: 2, phase: 'tree', level: 'info', message: '开始设计目录' },
        ]}
      />,
    )

    expect(screen.getByTestId('llm-log-stage').textContent).toBe('设计目录')
    expect(screen.getByTestId('llm-log-progress').textContent).toBe('设计目录')
    expect(screen.getByTestId('llm-log-progress').textContent).not.toMatch(/\d+\/\d+/)
  })

  it('日志按阶段分组，行内不再重复阶段前缀', () => {
    render(
      <LogPanel
        status="running"
        busy="正在分析…"
        progress={{ phase: 'tree' }}
        logs={[
          { id: 1, phase: 'tags', level: 'info', message: '标签批次完成' },
          { id: 2, phase: 'tree', level: 'info', message: '开始设计目录' },
          { id: 3, phase: 'tree', level: 'info', message: '目录设计完成' },
        ]}
      />,
    )

    const sections = screen.getAllByTestId('llm-log-phase')
    expect(sections).toHaveLength(2)
    expect(sections[0]!.textContent).toBe('抽取标签')
    expect(sections[1]!.textContent).toBe('设计目录')
    expect(screen.queryByText(/\[抽取标签\]/)).toBeNull()
    expect(screen.queryByText(/\[设计目录\]/)).toBeNull()
    expect(screen.getByText('标签批次完成')).toBeDefined()
    expect(screen.getByText('开始设计目录')).toBeDefined()
  })

  it('超长错误默认只展示摘要，原文可展开查看', () => {
    const message = `分类批次 1/7 失败：${'{"results":' + 'x'.repeat(600) + '}'}`
    render(
      <LogPanel
        status="failed"
        busy={null}
        progress={null}
        logs={[{ id: 3, phase: 'classify', level: 'error', message }]}
      />,
    )

    const details = screen.getByText('查看原始错误').closest('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    expect(within(details!).getByText(message)).toBeDefined()
  })

  it('任务可取消时显示取消按钮', async () => {
    const onCancel = vi.fn()
    render(<LogPanel status="running" busy="正在分析…" progress={null} logs={logs} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('新增日志时自动滚动到底部', () => {
    const { rerender } = render(
      <LogPanel status="running" busy="正在分析…" progress={null} logs={logs} />,
    )
    const scrollArea = screen.getByTestId('llm-log-scroll')
    let scrollHeight = 600
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    })

    rerender(
      <LogPanel
        status="running"
        busy="正在分析…"
        progress={null}
        logs={[...logs, { id: 3, phase: 'tags', level: 'info', message: '继续提取…' }]}
      />,
    )

    expect(scrollArea.scrollTop).toBe(400)
  })

  it('用户上翻查看历史时不被新日志拉回底部', () => {
    const { rerender } = render(
      <LogPanel status="running" busy="正在分析…" progress={null} logs={logs} />,
    )
    const scrollArea = screen.getByTestId('llm-log-scroll')
    let scrollHeight = 600
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    })
    scrollArea.scrollTop = 100
    fireEvent.scroll(scrollArea)

    rerender(
      <LogPanel
        status="running"
        busy="正在分析…"
        progress={null}
        logs={[...logs, { id: 3, phase: 'tags', level: 'info', message: '继续提取…' }]}
      />,
    )

    expect(scrollArea.scrollTop).toBe(100)
  })
})
