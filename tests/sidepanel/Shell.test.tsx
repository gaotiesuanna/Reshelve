import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from '@/sidepanel/components/Shell'
import { useStore } from '@/sidepanel/store'
import type { StructureDraft } from '@/core/structure'
import type { ScanResult } from '@/core/types'


beforeEach(() => {
  useStore.setState({
    step: 'scope', mode: 'organize', settingsOpen: false, busy: null, busyTask: null,
    error: null, progress: null, logs: [],
  })
})

describe('Shell 设置入口', () => {
  it('默认展示横向步骤条与当前内容，不展示设置页', () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    expect(screen.getByText(/选范围/)).toBeDefined()
    expect(screen.getByText('步骤内容')).toBeDefined()
    expect(screen.queryByTestId('step-sidebar')).toBeNull()
  })

  it('设置用线框返回标题替换整条主导航', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    const banner = screen.getByRole('banner')
    expect(banner.className).toContain('border-index-line')
    expect(within(banner).queryByRole('tablist')).toBeNull()
    expect(within(banner).getByRole('button', { name: '返回' })).toBeDefined()
    expect(within(banner).getByRole('heading', { name: '设置' })).toBeDefined()
  })

  it('点齿轮打开设置页，步骤条与步骤内容都让位', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByText('步骤内容')).toBeNull()
    expect(screen.queryByText(/选范围/)).toBeNull()
    expect(screen.getByRole('heading', { name: '设置' })).toBeDefined()
  })

  it('设置页标题跟返回同一行，不另起一个孤零零的「设置」', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(within(banner).getByRole('button', { name: '返回' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: '设置' })).toHaveLength(1)
  })


  it('点返回回到原来的步骤，步骤内容原样回来', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    await userEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByText('步骤内容')).toBeDefined()
    expect(screen.getByText(/选范围/)).toBeDefined()
  })

  // 分析要跑好几分钟，中途想改设置是常事；关掉设置页后进度必须还在
  it('整理进行中也能开设置，busy 状态不受影响', async () => {
    useStore.setState({ busy: '正在分析…', busyTask: 'analyze' })
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(useStore.getState().busy).toBe('正在分析…')
  })

  // 仓库入口只剩设置标题行右端这一个图标——整块「关于」区是用户要求撤掉的，
  // 别让它回流：设置页正文里不该再出现第二个仓库链接
  it('设置标题行右端有 GitHub 图标链接，指向仓库、新标签页打开', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    const banner = screen.getByRole('banner')
    const link = within(banner).getByRole('link', { name: '源代码' })
    expect(link).toHaveProperty('href', 'https://github.com/gaotiesuanna/Reshelve')
    expect(link).toHaveProperty('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect(screen.getAllByRole('link', { name: '源代码' })).toHaveLength(1)
  })
})

describe('Shell 进度取消', () => {
  it('结构分类进行中显示取消按钮并调用 cancel', async () => {
    const cancel = vi.fn()
    useStore.setState({
      busy: '正在按确认后的结构分类…', busyTask: 'classify_structure', cancel,
    })
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: /取消/ }))

    expect(cancel).toHaveBeenCalled()
  })
})

/** 步骤条只开放当前流程中安全可达的步骤，避免把用户带到缺少数据的空页面。 */
describe('Shell 步骤条', () => {
  it('只有当前步骤带 aria-current', () => {
    useStore.setState({ step: 'review' })
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    expect(screen.getByText(/预览/).getAttribute('aria-current')).toBe('step')
    expect(screen.getByText(/选范围/).getAttribute('aria-current')).toBeNull()
  })

  it('完整呈现包含结构确认在内的五个实际步骤', () => {
    useStore.setState({ step: 'structure' })
    render(<Shell organizeContent={<div>结构编辑器</div>}>{null}</Shell>)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText(/确认结构/).getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('结构编辑器')).toBeDefined()
  })

  it('选好目录后点击偏好会复用扫描动作进入下一步', async () => {
    const goScan = vi.fn()
    useStore.setState({ checkedIds: new Set(['folder-1']), goScan })
    render(<Shell organizeContent={<div>范围编辑器</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: /偏好/ }))

    expect(goScan).toHaveBeenCalledTimes(1)
  })

  it('目录结构页点击偏好会回到偏好，且保留结构草稿', async () => {
    useStore.setState({
      step: 'structure',
      checkedIds: new Set(['folder-1']),
      scan: {} as ScanResult,
      structureDraft: { locale: 'zh_CN' } as StructureDraft,
      busy: null,
    })
    render(<Shell organizeContent={<div>结构编辑器</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: /偏好/ }))

    expect(useStore.getState().step).toBe('preferences')
    expect(useStore.getState().structureDraft).not.toBeNull()
  })

})

