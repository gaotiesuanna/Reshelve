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

function setup(scan: ScanResult, modeOverride: OrganizeMode | null = 'rebuild'): void {
  useStore.setState({
    scan,
    settings: { ...DEFAULT_SETTINGS },
    modeOverride,
    busy: null,
    // setSettings 会打 send()，必须替身；setModeOverride 只写 state，用真的那个
    setSettings: vi.fn(async (settings) => { useStore.setState({ settings }) }),
    titleOnly: false,
    titleRuleIds: ['github'],
    setTitleOnly: vi.fn((titleOnly: boolean) => useStore.setState({ titleOnly })),
    setTitleRuleIds: (titleRuleIds: string[]) => useStore.setState({ titleRuleIds }),
  })
}

describe('PreferencesStep 仅规范化书签标题', () => {
  it('提供 title-only 选项，选中后不显示模型配置入口并切换开始按钮', async () => {
    setup(tidyScan)
    const analyze = vi.fn(async () => {})
    useStore.setState({ analyze })
    render(<PreferencesStep />)

    const option = screen.getByRole('radio', { name: '仅规范化书签标题' }) as HTMLInputElement
    expect(option.checked).toBe(false)
    await userEvent.click(option)

    expect(useStore.getState().titleOnly).toBe(true)
    expect(screen.queryByText('将使用')).toBeNull()
    expect(screen.getByRole('button', { name: '预览标题改名' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '开始 AI 分析' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '预览标题改名' }))
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('进入 title-only 时默认只勾 GitHub，其它平台不勾', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(screen.getByRole('radio', { name: '仅规范化书签标题' }))

    expect((screen.getByRole('checkbox', { name: /GitHub/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /YouTube/ }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: /GitLab/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('勾选 YouTube 后 titleRuleIds 含 youtube，普通整理路径仍在未勾 title-only 时可见清理空文件夹', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    expect(screen.getByTestId('prefs-clean-option')).toBeTruthy()

    await userEvent.click(screen.getByRole('radio', { name: '仅规范化书签标题' }))
    expect(screen.queryByTestId('prefs-clean-option')).toBeNull()

    await userEvent.click(screen.getByRole('checkbox', { name: /YouTube/ }))
    expect(useStore.getState().titleRuleIds).toEqual(expect.arrayContaining(['github', 'youtube']))
  })

  it('GitHub 行显示当前范围可改名数量', async () => {
    const scan = scanOf(
      [ROOT, folder('10', '01 前端', '1', 1)],
      [{ id: 'g', title: 'GitHub - sst/opencode', url: 'https://github.com/sst/opencode', parentId: '10', index: 0, currentPath: [] }],
    )
    setup(scan)
    render(<PreferencesStep />)
    await userEvent.click(screen.getByRole('radio', { name: '仅规范化书签标题' }))
    expect(screen.getByRole('checkbox', { name: /GitHub/ }).closest('label')?.textContent).toMatch(/1/)
  })
})

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
  async function cleanDetail(): Promise<HTMLElement> {
    setup(messyScan)
    render(<PreferencesStep />)
    const card = screen.getByTestId('prefs-clean-option')
    expect(within(card).getByText('整理后清理空文件夹')).toBeTruthy()
    const toggle = within(card).getByRole('button', { name: '说明' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    return within(card).getByText(/删除范围内不含任何书签的文件夹/)
  }

  it('交代合并时源文件夹会被删除，且不受这个开关约束', async () => {
    const body = await cleanDetail()
    expect(body.textContent).toMatch(/合并/)
    expect(body.textContent).toMatch(/删除/)
    expect(body.textContent).toMatch(/不受.*开关/)
  })

  it('例外那半句本身要带上「可撤销」——删除很吓人，撤销才是让人敢按的那句', async () => {
    const body = (await cleanDetail()).textContent ?? ''
    const exception = body.slice(body.indexOf('合并'))
    expect(exception).toMatch(/删除|清理/)
    expect(exception).toMatch(/撤销/)
  })

  it('跟在整理方式单选组后面，不进 radio group，也不挂在「当前范围」底下', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    expect(screen.getByRole('heading', { name: '整理方式' })).toBeTruthy()
    expect(screen.queryByText('整理选项')).toBeNull()
    expect(
      within(screen.getByTestId('preferences-section')).queryByText('整理后清理空文件夹'),
    ).toBeNull()
    expect(screen.getByTestId('prefs-clean-option').textContent).toMatch('整理后清理空文件夹')
    expect(
      within(screen.getByRole('radiogroup', { name: '整理方式' })).queryByRole('checkbox', {
        name: '整理后清理空文件夹',
      }),
    ).toBeNull()
    expect(screen.getByRole('checkbox', { name: '整理后清理空文件夹' })).toBeTruthy()
  })

  it('清理选项可独立勾选，不改变整理方式选中项', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    const rebuild = screen.getByRole('radio', { name: '重新设计整棵树（默认）' }) as HTMLInputElement
    expect(rebuild.checked).toBe(true)
    const clean = screen.getByRole('checkbox', { name: '整理后清理空文件夹' }) as HTMLInputElement
    expect(clean.checked).toBe(true)
    await userEvent.click(clean)
    expect(useStore.getState().settings.removeEmptyFolders).toBe(false)
    expect(rebuild.checked).toBe(true)
    expect(useStore.getState().titleOnly).toBe(false)
    expect(useStore.getState().modeOverride).toBe('rebuild')
  })
})

/**
 * 「归入现有」「只处理散落书签」「重新设计整棵树（默认）」是同一个维度上的三个点
 * ——这次整理该动多大范围、多深——用户明确要求把它们并列成一组单选，不再是
 * 「顶部一个逃生口按钮 + 下面选项列表里一个孤零零的勾选框」。
 */
describe('PreferencesStep 整理方式四选一', () => {
  function radioGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: '整理方式' })
  }
  function radio(name: string): HTMLInputElement {
    return within(radioGroup()).getByRole('radio', { name }) as HTMLInputElement
  }

  it('扫描完成后默认选中重新设计，不跟 detectMode，也不跟上一轮散落选项', () => {
    setup(tidyScan)
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, onlyLooseInAdditive: true } })
    render(<PreferencesStep />)
    expect(radio('重新设计整棵树（默认）').checked).toBe(true)
    expect(radio('只处理散落书签').checked).toBe(false)
    expect(screen.getByText(/带编号前缀/)).toBeTruthy()
  })

  it('四个选项都在，且互斥（同一个 name，浏览器原生保证单选）', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    const group = radioGroup()
    const inputs = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(inputs).toHaveLength(4)
    expect(new Set(inputs.map((i) => i.name)).size).toBe(1)
    expect(radio('仅规范化书签标题').checked).toBe(false)
  })

  it('选「只处理散落书签」：写回设置，不推翻模式判断', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('只处理散落书签'))
    expect(useStore.getState().settings.onlyLooseInAdditive).toBe(true)
    expect(useStore.getState().modeOverride).toBeNull()
    expect(useStore.getState().titleOnly).toBe(false)
  })

  it('选「重新设计整棵树」：modeOverride 钉在 rebuild', async () => {
    setup(tidyScan, null)
    render(<PreferencesStep />)
    await userEvent.click(radio('重新设计整棵树（默认）'))
    expect(useStore.getState().modeOverride).toBe('rebuild')
    expect(useStore.getState().titleOnly).toBe(false)
  })

  it('改选「归入现有目录」：modeOverride 与 onlyLooseInAdditive 一起复位', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('归入现有目录'))

    expect(useStore.getState().modeOverride).toBeNull()
    expect(useStore.getState().settings.onlyLooseInAdditive).toBe(false)
    expect(useStore.getState().titleOnly).toBe(false)
  })


  it('四项摘要不显示，说明按钮位于各自选项第一行右侧且默认收起', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    const group = radioGroup()
    expect(within(group).queryByText(/不会改名、合并或删除任何现有文件夹/)).toBeNull()
    expect(within(group).queryByText(/只把直接散落在范围根下/)).toBeNull()
    expect(within(group).queryByText(/会重新设计整棵目录树/)).toBeNull()
    expect(within(group).queryByText(/本轮只规范化当前范围内的书签标题/)).toBeNull()
    expect(within(group).queryByText(/实在分不进去的书签会按主题攒成新目录/)).toBeNull()
    expect(within(group).queryByText(/选「归入现有目录」时，每一轮都会把范围内全部书签重新判断一遍/)).toBeNull()
    expect(within(group).queryByText(/没进本轮设计的旧文件夹/)).toBeNull()
    expect(within(group).queryByText(/也不会清理空文件夹/)).toBeNull()
    for (const button of within(group).getAllByRole('button', { name: '说明' })) {
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.closest('dt')).toBeTruthy()
      expect(button.closest('dl')?.querySelector('label')).toBeTruthy()
    }
  })

  it('展开说明后仍能读到长正文', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    const group = radioGroup()
    const toggles = within(group).getAllByRole('button', { name: '说明' })
    await userEvent.click(toggles[0]!)
    expect(within(group).getByText(/实在分不进去的书签会按主题攒成新目录/)).toBeTruthy()
  })

  it('判一团乱麻时仍渲染四项，默认选中重新设计，理由在范围区', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
    expect(radio('重新设计整棵树（默认）').checked).toBe(true)
    expect(within(radioGroup()).getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByText(/范围内一个目录都没有/)).toBeTruthy()
  })

  it('判一团乱麻时改选归入现有：显式推翻为 additive', async () => {
    setup(messyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('归入现有目录'))
    expect(useStore.getState().modeOverride).toBe('additive')
    expect(useStore.getState().titleOnly).toBe(false)
    expect(useStore.getState().settings.onlyLooseInAdditive).toBe(false)
  })

  it('判一团乱麻时改选只处理散落：同样显式推翻为 additive', async () => {
    setup(messyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('只处理散落书签'))
    expect(useStore.getState().modeOverride).toBe('additive')
    expect(useStore.getState().settings.onlyLooseInAdditive).toBe(true)
    expect(useStore.getState().titleOnly).toBe(false)
  })

  it('从标题模式改选归入现有会清掉 titleOnly', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(radio('仅规范化书签标题'))
    expect(useStore.getState().titleOnly).toBe(true)
    await userEvent.click(radio('归入现有目录'))
    expect(useStore.getState().titleOnly).toBe(false)
    expect(radio('归入现有目录').checked).toBe(true)
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

  it('没选这项时不出现名单按钮', () => {
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

    await userEvent.click(radio('归入现有目录'))
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

  it('偏好页提供仅统一 GitHub 标题的本轮选项，但不重复设置页的长期开关说明', () => {
    render(<PreferencesStep />)
    // 空断言防身：这一页上确实还渲染着别的勾选框，
    // 所以下面那条 null 不是因为查询本身在这一页上什么都查不到
    // （原来拿域名聚合那组的 label 当锚点，它随 issues/38 的 D4 删掉了）
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)

    expect(screen.getByRole('radio', { name: '仅规范化书签标题' })).toBeTruthy()
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
