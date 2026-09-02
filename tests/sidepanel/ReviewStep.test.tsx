import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewStep } from '@/sidepanel/steps/ReviewStep'
import { useStore } from '@/sidepanel/store'
import { downloadJson } from '@/sidepanel/lib/download'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import type { Settings } from '@/storage/settings'
import type { CategoryCandidate, OrganizePlan, PlanRow, UnchangedRow } from '@/core/types'

vi.mock('@/sidepanel/lib/download', () => ({ downloadJson: vi.fn(), downloadText: vi.fn() }))

const plan: OrganizePlan = {
  id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
  candidates: [], operations: [],
  rows: [
    { bookmarkId: '100', title: 'React 官网', url: 'https://react.dev', fromPath: ['书签栏', '杂项'], toPath: ['书签栏', 'react'], toCategoryId: 'react', confidence: 0.95, reason: '官方文档', source: 'llm' },
    { bookmarkId: '101', title: '不确定的', url: 'https://x.dev', fromPath: ['书签栏', '杂项'], toPath: ['书签栏', 'react'], toCategoryId: 'react', confidence: 0.4, reason: '可能相关', source: 'llm' },
  ],
  unchanged: [],
  summary: { totalBookmarks: 2, movedBookmarks: 2, unchangedBookmarks: 0, createdFolders: 0, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 1 },
  warnings: [],
  tags: [],
  mergeRoot: null,
}

beforeEach(() => {
  useStore.setState({ plan, accepted: new Set(['100']), reclassifyMarked: new Set(), busy: null, error: null })
})

