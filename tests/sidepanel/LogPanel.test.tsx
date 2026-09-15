import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
