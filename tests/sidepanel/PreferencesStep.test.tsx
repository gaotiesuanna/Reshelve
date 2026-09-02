import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreferencesStep } from '@/sidepanel/steps/PreferencesStep'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS, activeLlm } from '@/storage/settings'
import { withLlm } from '../fakes/settings'
import type { OrganizeMode } from '@/core/mode'
import type { BookmarkItem, FolderItem, ScanResult } from '@/core/types'
import type { BookmarkNode } from '@/core/ports'
import type { Endpoint } from '@/storage/settings'

function folder(id: string, title: string, parentId: string | null, depth: number): FolderItem {
  return { id, title, parentId, index: 0, path: [], depth, level: depth }
}

function bookmark(id: string, parentId: string): BookmarkItem {
  return { id, title: id, url: `https://example.com/${id}`, parentId, index: 0, currentPath: [] }
}

function scanOf(folders: FolderItem[], bookmarks: BookmarkItem[]): ScanResult {
  return {
    folders,
    bookmarks,
    stats: {
      totalBookmarks: bookmarks.length, totalFolders: folders.length, emptyFolders: 0,
      untitledBookmarks: 0, duplicateUrlGroups: 0, duplicateFolderGroups: 0, maxDepth: 0,
    },
  }
}

const ROOT = folder('1', '书签栏', null, 0)

/** 已整理过：两个带编号的目录各装 3 条，detectMode 判 additive。 */
const tidyScan = scanOf(
  [ROOT, folder('10', '01 前端', '1', 1), folder('11', '02 后端', '1', 1)],
  [
    ...Array.from({ length: 3 }, (_, i) => bookmark(`a${i}`, '10')),
    ...Array.from({ length: 3 }, (_, i) => bookmark(`b${i}`, '11')),
  ],
)

/**
 * 已整理过、但范围根下还挂着两条没进文件夹的书签。编号前缀仍过线，detectMode
 * 继续判 additive；散落比例也够不上 rebuild 护栏（总量 < MIN_JUDGED_BOOKMARKS）。
 */
const tidyScanWithLoose = scanOf(
  [ROOT, folder('10', '01 前端', '1', 1), folder('11', '02 后端', '1', 1)],
  [
    ...Array.from({ length: 3 }, (_, i) => bookmark(`a${i}`, '10')),
    ...Array.from({ length: 3 }, (_, i) => bookmark(`b${i}`, '11')),
    { id: 'loose1', title: 'MDN', url: 'https://developer.mozilla.org/', parentId: '1', index: 0, currentPath: [] },
    { id: 'loose2', title: '', url: 'https://github.com/foo/bar', parentId: '1', index: 1, currentPath: [] },
  ],
)


/** 一个目录都没有，detectMode 判 rebuild。 */
const messyScan = scanOf([ROOT], Array.from({ length: 5 }, (_, i) => bookmark(`l${i}`, '1')))

/**
 * 内容对域名聚合这组用例不重要——模式全靠 modeOverride 钉死，不依赖 detectMode
 * 的阈值。阈值调一下不该让这组无关用例跟着变红（计划 Task 2 Step 7 论证过同一件事，
 * 后台测试已经这么做了，见 handlers.test.ts 的 analyzeWith）。
 */
const anyScan = scanOf([ROOT, folder('10', '目录', '1', 1)], [bookmark('a', '10')])

function setup(scan: ScanResult, modeOverride: OrganizeMode | null = null): void {
  useStore.setState({
    scan,
    settings: { ...DEFAULT_SETTINGS },
    modeOverride,
    busy: null,
    // setSettings 会打 send()，必须替身；setModeOverride 只写 state，用真的那个
    setSettings: vi.fn(async (settings) => { useStore.setState({ settings }) }),
  })
}