describe('ReviewStep', () => {
  it('渲染预览区，放弃与应用按钮都在', () => {
    render(<ReviewStep />)

    expect(screen.getByTestId('review-section')).toBeTruthy()
    expect(screen.getByRole('button', { name: '放弃' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /应用 1 项修改/ })).toBeTruthy()
  })

  it('列出每条建议的前后路径与理由', () => {
    render(<ReviewStep />)
    expect(screen.getByText('React 官网')).toBeDefined()
    expect(screen.getAllByText(/书签栏 \/ 杂项/).length).toBeGreaterThan(0)
    expect(screen.getByText(/官方文档/)).toBeDefined()
  })

  it('置信度低于阈值的条目被标出', () => {
    render(<ReviewStep />)
    expect(screen.getByText('值得看一眼')).toBeDefined()
  })

  it('复选框反映已接受状态', () => {
    render(<ReviewStep />)
    expect((screen.getByRole('checkbox', { name: 'React 官网' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: '不确定的' }) as HTMLInputElement).checked).toBe(false)
  })

  it('点击复选框切换接受状态', async () => {
    render(<ReviewStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: '不确定的' }))
    expect(useStore.getState().accepted.has('101')).toBe(true)
  })

  it('全部接受按钮接受所有条目', async () => {
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('全部接受'))
    expect(useStore.getState().accepted.size).toBe(2)
  })

  /**
   * 每个分组标题旁边有自己的全选/取消全选勾选框——两条书签共享同一个目标目录，
   * 是同一个组；fixture 里 accepted 只含 '100'，组内一勾一没勾，勾选框该是
   * 半选状态（indeterminate），不是简单的 true/false 二选一。
   */
  describe('分组的全选勾选框', () => {
    const groupCheckbox = () => screen.getByRole('checkbox', { name: /全选或取消全选/ }) as HTMLInputElement

    it('组内部分接受时是半选状态', () => {
      render(<ReviewStep />)
      const checkbox = groupCheckbox()
      expect(checkbox.checked).toBe(false)
      expect(checkbox.indeterminate).toBe(true)
    })

    it('半选时点一下——组内全部变为接受', async () => {
      render(<ReviewStep />)
      await userEvent.click(groupCheckbox())
      expect(useStore.getState().accepted).toEqual(new Set(['100', '101']))
    })

    it('组内已全部接受时勾选框是纯勾选状态，不是半选', () => {
      useStore.setState({ accepted: new Set(['100', '101']) })
      render(<ReviewStep />)
      const checkbox = groupCheckbox()
      expect(checkbox.checked).toBe(true)
      expect(checkbox.indeterminate).toBe(false)
    })

    it('全选时点一下——组内全部变为拒绝', async () => {
      useStore.setState({ accepted: new Set(['100', '101']) })
      render(<ReviewStep />)
      await userEvent.click(groupCheckbox())
      expect(useStore.getState().accepted).toEqual(new Set())
    })

    it('组内一个都没接受时勾选框是空的，不是半选', () => {
      useStore.setState({ accepted: new Set() })
      render(<ReviewStep />)
      const checkbox = groupCheckbox()
      expect(checkbox.checked).toBe(false)
      expect(checkbox.indeterminate).toBe(false)
    })

    // 点它是「选中/取消这一组」，不是「展开/折叠这一组」——两个是分开的控件，
    // 点其中一个不该影响另一个的状态
    it('点它不会连带折叠或展开这一组', async () => {
      render(<ReviewStep />)
      expect(screen.getByRole('checkbox', { name: 'React 官网' })).toBeTruthy()
      await userEvent.click(groupCheckbox())
      expect(screen.getByRole('checkbox', { name: 'React 官网' })).toBeTruthy()
    })
  })

  describe('标记重新分类', () => {
    it('每一条建议旁边都有一个默认不勾的「标记重新分类」', () => {
      render(<ReviewStep />)
      const checkboxes = screen.getAllByRole('checkbox', { name: '标记重新分类' }) as HTMLInputElement[]
      // fixture 两条建议共享同一个目标目录，是同一个组——两条都渲染了自己的勾选框
      expect(checkboxes).toHaveLength(2)
      expect(checkboxes.every((c) => !c.checked)).toBe(true)
    })

    it('勾上就写进 reclassifyMarked，再点一下取消', async () => {
      render(<ReviewStep />)
      const [first] = screen.getAllByRole('checkbox', { name: '标记重新分类' })
      await userEvent.click(first!)
      expect(useStore.getState().reclassifyMarked.has('100')).toBe(true)
      await userEvent.click(first!)
      expect(useStore.getState().reclassifyMarked.has('100')).toBe(false)
    })

    it('一条都没标记时，「重新分类选中项」按钮不出现——不常驻一个多数时候没用的按钮', () => {
      render(<ReviewStep />)
      expect(screen.queryByRole('button', { name: /重新分类选中的/ })).toBeNull()
    })

    it('标记之后按钮出现，带着数量', async () => {
      render(<ReviewStep />)
      const [first] = screen.getAllByRole('checkbox', { name: '标记重新分类' })
      await userEvent.click(first!)
      expect(screen.getByRole('button', { name: '重新分类选中的 1 条' })).toBeTruthy()
    })

    it('点按钮调用 reclassifySelected', async () => {
      const reclassifySelected = vi.fn(async () => {})
      useStore.setState({ reclassifySelected })
      render(<ReviewStep />)
      const [first] = screen.getAllByRole('checkbox', { name: '标记重新分类' })
      await userEvent.click(first!)
      await userEvent.click(screen.getByRole('button', { name: '重新分类选中的 1 条' }))
      expect(reclassifySelected).toHaveBeenCalledTimes(1)
    })

    // 标记是逐行往下滚动着做的，按钮摆在页面顶部意味着标完得先滚回最上面才点得到，
    // 在几百条的库里这一路要滚很久（用户反馈：标完看不到按钮在哪）。挪进底部的
    // 粘性操作条——跟「应用」同一个理由，跟着页面走，标到哪都够得着。
    it('按钮跟「放弃/应用」同一个粘性操作条，不在页面顶部', async () => {
      render(<ReviewStep />)
      const [first] = screen.getAllByRole('checkbox', { name: '标记重新分类' })
      await userEvent.click(first!)
      const button = screen.getByRole('button', { name: '重新分类选中的 1 条' })
      const discardButton = screen.getByRole('button', { name: '放弃' })
      // 两者共享同一个粘性操作条容器
      expect(button.closest('.sticky')).not.toBeNull()
      expect(button.closest('.sticky')).toBe(discardButton.closest('.sticky'))
    })
  })

  it('全部拒绝后应用按钮禁用', async () => {
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('全部拒绝'))
    expect(screen.getByRole('button', { name: /应用/ }).hasAttribute('disabled')).toBe(true)
  })

  it('应用按钮显示将要移动的数量', () => {
    render(<ReviewStep />)
    expect(screen.getByRole('button', { name: /应用 1 项修改/ })).toBeDefined()
  })

  it('导出方案带上勾选状态与设置，且不含 apiKey', async () => {
    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        // 两条端点：这一步要验的是「每一条端点的 Key 都被剥掉」，不是只剥当前在用的那条
        endpoints: [
          { baseUrl: 'https://api.x.com/v1', apiKey: 'sk-secret', models: ['gpt-4o-mini'] },
          { baseUrl: 'https://api.y.com/v1', apiKey: 'sk-secret-2', models: ['other-model'] },
        ],
        active: { baseUrl: 'https://api.x.com/v1', model: 'gpt-4o-mini' },
      },
    })
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('导出方案'))

    const [filename, payload] = vi.mocked(downloadJson).mock.calls.at(-1)!
    expect(filename).toMatch(/^reshelve-plan-\d{4}-\d{2}-\d{2}\.json$/)
    const body = payload as { settings: Settings; accepted: string[]; plan: OrganizePlan }
    expect(body.accepted).toEqual(['100'])
    expect(body.plan.rows).toHaveLength(2)
    expect(body.settings.active.model).toBe('gpt-4o-mini')
    // 这个文件是要发出去给人看的，密钥一个字符都不能跟着走——多条端点也不例外
    expect(JSON.stringify(payload)).not.toContain('sk-secret')
    expect(body.settings.endpoints.every((e) => !('apiKey' in e))).toBe(true)
  })
})