/**
 * 出错时用户唯一在看的就是这条红条，不该让他自己去页底找「开始 AI 分析」——
 * 所以可重试的错误得在红条里给出按钮；配置类错误（重试一百次也一样）不该给。
 */
describe('Shell 的错误条', () => {
  it('可重试时给出按钮，点了就重跑', async () => {
    const retry = vi.fn()
    useStore.setState({ error: '后台被中断', retryable: 'analyze', retry, busy: null })
    render(<Shell organizeContent={null}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalled()
  })

  /**
   * 红条讲的是刚才那轮整理出了什么事，跟正在改的设置无关。跟到设置页来只会挡住正文，
   * 「重试」还会在用户正配模型的时候把分析重新拉起来。但也不能顺手清掉：
   * 点返回回到那一步，该看见的还得看见。
   */
  it('设置页里红条让位，返回后原样回来', async () => {
    useStore.setState({ error: '后台被中断', retryable: 'analyze', busy: null })
    render(<Shell organizeContent={null}>{null}</Shell>)
    expect(screen.getByText('后台被中断')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByText('后台被中断')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByText('后台被中断')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('不可重试的错误只显示文字，没有按钮', () => {
    useStore.setState({ error: '请先填 API Key', retryable: null, busy: null })
    render(<Shell organizeContent={null}>{null}</Shell>)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})

/**
 * 四条平行的路，不是一条路上的几步——所以模式切换是并列的 tab 按钮，
 * 不是塞进步骤条里的第五格（那会让前四格点不动、第五格能点，参见 Shell.tsx 的注释）。
 */
describe('Shell 模式切换', () => {
  it('默认停在 AI 整理，四个按钮都在', () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    expect(screen.getByRole('tab', { name: 'AI 整理' }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('tab', { name: '本地清理' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('tab', { name: '浏览书签' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('tab', { name: '统计' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('点本地清理切到清理模式，步骤条随之让位', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}><div>清理内容</div></Shell>)
    await userEvent.click(screen.getByRole('tab', { name: '本地清理' }))
    expect(useStore.getState().mode).toBe('cleanup')
    expect(screen.queryByText(/选范围/)).toBeNull()
    expect(screen.getByText('清理内容')).toBeDefined()
  })

  it('点浏览书签切到浏览模式，步骤条随之让位', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}><div>浏览内容</div></Shell>)
    await userEvent.click(screen.getByRole('tab', { name: '浏览书签' }))
    expect(useStore.getState().mode).toBe('transfer')
    expect(screen.queryByText(/选范围/)).toBeNull()
  })

  it('点看板切到看板模式，步骤条随之让位', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}><div>看板内容</div></Shell>)
    await userEvent.click(screen.getByRole('tab', { name: '统计' }))
    expect(useStore.getState().mode).toBe('dashboard')
    expect(screen.queryByText(/选范围/)).toBeNull()
  })

  it('清理模式下不展示步骤条，但正文照常渲染', () => {
    useStore.setState({ mode: 'cleanup' })
    render(<Shell organizeContent={<div>步骤内容</div>}><div>清理内容</div></Shell>)
    expect(screen.queryByText(/选范围/)).toBeNull()
    expect(screen.getByText('清理内容')).toBeDefined()
  })

  it('浏览书签模式下不展示步骤条，但正文照常渲染', () => {
    useStore.setState({ mode: 'transfer' })
    render(<Shell organizeContent={<div>步骤内容</div>}><div>浏览内容</div></Shell>)
    expect(screen.queryByText(/选范围/)).toBeNull()
    expect(screen.getByText('浏览内容')).toBeDefined()
  })

  it('看板模式下不展示步骤条，但正文照常渲染', () => {
    useStore.setState({ mode: 'dashboard' })
    render(<Shell organizeContent={<div>步骤内容</div>}><div>看板内容</div></Shell>)
    expect(screen.queryByText(/选范围/)).toBeNull()
    expect(screen.getByText('看板内容')).toBeDefined()
  })

  it('标签页不再给本地清理单独设半屏宽度，宽度交给共用书签工作区', () => {
    window.history.pushState({}, '', '/?view=tab&mode=cleanup')
    useStore.setState({ mode: 'cleanup' })
    render(<Shell organizeContent={<div>步骤内容</div>}><div>清理内容</div></Shell>)

    const workspace = screen.getByTestId('tab-cleanup-workspace')
    expect(workspace.className).toContain('w-full')
    expect(workspace.className).not.toContain('lg:w-1/2')
    expect(within(workspace).getByText('清理内容')).toBeDefined()
    window.history.pushState({}, '', '/')
  })

  it('标签页浏览书签也走全宽工作区容器，宽度交给共用书签工作区', () => {
    window.history.pushState({}, '', '/?view=tab&mode=transfer')
    useStore.setState({ mode: 'transfer' })
    render(<Shell organizeContent={<div>步骤内容</div>}><div>浏览内容</div></Shell>)

    const workspace = screen.getByTestId('tab-transfer-workspace')
    expect(workspace.className).toContain('w-full')
    expect(workspace.className).not.toContain('lg:w-1/2')
    expect(within(workspace).getByText('浏览内容')).toBeDefined()
    window.history.pushState({}, '', '/')
  })

  // busy 是单槽，切过去也什么都干不了，还会让人以为切换失灵，所以忙的时候禁用
  it('忙的时候四个模式按钮都禁用', () => {
    useStore.setState({ busy: '正在分析…', busyTask: 'analyze' })
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    expect((screen.getByRole('tab', { name: 'AI 整理' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('tab', { name: '本地清理' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('tab', { name: '浏览书签' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('tab', { name: '统计' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('设置页打开时模式按钮不显示——那时整个正文是设置', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByRole('tab', { name: 'AI 整理' })).toBeNull()
  })

  // 齿轮和返回同占头部右/左两端，设置页里齿轮点了没反应——留着只会让人怀疑自己没点中
  it('设置页里齿轮收起来，只剩返回', async () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
  })
})

/**
 * 侧栏一直挤着右侧页面，齿轮左边的这颗按钮是逃出口：把同一个界面
 * 换成完整标签页。已经是标签页形态时它必须收起——再点只会多开一份。
 */
describe('Shell 换成完整标签页', () => {
  const sendMessage = vi.fn((_message: unknown) => Promise.resolve({ ok: true, kind: 'open_app_tab' }))

  beforeEach(() => {
    sendMessage.mockClear()
    window.history.pushState({}, '', '/')
    // jsdom 环境没有 chrome 类型；setup 已把 i18n 桩挂上，这里只补 runtime.sendMessage。
    const globals = globalThis as unknown as { chrome: Record<string, unknown> }
    globals.chrome.runtime = { sendMessage }
  })

  it('侧栏形态下齿轮左边有「在完整标签页中打开」', () => {
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    expect(screen.getByRole('button', { name: '在完整标签页中打开' })).toBeDefined()
  })

  it('点击把当前模式、步骤和勾选带给后台，由后台开标签页并关掉侧栏', async () => {
    useStore.setState({ mode: 'organize', step: 'preferences', checkedIds: new Set(['1', '10']) })
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '在完整标签页中打开' }))
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'open_app_tab',
        mode: 'organize',
        step: 'preferences',
        checkedIds: ['1', '10'],
      }),
    )
  })

  it('标签页形态（view=tab）下按钮收起', () => {
    window.history.pushState({}, '', '/?view=tab&mode=dashboard')
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    expect(screen.queryByRole('button', { name: '在完整标签页中打开' })).toBeNull()
    // 导航其余部分照常：按钮只是收起，不是整条索引栏让位
    expect(screen.getByRole('tab', { name: 'AI 整理' })).toBeDefined()
  })

  // 完整页面不再模拟放大的侧栏：它使用全宽工作区，并把品牌、一级模式导航
  // 与设置收进同一条 headerline。
  it('标签页形态使用全宽工作区和品牌 headerline，侧栏形态不显示它们', () => {
    const { unmount } = render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    expect(screen.queryByTestId('tab-view-column')).toBeNull()
    expect(screen.queryByTestId('tab-app-header')).toBeNull()
    expect(screen.queryByTestId('brand-mark')).toBeNull()
    unmount()

    window.history.pushState({}, '', '/?view=tab')
    render(<Shell organizeContent={<div>步骤内容</div>}>{null}</Shell>)
    const column = screen.getByTestId('tab-view-column')
    expect(column.className).toContain('w-full')
    expect(column.className).not.toContain('max-w-')
    expect(screen.getByTestId('tab-app-header')).toBeDefined()
    const brand = screen.getByTestId('brand-mark')
    expect(within(brand).getByRole('heading', { name: 'Reshelve' })).toBeDefined()
    expect((brand.querySelector('img') as HTMLImageElement).src).toContain('/icons/icon-32.png')
    window.history.pushState({}, '', '/')
  })

  it('标签页整理把书签工作区放左侧、LLM 日志放右侧，并使用左侧步骤目录', () => {
    window.history.pushState({}, '', '/?view=tab')
    render(<Shell organizeContent={<div>书签树</div>}>{null}</Shell>)

    const workspace = screen.getByTestId('tab-workspace-split')
    expect(workspace.className).toContain('lg:grid-cols-')
    expect(within(screen.getByTestId('tab-bookmark-workspace')).getByText('书签树')).toBeDefined()
    expect(screen.getByTestId('tab-llm-log')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'LLM 日志' })).toBeDefined()
    expect(screen.getByTestId('step-sidebar')).toBeDefined()
    window.history.pushState({}, '', '/')
  })
})

describe('Shell 整理步骤导航', () => {
  it('未完成前置时点后续步骤只提示，不跳转', async () => {
    useStore.setState({
      step: 'scope',
      scan: null,
      plan: null,
      structureDraft: null,
      applyResult: null,
      undoResult: null,
      checkedIds: new Set(),
      busy: null,
    })
    render(<Shell organizeContent={<div>范围页</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: '5. 结果' }))
    expect(screen.getByRole('status').textContent).toContain('请先完成前面的步骤')
    expect(screen.getByText('范围页')).toBeDefined()
    expect(useStore.getState().step).toBe('scope')
  })

  it('无勾选时即使留着过期扫描结果也不能进偏好', async () => {
    // 扫过一次后 scan 还在；回到范围页把勾全撤掉时，旧结果不该继续给偏好放行——
    // 否则偏好页「当前范围」计数是 0，开始分析也会拿空 scopeRootIds。
    useStore.setState({
      step: 'scope',
      checkedIds: new Set(),
      scan: {} as ScanResult,
      plan: null,
      structureDraft: null,
      applyResult: null,
      undoResult: null,
      busy: null,
    })
    render(<Shell organizeContent={<div>范围页</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: '2. 偏好' }))
    expect(screen.getByRole('status').textContent).toContain('请先完成前面的步骤')
    expect(useStore.getState().step).toBe('scope')
  })


  it('已有扫描结果时可从后续步骤回到偏好', async () => {
    useStore.setState({
      step: 'review',
      checkedIds: new Set(['folder-1']),
      scan: {} as ScanResult,
      plan: { rows: [], operations: [], warnings: [], scopeRootIds: [], unchanged: [] } as never,
      structureDraft: null,
      applyResult: null,
      busy: null,
    })
    render(<Shell organizeContent={<div data-testid="current-step">复核页</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: '2. 偏好' }))
    expect(useStore.getState().step).toBe('preferences')
  })


  it('已有方案时可从偏好跳到预览', async () => {
    useStore.setState({
      step: 'preferences',
      scan: {} as ScanResult,
      plan: { rows: [], operations: [], warnings: [], scopeRootIds: [], unchanged: [] } as never,
      structureDraft: null,
      applyResult: null,
      busy: null,
    })
    render(<Shell organizeContent={<div>偏好页</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: '4. 预览' }))
    expect(useStore.getState().step).toBe('review')
  })

  it('范围页已勾选时点偏好仍触发扫描前进', async () => {
    const goScan = vi.fn(async () => {
      useStore.setState({ step: 'preferences', scan: {} as ScanResult, busy: null })
    })
    useStore.setState({
      step: 'scope',
      checkedIds: new Set(['folder-1']),
      // 即使上次 scan 还在，勾选可能已变，范围页出发必须重扫。
      scan: {} as ScanResult,
      plan: null,
      busy: null,
      goScan,
    })
    render(<Shell organizeContent={<div>范围页</div>}>{null}</Shell>)

    await userEvent.click(screen.getByRole('button', { name: '2. 偏好' }))
    expect(goScan).toHaveBeenCalledTimes(1)
  })

})


/**
 * ProgressPanel 挂在 Shell 里是为了整理流程和「清理扫描还没回来」那一小段。
 * 扫描已经完成的那句「2 组重复」属于本地清理的「重复收藏」格，切到看板还挂在
 * 页底，等于看板在替清理页说话。
 */
describe('Shell 的进度条按模式各管各的', () => {
  const cleanupLog = {
    id: 1,
    phase: 'cleanup' as const,
    level: 'info' as const,
    message: '扫描完成：2 组重复、0 个空文件夹',
  }

  it('清理扫描完成后的日志不出现在看板', () => {
    useStore.setState({ mode: 'dashboard', logs: [cleanupLog] })
    render(<Shell organizeContent={<div>步骤内容</div>}><div>看板内容</div></Shell>)
    expect(screen.getByText('看板内容')).toBeDefined()
    expect(screen.queryByText(/2 组重复/)).toBeNull()
  })

  it('清理扫描完成后的日志不出现在浏览书签', () => {
    useStore.setState({ mode: 'transfer', logs: [cleanupLog] })
    render(<Shell organizeContent={<div>步骤内容</div>}><div>浏览内容</div></Shell>)
    expect(screen.getByText('浏览内容')).toBeDefined()
    expect(screen.queryByText(/2 组重复/)).toBeNull()
  })

  it('结构草稿已生成但最终分类尚未开始时显示等待确认', () => {
    useStore.setState({
      step: 'structure',
      structureDraft: {} as unknown as StructureDraft,
      plan: null,
      busy: null,
      error: null,
      progress: { phase: 'tags', done: 57, total: 57 },
      logs: [cleanupLog],
    })
    render(<Shell organizeContent={<div>结构编辑器</div>}>{null}</Shell>)

    expect(screen.getByText('等待确认')).toBeDefined()
    expect(screen.queryByText('已完成')).toBeNull()
  })

  it('结构生成后提示用户查看并确认', () => {
    useStore.setState({
      step: 'structure',
      structureDraft: {} as unknown as StructureDraft,
      plan: null,
      busy: null,
      error: null,
    })
    render(<Shell organizeContent={<div>结构编辑器</div>}>{null}</Shell>)

    expect(screen.getByTestId('structure-ready-notice').textContent).toContain('结构已生成，请查看')
    expect(screen.getByRole('button', { name: '关闭' })).toBeDefined()
  })

  it('偏好页不会因为扫描完成而显示通用已完成条', () => {
    useStore.setState({
      step: 'preferences',
      scan: {} as ScanResult,
      busy: null,
      error: null,
      logs: [],
    })
    render(<Shell organizeContent={<div>偏好设置</div>}>{null}</Shell>)

    expect(screen.getByText('偏好设置')).toBeDefined()
    expect(screen.queryByText('已完成')).toBeNull()
  })
})