describe('PreferencesStep 主区与操作', () => {
  it('渲染范围区，返回与「开始 AI 分析」都在', () => {
    setup(messyScan)
    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-configured' }),
      },
    })
    render(<PreferencesStep />)

    expect(screen.getByTestId('preferences-section')).toBeTruthy()
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

// 域名聚合那一组勾选框随 issues/38-source-vs-topic.md 的 D4 删掉了。
// 留一条反向断言：它不该以任何形式再出现在偏好页上。
describe('PreferencesStep 不再有域名聚合', () => {
  beforeEach(() => { setup(anyScan, 'rebuild') })

  it('偏好页上没有域名组的勾选框', () => {
    render(<PreferencesStep />)
    expect(screen.queryByLabelText('GitHub')).toBeNull()
    expect(screen.queryByLabelText('论文')).toBeNull()
  })
})

describe('PreferencesStep 清理空文件夹的说明', () => {
  // 这段说明描述的行为在合并模式下有例外：
  // 源文件夹会被清空删除，而且删不删跟这个开关无关（apply.ts 里是
  // `removeEmptyFolders === true || mergeRootId !== null`）。
  // 界面上唯一一处讲「什么不会被删」的地方说了假话，比不讲更糟。
  function cleanDetail(): HTMLElement {
    setup(messyScan)
    render(<PreferencesStep />)
    // 查这张卡而不是 label：说明已经从 label 里搬出来，成了卡片里勾选行下面的一行
    // （dl 套在 label 里是无效 HTML，两条边框还会和卡片的行间线叠成双线）。
    const card = screen.getByTestId('prefs-clean-option')
    expect(within(card).getByText('整理后清理空文件夹')).toBeTruthy()
    expect(within(card).getByRole('button', { name: '说明' }).getAttribute('aria-expanded')).toBe('true')
    return within(card).getByText(/删除范围内不含任何书签的文件夹/)
  }

  it('交代合并时源文件夹会被删除，且不受这个开关约束', () => {
    const body = cleanDetail()
    expect(body.textContent).toMatch(/合并/)
    expect(body.textContent).toMatch(/删除/)
    expect(body.textContent).toMatch(/不受.*开关/)
  })

  it('例外那半句本身要带上「可撤销」——删除很吓人，撤销才是让人敢按的那句', () => {
    const body = cleanDetail().textContent ?? ''
    // 只查整段里有没有「撤销」是查不出东西的：原文早就有「撤销时会连同目录一起还原」，
    // 那句讲的是别的事。要看的是「合并」之后那半句自己有没有交代可撤销。
    const exception = body.slice(body.indexOf('合并'))
    expect(exception).toMatch(/删除|清理/)
    expect(exception).toMatch(/撤销/)
  })

  /**
   * 清不清空文件夹是一条偏好，跟这轮动哪些目录无关。挂在「当前范围」标题底下时，
   * 那个标题就在替它说话——说它是范围的一部分。所以它自己占一格。
   */
  it('自己占一格，不挂在「当前范围」底下', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    expect(screen.getByText('整理选项')).toBeTruthy()
    expect(
      within(screen.getByTestId('preferences-section')).queryByText('整理后清理空文件夹'),
    ).toBeNull()
    // 上面那条 queryBy 为 null 单独看是可疑的——它绿着，分不清是真的搬走了还是查错了
    // 地方。配上这条：东西确实还在页面上，只是不在「当前范围」那一格里。
    expect(screen.getByTestId('prefs-clean-option').textContent).toMatch('整理后清理空文件夹')
  })
})

/**
 * 「归入现有（默认）」「只处理散落书签」「重新设计整棵树」是同一个维度上的三个点
 * ——这次整理该动多大范围、多深——用户明确要求把它们并列成一组单选，不再是
 * 「顶部一个逃生口按钮 + 下面选项列表里一个孤零零的勾选框」。
 */