/**
 * 造一条最简 PlanRow，只暴露测试关心的几个维度：id、目标目录、来源，
 * confidence 缺省时按来源给个合理默认值（rule 必然高、llm 给个中等值）。
 *
 * toCategoryId 缺省时按 toPath 拼一个稳定的假 id——大多数用例（分组、折叠、勾选）
 * 根本不读它。只有真的要跟 candidates 对上号的用例（改投下拉）才需要显式传真实 id。
 */
function row(
  id: string, toPath: string[], source: PlanRow['source'], confidence?: number, toCategoryId?: string,
): PlanRow {
  return {
    bookmarkId: id,
    title: `书签 ${id}`,
    url: `https://example.com/${id}`,
    fromPath: ['书签栏', '杂项'],
    toPath,
    toCategoryId: toCategoryId ?? `cand:${toPath.join('/')}`,
    confidence: confidence ?? (source === 'rule' ? 1 : 0.9),
    reason: source === 'rule' ? '域名规则命中' : '模型判断',
    source,
  }
}

/**
 * 拿一批行拼出一份最简 plan 塞进 store，rebuildStructure 关着，renumberPlan 就原样直通。
 * candidates 缺省为空数组——只有测试改投下拉时才需要真的传几个候选目录进来。
 * unchanged 缺省为空数组——只有测试未变动区时才需要真的传几条进来。
 */
function setupPlan(rows: PlanRow[], candidates: CategoryCandidate[] = [], unchanged: UnchangedRow[] = []): void {
  const groupPlan: OrganizePlan = {
    id: 'g1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
    candidates, operations: [],
    rows,
    unchanged,
    summary: {
      totalBookmarks: rows.length, movedBookmarks: rows.length, unchangedBookmarks: unchanged.length,
      createdFolders: 0, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0,
    },
    warnings: [],
    tags: [],
    mergeRoot: null,
  }
  useStore.setState({ plan: groupPlan, accepted: new Set(rows.map((r) => r.bookmarkId)), busy: null, error: null })
}