describe('PreferencesStep 整理方式三选一', () => {
  function radioGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: '整理方式' })
  }
  function radio(name: string): HTMLInputElement {
    return within(radioGroup()).getByRole('radio', { name }) as HTMLInputElement
  }

  it('判已整理时默认选中「归入现有目录」，理由句仍然讲清楚凭什么这么判', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    expect(radio('归入现有目录（默认）').checked).toBe(true)
    // 理由来自 core/mode.ts，带着实际数字
    expect(screen.getByText(/带编号前缀/)).toBeTruthy()
  })

  it('三个选项都在，且互斥（同一个 name，浏览器原生保证单选）', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    const group = radioGroup()
    const inputs = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(inputs).toHaveLength(3)
    expect(new Set(inputs.map((i) => i.name)).size).toBe(1)
  })

  it('选「只处理散落书签」：写回设置，不推翻模式判断', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('只处理散落书签'))
    expect(useStore.getState().settings.onlyLooseInAdditive).toBe(true)
    expect(useStore.getState().modeOverride).toBeNull()
  })

  it('选「重新设计整棵树」：推翻模式判断', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('重新设计整棵树'))
    expect(useStore.getState().modeOverride).toBe('rebuild')
    // 结论句与选项说明里都带着「重新设计整棵目录树」这半句，用 getAllByText——
    // 两处都命中才是对的，getByText 在这里天然会因多重匹配而炸
    expect(screen.getAllByText(/重新设计整棵目录树/).length).toBeGreaterThan(0)
  })

  it('推翻之后改选「归入现有目录」：modeOverride 与 onlyLooseInAdditive 一起复位', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('重新设计整棵树'))
    await userEvent.click(radio('归入现有目录（默认）'))

    expect(useStore.getState().modeOverride).toBeNull()
    expect(useStore.getState().settings.onlyLooseInAdditive).toBe(false)
  })

  it('推翻之后改选「只处理散落书签」：同样能直接切回去，不用先跳回默认', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('重新设计整棵树'))
    await userEvent.click(radio('只处理散落书签'))

    expect(useStore.getState().modeOverride).toBeNull()
    expect(useStore.getState().settings.onlyLooseInAdditive).toBe(true)
  })

  it('三个选项各自的说明默认展开', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    const group = radioGroup()
    expect(within(group).getByText(/只把直接散落在范围根下/)).toBeTruthy()
    for (const button of within(group).getAllByRole('button', { name: '说明' })) {
      expect(button.getAttribute('aria-expanded')).toBe('true')
    }
  })

  // 判一团乱麻时没有逃生口——这是产品决定（issues/14 §5），不给「其实我觉得
  // 已经整理过」的选项，所以这三选一整组都不出现，不是三选一里少一项。
  it('判一团乱麻时不渲染这组单选', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    // 空断言防身：先证明这一页真渲染了、而且查询在这一页上确实命中得了东西
    expect(screen.getAllByText(/重新设计整棵目录树/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()

    expect(screen.queryByRole('radiogroup', { name: '整理方式' })).toBeNull()
  })
})

/**
 * 选「只处理散落书签」时，用户得能点开看这一轮实际会送去分类的是哪些地址。
 * 说明文字只讲规则，不报名单；名单默认收起，避免一选中就用一长串 URL 把下面
 * 「开始 AI 分析」顶出视口。
 */
describe('PreferencesStep 散落书签名单', () => {
  function radioGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: '整理方式' })
  }
  function radio(name: string): HTMLInputElement {
    return within(radioGroup()).getByRole('radio', { name }) as HTMLInputElement
  }
  function listToggle(name: string): HTMLButtonElement {
    return within(radioGroup()).getByRole('button', { name }) as HTMLButtonElement
  }

  it('没选这项时不出现名单按钮——三个选项保持同样的一行标题 + 说明', () => {
    setup(tidyScanWithLoose)
    render(<PreferencesStep />)
    expect(within(radioGroup()).queryByRole('button', { name: /散落书签/ })).toBeNull()
  })

  it('选中后出现「N 个散落书签」按钮，默认收起，点开才看到地址', async () => {
    setup(tidyScanWithLoose)
    render(<PreferencesStep />)
    await userEvent.click(radio('只处理散落书签'))

    const toggle = listToggle('2 个散落书签')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('https://developer.mozilla.org/')).toBeNull()
    expect(screen.queryByText('https://github.com/foo/bar')).toBeNull()

    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('MDN')).toBeTruthy()
    expect(screen.getByText('https://developer.mozilla.org/')).toBeTruthy()
    expect(screen.getByText('https://github.com/foo/bar')).toBeTruthy()
  })

  it('名单只含范围根下的散落书签，已经在文件夹里的不出现', async () => {
    setup(tidyScanWithLoose)
    render(<PreferencesStep />)
    await userEvent.click(radio('只处理散落书签'))
    await userEvent.click(listToggle('2 个散落书签'))

    expect(screen.queryByText('https://example.com/a0')).toBeNull()
    expect(screen.queryByText('https://example.com/b0')).toBeNull()
  })

  it('范围内一条散落都没有：按钮仍在，展开后说明是空的', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('只处理散落书签'))

    const toggle = listToggle('0 个散落书签')
    await userEvent.click(toggle)
    expect(screen.getByText('范围内没有直接散落、未归入任何文件夹的书签。')).toBeTruthy()
  })

  it('改选别的项之后名单按钮跟着消失', async () => {
    setup(tidyScanWithLoose)
    render(<PreferencesStep />)
    await userEvent.click(radio('只处理散落书签'))
    expect(listToggle('2 个散落书签')).toBeTruthy()

    await userEvent.click(radio('归入现有目录（默认）'))
    expect(within(radioGroup()).queryByRole('button', { name: /散落书签/ })).toBeNull()
  })
})


/**
 * 模型配置与「统一 GitHub 标题」搬进设置页之后的反向守卫：偏好页只留每轮会变的东西。
 *
 * queryBy... 为 null 的断言天生可疑——它绿着，你分不清是真的搬走了，还是查错了地方，
 * 又或者组件压根没渲染（scan 为 null 时 PreferencesStep 直接 return null，那时查什么都是 null）。
 * 所以每条都先断言一件「搬迁之后仍然留在偏好页上」的东西确实查得到，
 * 证明这一页真渲染出来了、这类查询在这一页上确实能命中，再去断言搬走的那些查不到。
 */
describe('PreferencesStep 不再摆配一次就不动的设置', () => {
  beforeEach(() => { setup(messyScan) })

  it('模型配置整段都不在偏好页上——它是配一次就不动的，属于设置页', () => {
    render(<PreferencesStep />)
    // 空断言防身：这一页确实渲染出内容了
    expect(screen.getByText('整理后清理空文件夹')).toBeTruthy()

    expect(screen.queryByPlaceholderText('Base URL')).toBeNull()
    expect(screen.queryByPlaceholderText('API Key')).toBeNull()
    expect(screen.queryByPlaceholderText('Model')).toBeNull()
    expect(screen.queryByRole('button', { name: 'DeepSeek' })).toBeNull()
    expect(screen.queryByText(/API Key 明文保存在本地浏览器存储中/)).toBeNull()
  })

  it('统一 GitHub 标题的开关不在偏好页上——它改的是书签标题，不是这一轮怎么整理', () => {
    render(<PreferencesStep />)
    // 空断言防身：这一页上确实还渲染着别的勾选框，
    // 所以下面那条 null 不是因为查询本身在这一页上什么都查不到
    // （原来拿域名聚合那组的 label 当锚点，它随 issues/38 的 D4 删掉了）
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)

    expect(screen.queryByLabelText(/统一 GitHub 书签标题/)).toBeNull()
    expect(screen.queryByText(/仓库名 \(作者\)/)).toBeNull()
  })
})

/**
 * 模型配置搬进设置页之后，这一页的「开始」按钮是新用户唯一会撞上的墙。
 * 禁用的按钮既不解释为什么、也不给出路，所以没配 Key 时它换成一个能点、点了有去处的按钮。
 */