describe('ReviewStep 的未变动区', () => {
  it('列出这一轮不会动的书签，默认折叠', () => {
    setupPlan([row('a', ['01 前端'], 'llm')], undefined, [
      { bookmarkId: 'x', title: '书签 x', url: 'https://x.dev', currentPath: ['收件箱'], kind: 'noTarget', reason: '无合适目录' },
    ])
    render(<ReviewStep />)
    expect(screen.getByText(/1 条不会动/)).toBeTruthy()
    expect(screen.queryByText('书签 x')).toBeNull()
  })

  it('展开后按三种原因分开——它们对用户的含义完全不同', async () => {
    setupPlan([row('a', ['01 前端'], 'llm')], undefined, [
      { bookmarkId: 'x', title: '书签 x', url: 'https://x.dev', currentPath: [], kind: 'inPlace', reason: '' },
      { bookmarkId: 'y', title: '书签 y', url: 'https://y.dev', currentPath: [], kind: 'noTarget', reason: '无合适目录' },
      { bookmarkId: 'z', title: '书签 z', url: 'https://z.dev', currentPath: [], kind: 'failed', reason: '超时' },
    ])
    render(<ReviewStep />)
    await userEvent.click(screen.getByText(/3 条不会动/))

    expect(screen.getByText(/已经在合适的目录里/)).toBeTruthy()
    expect(screen.getByText(/没有找到合适的目录/)).toBeTruthy()
    expect(screen.getByText(/这次没能分类/)).toBeTruthy()
  })

  it('一条都没有时整个区块不出现', () => {
    setupPlan([row('a', ['01 前端'], 'llm')], undefined, [])
    render(<ReviewStep />)
    expect(screen.queryByText(/不会动/)).toBeNull()
  })
})

describe('ReviewStep 的分组', () => {
  it('按目标目录分组，组标题是目标路径', () => {
    setupPlan([
      row('a', ['01 前端'], 'llm'), row('b', ['01 前端'], 'llm'), row('c', ['02 后端'], 'llm'),
    ])
    render(<ReviewStep />)
    expect(screen.getByText('01 前端')).toBeTruthy()
    expect(screen.getByText('02 后端')).toBeTruthy()
  })

  it('整组都是规则命中时给组级标记，并默认折叠', () => {
    setupPlan([row('a', ['01 GitHub'], 'rule'), row('b', ['01 GitHub'], 'rule')])
    render(<ReviewStep />)
    expect(screen.getByText(/全部来自域名规则/)).toBeTruthy()
    // 折叠：成员的标题不在文档里
    expect(screen.queryByText('书签 a')).toBeNull()
  })

  it('展开之后成员就看得见', async () => {
    setupPlan([row('a', ['01 GitHub'], 'rule'), row('b', ['01 GitHub'], 'rule')])
    render(<ReviewStep />)
    await userEvent.click(screen.getByText(/全部来自域名规则/))
    expect(screen.getByText('书签 a')).toBeTruthy()
  })

  it('混着模型判断的组不折叠——那组里正是要审的东西', () => {
    setupPlan([row('a', ['01 GitHub'], 'rule'), row('b', ['01 GitHub'], 'llm')])
    render(<ReviewStep />)
    expect(screen.getByText('书签 a')).toBeTruthy()
    expect(screen.queryByText(/全部来自域名规则/)).toBeNull()
  })

  // I4：改投让一行换到另一个组，那个组若被用户手动折叠过，这一行不该当场从文档里消失
  it('改投到被手动折叠过的组时，那个组会自动展开', async () => {
    setupPlan(
      [row('a', ['01 前端'], 'llm', undefined, 'tmp:1'), row('b', ['02 后端'], 'llm', undefined, 'tmp:2')],
      [{ id: 'tmp:1', path: ['01 前端'] }, { id: 'tmp:2', path: ['02 后端'] }],
    )
    render(<ReviewStep />)
    // 手动折叠目标组「02 后端」——它默认不折叠（不是全规则命中），得先手动点一下。
    // 用 role 定位组头按钮：候选下拉里也有同名 option，getByText 会连它一起匹配到
    await userEvent.click(screen.getByRole('button', { name: /02 后端/ }))
    expect(screen.queryByText('书签 b')).toBeNull()

    // 把 a 改投进这个被折叠的组
    await userEvent.selectOptions(screen.getByLabelText('改投目录：书签 a'), 'tmp:2')

    // 刚改投的这一行，以及原本就在组里的 b，都应该看得见——不是「刚点完就找不到了」
    expect(await screen.findByText('书签 a')).toBeTruthy()
    expect(screen.getByText('书签 b')).toBeTruthy()
  })

  it('两个同名组各折各的——身份是 id，不是渲染出来的那串字', async () => {
    // 两个不同的目标目录**恰好同名**（真实场景：库里有重名目录）。
    // 如果分组键是渲染出来的路径字符串，这两组会共用一个键、一折全折。
    setupPlan([
      row('a', ['01 GitHub'], 'llm', 0.9, 'tmp:1'),
      row('b', ['01 GitHub'], 'llm', 0.9, 'tmp:2'),
    ])
    render(<ReviewStep />)
    expect(screen.getByText('书签 a')).toBeTruthy()
    expect(screen.getByText('书签 b')).toBeTruthy()

    // 折叠第一组
    await userEvent.click(screen.getAllByText('01 GitHub')[0]!)
    expect(screen.queryByText('书签 a')).toBeNull()
    // 第二组不受影响——两组的键不同
    expect(screen.getByText('书签 b')).toBeTruthy()
  })

  it('同名不同 id 分成两组——它们本来就是两个目录', () => {
    setupPlan([
      row('a', ['01 GitHub'], 'llm', 0.9, 'tmp:1'),
      row('b', ['01 GitHub'], 'llm', 0.9, 'tmp:2'),
    ])
    render(<ReviewStep />)
    // 两个同名组，各装一条
    expect(screen.getAllByText('01 GitHub')).toHaveLength(2)
  })
})

describe('ReviewStep 的筛选开关', () => {
  // 规则命中的 confidence 恒为 1（core/map.ts），必然在标记阈值之上——所以这一个开关
  // 顺带就把「域名规则判的」全挡在外面了。曾经并排还有一个「只看模型判的」，
  // 它和这个不是两条轴，两个一起开与只开这个是同一个结果，已删。
  it('只看被标记的：只留下低于阈值的行，规则命中的也一并筛掉，不碰勾选', async () => {
    setupPlan([
      row('a', ['01 前端'], 'llm', 0.5),
      row('b', ['01 前端'], 'llm', 0.95),
      row('c', ['02 GitHub'], 'rule', 1),
    ])
    render(<ReviewStep />)

    await userEvent.click(screen.getByText('只看被标记的'))

    expect(screen.getByText('书签 a')).toBeTruthy()
    expect(screen.queryByText('书签 b')).toBeNull()
    expect(screen.queryByText('书签 c')).toBeNull()
    // 筛选只管看得见看不见，不碰 accepted
    expect(useStore.getState().accepted.size).toBe(3)
  })

  it('再点一次就全放回来——出口就是这个开关本身', async () => {
    setupPlan([row('a', ['01 前端'], 'llm', 0.5), row('b', ['01 前端'], 'llm', 0.95)])
    render(<ReviewStep />)

    await userEvent.click(screen.getByText('只看被标记的'))
    expect(screen.queryByText('书签 b')).toBeNull()

    await userEvent.click(screen.getByText('只看被标记的'))
    expect(screen.getByText('书签 b')).toBeTruthy()
  })

  // 开关不说有几条待审的话，用户点之前根本不知道值不值得点——它就是那个「没啥用」的观感来源
  it('开关上写着有几条待审', () => {
    setupPlan([
      row('a', ['01 前端'], 'llm', 0.5),
      row('b', ['01 前端'], 'llm', 0.4),
      row('c', ['01 前端'], 'llm', 0.95),
    ])
    render(<ReviewStep />)
    expect(screen.getByRole('button', { name: /只看被标记的\s*2/ })).toBeTruthy()
  })

  // 一条都没标记时按下去只会得到一片空白，那片空白还得再配一句「是筛没的不是没有建议」
  // 外加一个恢复出口才不算骗人（票 24）。禁用掉，那个 0 已经把话说完了，
  // 「筛选把列表清空」这个状态从此不可达，对应的空态文案与出口也一并删了。
  it('一条都没标记时开关点不动', () => {
    setupPlan([row('a', ['01 前端'], 'llm', 0.95), row('b', ['02 GitHub'], 'rule', 1)])
    render(<ReviewStep />)
    const toggle = screen.getByRole('button', { name: /只看被标记的/ })
    expect(toggle.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /只看被标记的\s*0/ })).toBeTruthy()
  })

  it('本来就一条建议都没有时，走的是空方案文案', () => {
    setupPlan([])
    render(<ReviewStep />)
    expect(screen.getByText(/都已在合适的位置/)).toBeTruthy()
  })
})