describe('PreferencesStep 没配模型时的出路', () => {
  function arrange(
    apiKey: string,
    baseUrl: string = activeLlm(DEFAULT_SETTINGS).baseUrl,
  ): { analyze: ReturnType<typeof vi.fn>; openSettings: ReturnType<typeof vi.fn> } {
    setup(messyScan)
    const analyze = vi.fn(async () => {})
    const openSettings = vi.fn()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey, baseUrl }) },
      analyze, openSettings,
    })
    return { analyze, openSettings }
  }

  it('apiKey 为空时按钮能点，点了去设置页而不是开始分析', async () => {
    const { analyze, openSettings } = arrange('')
    render(<PreferencesStep />)

    const button = screen.getByRole('button', { name: '先去配置模型' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await userEvent.click(button)
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('apiKey 为空时不摆「开始 AI 分析」——那一步这会儿走不通', () => {
    arrange('')
    render(<PreferencesStep />)
    // 空断言防身：先证明这一页渲染出来了、这类查询在这一页上确实命中得了按钮
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: '开始 AI 分析' })).toBeNull()
  })

  it('apiKey 非空时才是「开始 AI 分析」，点了真的开始分析', async () => {
    const { analyze, openSettings } = arrange('sk-already-configured')
    render(<PreferencesStep />)

    const button = screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await userEvent.click(button)
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(openSettings).not.toHaveBeenCalled()
  })

  it('apiKey 非空时不再摆「先去配置模型」', () => {
    arrange('sk-already-configured')
    render(<PreferencesStep />)
    // 空断言防身：同上，这一页上按钮名查询确实能命中
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: '先去配置模型' })).toBeNull()
  })

  it('本机 Ollama：apiKey 空着也该拿到「开始 AI 分析」，点了真的开始分析', async () => {
    // 设置页点一下「本地 Ollama」预设之后就是这个状态：baseUrl 换了，apiKey 一个字没填。
    // 只认 apiKey 的话这里给的是「先去配置模型」，点它回到他刚配完的设置页——死循环
    const { analyze, openSettings } = arrange('', 'http://localhost:11434/v1')
    render(<PreferencesStep />)

    const button = screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByRole('button', { name: '先去配置模型' })).toBeNull()

    await userEvent.click(button)
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(openSettings).not.toHaveBeenCalled()
  })

  it('分析在跑时「开始 AI 分析」照旧禁用', () => {
    arrange('sk-already-configured')
    useStore.setState({ busy: '分析中…' })
    render(<PreferencesStep />)
    expect((screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('已配好时写出当前模型名——设置藏在齿轮后面，点开始前得看见即将用哪一个', () => {
    arrange('sk-already-configured')
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        ...withLlm({ ...activeLlm(useStore.getState().settings), model: 'deepseek-chat' }),
      },
    })
    render(<PreferencesStep />)
    // 空断言防身：这一页是「开始 AI 分析」那个分支，不是「先去配置」
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeTruthy()
    expect(screen.getByText(/deepseek-chat/)).toBeTruthy()
  })

  it('还没配时提醒还未配置，且不把默认模型名摆出来冒充已选', () => {
    arrange('')
    render(<PreferencesStep />)
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()
    expect(screen.getByText('还没配置模型')).toBeTruthy()
    expect(screen.queryByText(/gpt-4o-mini/)).toBeNull()
  })
})

/**
 * 预告是无条件渲染的，两种按钮状态下都摆着。两条用例分别钉住一种状态——
 * 只守「没配模型」那一种的话，把这段挪进 needModel 分支照样全绿，而那个挪法恰好把
 * 预告从唯一真正需要它的人眼前拿走：权限弹窗只在已经配好、点下「开始 AI 分析」的
 * 那一刻才会出现。
 */
describe('PreferencesStep 的权限预告', () => {
  it('提前说明那一刻会申请哪一个域名的访问权限', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    // 前提：这一条守的是「还没配模型」那个分支
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()

    // 文案改写后不再说「只这一个」——本地清理的失效链接检查另要一项权限，
    // 这条承诺不再是全局唯一的，改按「才会向浏览器申请访问你填的那个模型域名」定位
    const notice = screen.getByText(/才会向浏览器申请访问你填的那个模型域名/)
    expect(notice.textContent).toMatch(/模型/)
    // 关键在「只申请你填的那一个」和「安装时一个都没要」——这是卖点，不是免责声明
    expect(notice.textContent).toMatch(/安装时/)
  })

  it('已经配好模型时照样摆着——真会撞上那个权限弹窗的恰恰是他', () => {
    setup(messyScan)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-already-configured' }) },
    })
    render(<PreferencesStep />)
    // 前提：这一条守的是「已经配好」那个分支，按钮得真是「开始 AI 分析」
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeTruthy()

    // 文案改写后不再说「只这一个」——本地清理的失效链接检查另要一项权限，
    // 这条承诺不再是全局唯一的，改按「才会向浏览器申请访问你填的那个模型域名」定位
    const notice = screen.getByText(/才会向浏览器申请访问你填的那个模型域名/)
    expect(notice.textContent).toMatch(/模型/)
    expect(notice.textContent).toMatch(/安装时/)
  })
})

/**
 * 统计表留在选范围页。偏好页看不见树了，还是得把路径摆出来——
 * 只报「react」会跟别处同名目录撞车，写法仍是 /书签栏/react/。
 */