describe('ReviewStep 的改投与标记', () => {
  it('每行给一个改投目录的下拉，选了就改方案并自动勾上', async () => {
    setupPlan(
      [row('a', ['01 前端'], 'llm', undefined, 'tmp:1')],
      [{ id: 'tmp:1', path: ['01 前端'] }, { id: 'tmp:2', path: ['02 后端'] }],
    )
    render(<ReviewStep />)
    await userEvent.selectOptions(screen.getByLabelText('改投目录：书签 a'), 'tmp:2')

    expect(useStore.getState().plan!.rows[0]!.toPath).toEqual(['02 后端'])
    expect(useStore.getState().plan!.rows[0]!.toCategoryId).toBe('tmp:2')
    expect(useStore.getState().accepted.has('a')).toBe(true)
  })

  // I2 回归：下拉的当前值必须直接来自 row.toCategoryId，不能拿 toPath 反查候选——
  // 反查在「同组另一行被接受、这一行被取消勾选」时会落空，落空后浏览器退回第一个
  // option，下拉会理直气壮地显示成另一个目录（评审 I2-1）。这里不取消勾选也能钉住：
  // 两个候选路径字符串故意不逐字相等时，反查一样会落空。
  it('改投下拉的当前值直接来自 toCategoryId，不靠路径字符串反查候选', () => {
    setupPlan(
      [row('a', ['前端'], 'llm', undefined, 'tmp:2')],
      [{ id: 'tmp:1', path: ['01 前端'] }, { id: 'tmp:2', path: ['02 后端'] }],
    )
    render(<ReviewStep />)
    const select = screen.getByLabelText('改投目录：书签 a') as HTMLSelectElement
    // row.toPath（'前端'，裸名字）跟任何候选的 path 都逐字对不上，
    // 若靠反查取值就会落空、退回第一个 option（tmp:1），而真实目标是 tmp:2
    expect(select.value).toBe('tmp:2')
  })

  it('置信度低于阈值只是标一下，不影响勾选', () => {
    setupPlan([row('a', ['01 前端'], 'llm', 0.5)])
    render(<ReviewStep />)
    expect(screen.getByText(/值得看一眼/)).toBeTruthy()
    // 默认全选，标记不改变这一点
    expect(useStore.getState().accepted.has('a')).toBe(true)
  })
})

/**
 * 票 15 接受残留（不去挪用户明确拒绝移动的书签），但用户有权知道后果：
 * 取消勾选的这条若是原目录里最后一个留守者，那个目录就会因为它活下来。
 */
describe('ReviewStep 的留下目录提示', () => {
  // 用 row() 造的行 fromPath 都是 ['书签栏', '杂项']，两条同源
  it('取消勾选后，若这条是原目录里最后一个还没搬走的，那一行说明会保留哪个目录', async () => {
    setupPlan([row('a', ['01 前端'], 'llm'), row('b', ['01 前端'], 'llm')])
    render(<ReviewStep />)
    // 勾着的时候不提示：勾上就等于会搬走，没有目录因它留下
    expect(screen.queryByText(/会保留目录/)).toBeNull()

    await userEvent.click(screen.getByRole('checkbox', { name: '书签 a' }))

    expect(screen.getByText(/会保留目录「杂项」/)).toBeTruthy()
  })

  // 散在书签栏根下的书签正是这个扩展最典型的入场数据。非合并模式下扫描根一定不会被删
  // （applyPlan 传给 removeEmpty 的 removableRootIds 是空的，本轮新建的目录还挂在它下面），
  // 这时说「会保留目录『书签栏』」是乱说。fromPath 只有一层就是这种情形。
  it('书签本来就散在扫描根下时不提示——那个根本轮怎样都不会被删', async () => {
    const atRoot = (id: string): PlanRow => ({ ...row(id, ['01 前端'], 'llm'), fromPath: ['书签栏'] })
    setupPlan([atRoot('a'), atRoot('b')])
    render(<ReviewStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: '书签 a' }))

    expect(screen.queryByText(/会保留目录/)).toBeNull()
  })

  // 反向：只有正向断言的话，一个「对所有未勾选的行都提示」的实现也会绿
  it('原目录里还有别的书签不走时，取消勾选不提示——那个目录本来就会活下来', async () => {
    setupPlan([row('a', ['01 前端'], 'llm'), row('b', ['01 前端'], 'llm')])
    render(<ReviewStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: '书签 a' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '书签 b' }))

    expect(screen.queryByText(/会保留目录/)).toBeNull()
  })
})