describe('PreferencesStep 显示当前选择的文件夹', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: 'react', children: [] },
        { id: '11', title: '杂项', children: [] },
      ]},
    ]},
  ]

  it('把勾中的深层目录画成 /父/子/ 路径', () => {
    setup(anyScan)
    useStore.setState({ tree, checkedIds: new Set(['10']) })
    render(<PreferencesStep />)
    expect(screen.getByText('当前范围')).toBeTruthy()
    expect(screen.getByText('/书签栏/react/')).toBeTruthy()
  })

  it('级联勾选只显示真正的范围根', () => {
    setup(anyScan)
    useStore.setState({ tree, checkedIds: new Set(['1', '10', '11']) })
    render(<PreferencesStep />)
    expect(screen.getByText('/书签栏/')).toBeTruthy()
    expect(screen.queryByText('/书签栏/react/')).toBeNull()
  })

  it('不把扫描结果统计表再摆一遍', () => {
    setup(anyScan)
    useStore.setState({ tree, checkedIds: new Set(['10']) })
    render(<PreferencesStep />)
    expect(screen.queryByText('扫描结果')).toBeNull()
    expect(screen.queryByText('重名目录')).toBeNull()
  })
})



describe('偏好页的模型下拉', () => {
  const opencode: Endpoint = {
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: 'sk-x',
    models: ['glm-5.2', 'deepseek-v4-flash'],
  }
  const ollama: Endpoint = { baseUrl: 'http://localhost:11434/v1', apiKey: '', models: ['qwen2.5'] }
  const unconfigured: Endpoint = {
    baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4o-mini'],
  }
  const value = (baseUrl: string, model: string): string => `${baseUrl}\u0000${model}`

  function arrange(endpoints: Endpoint[], active: { baseUrl: string; model: string }) {
    setup(messyScan)
    const openSettings = vi.fn()
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, endpoints, active }, openSettings })
    return { openSettings }
  }

  const picker = () => screen.getByRole('combobox', { name: '将使用' }) as HTMLSelectElement

  it('列出所有可用的「端点 × 模型」，当前那一对是选中项', () => {
    arrange([opencode, ollama], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    expect([...picker().options].map((o) => o.textContent)).toEqual([
      'glm-5.2 · opencode.ai',
      'deepseek-v4-flash · opencode.ai',
      'qwen2.5 · localhost:11434',
      '在设置页填别的…',
    ])
    expect(picker().value).toBe(value(opencode.baseUrl, 'glm-5.2'))
  })

  // 列出一个用不了的组合是陷阱：选中它这一页立刻翻成「还没配置模型」，
  // 用户得自己想明白刚才那一下干了什么
  it('还没填 Key 的远程端点不进名单', () => {
    arrange([opencode, unconfigured], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    expect([...picker().options].map((o) => o.textContent))
      .not.toContain('gpt-4o-mini · api.openai.com')
  })

  // 本机端点空 Key 是正常的，那条路 README 明确支持
  it('本机端点空 Key 照样进名单', () => {
    arrange([ollama], { baseUrl: ollama.baseUrl, model: 'qwen2.5' })
    render(<PreferencesStep />)

    expect([...picker().options].map((o) => o.textContent)).toContain('qwen2.5 · localhost:11434')
  })

  it('切到另一个端点的模型，active 连端点一起换过去', async () => {
    arrange([opencode, ollama], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    await userEvent.selectOptions(picker(), value(ollama.baseUrl, 'qwen2.5'))
    expect(useStore.getState().settings.active)
      .toEqual({ baseUrl: ollama.baseUrl, model: 'qwen2.5' })
  })

  it('选「在设置页填别的…」时开设置页，active 一个字都不改', async () => {
    const { openSettings } = arrange([opencode], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    await userEvent.selectOptions(picker(), '::open-settings')
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect(useStore.getState().settings.active.model).toBe('glm-5.2')
  })

  it('一个可用的都没有时不摆下拉，整页走「还没配置模型」', () => {
    arrange([unconfigured], { baseUrl: unconfigured.baseUrl, model: 'gpt-4o-mini' })
    render(<PreferencesStep />)
    // 空断言防身：先证明这一页确实渲染在「还没配」那个分支上
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()

    expect(screen.queryByRole('combobox', { name: '将使用' })).toBeNull()
  })
})

