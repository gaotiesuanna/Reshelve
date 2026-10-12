import { describe, it, expect } from 'vitest'
import {
  bookmarkUrls,
  siteName,
  clampTopDomainCount,
  domainFolderTree,
  rankDomains,
  visitSplitTree,
  historyUrlsForHost,
  sourceUrlsForPages,
} from '@/core/domains'
import type { BookmarkNode } from '@/core/ports'

describe('rankDomains', () => {
  it('按域名聚合并按次数降序取前 N 个', () => {
    expect(rankDomains([
      { url: 'https://github.com/a' },
      { url: 'https://github.com/b' },
      { url: 'https://github.com/c' },
      { url: 'https://bilibili.com/1' },
      { url: 'https://example.com/' },
    ], 2)).toEqual([
      { domain: 'github.com', count: 3, sampleUrl: 'https://github.com/a' },
      { domain: 'bilibili.com', count: 1, sampleUrl: 'https://bilibili.com/1' },
    ])
  })

  it('www 与裸域算同一个域名', () => {
    expect(rankDomains([
      { url: 'https://www.github.com/a' },
      { url: 'https://github.com/b' },
    ])).toEqual([
      { domain: 'github.com', count: 2, sampleUrl: 'https://www.github.com/a' },
    ])
  })

  it('丢掉无法解析的和非 http(s) 的 URL', () => {
    expect(rankDomains([
      { url: 'javascript:alert(1)' },
      { url: 'chrome://extensions' },
      { url: 'not a url' },
      { url: 'https://ok.com/' },
    ])).toEqual([
      { domain: 'ok.com', count: 1, sampleUrl: 'https://ok.com/' },
    ])
  })

  it('把 weight 加总作为次数，缺省为 1', () => {
    expect(rankDomains([
      { url: 'https://github.com/a', weight: 10 },
      { url: 'https://github.com/b', weight: 5 },
      { url: 'https://example.com/', weight: 12 },
    ]).map((row) => [row.domain, row.count])).toEqual([
      ['github.com', 15],
      ['example.com', 12],
    ])
  })

  it('weight 为 0 或负数的项不计入', () => {
    expect(rankDomains([
      { url: 'https://a.com/', weight: 0 },
      { url: 'https://b.com/', weight: -3 },
      { url: 'https://c.com/' },
    ])).toEqual([
      { domain: 'c.com', count: 1, sampleUrl: 'https://c.com/' },
    ])
  })

  it('次数相同按域名升序，结果稳定', () => {
    expect(rankDomains([
      { url: 'https://zeta.com/' },
      { url: 'https://alpha.com/' },
    ]).map((row) => row.domain)).toEqual(['alpha.com', 'zeta.com'])
  })

  it('空列表返回空数组', () => {
    expect(rankDomains([])).toEqual([])
  })

  it('默认只留前 15 个域名', () => {
    const items = Array.from({ length: 18 }, (_, i) => ({
      url: `https://d${String(i).padStart(2, '0')}.com/`,
      weight: 18 - i,
    }))
    const ranked = rankDomains(items)
    expect(ranked).toHaveLength(15)
    expect(ranked[0]!.domain).toBe('d00.com')
    expect(ranked[14]!.domain).toBe('d14.com')
  })
})

describe('clampTopDomainCount', () => {
  it('缺省与非法值回落到 15', () => {
    expect(clampTopDomainCount(undefined)).toBe(15)
    expect(clampTopDomainCount(Number.NaN)).toBe(15)
    expect(clampTopDomainCount('8')).toBe(15)
  })

  it('小于下限按 1 收，大于上限按 50 收', () => {
    expect(clampTopDomainCount(0)).toBe(1)
    expect(clampTopDomainCount(-3)).toBe(1)
    expect(clampTopDomainCount(999)).toBe(50)
  })

  it('合法整数原样返回，小数四舍五入', () => {
    expect(clampTopDomainCount(8)).toBe(8)
    expect(clampTopDomainCount(8.4)).toBe(8)
    expect(clampTopDomainCount(8.6)).toBe(9)
  })
})

describe('bookmarkUrls', () => {
  it('从书签树抽出所有带 url 的节点，跳过文件夹', () => {
    const tree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: 'bar', children: [
          { id: '10', title: 'a', url: 'https://github.com/a' },
          { id: '11', title: 'folder', children: [
            { id: '110', title: 'b', url: 'https://example.com/b' },
          ]},
        ]},
      ]},
    ]
    expect(bookmarkUrls(tree)).toEqual([
      { url: 'https://github.com/a', title: 'a' },
      { url: 'https://example.com/b', title: 'b' },
    ])
  })

  it('深度优先保持树内顺序，先走完子树再处理下一个兄弟', () => {
    const tree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'a', title: 'a', url: 'https://a.com/' },
        { id: 'f', title: 'folder', children: [
          { id: 'b', title: 'b', url: 'https://b.com/' },
        ]},
        { id: 'c', title: 'c', url: 'https://c.com/' },
      ]},
    ]
    expect(bookmarkUrls(tree).map((item) => item.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
      'https://c.com/',
    ])
  })

  it('空树返回空数组', () => {
    expect(bookmarkUrls([])).toEqual([])
  })
})

describe('domainFolderTree', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: 'bar', title: '书签栏', children: [
        { id: 'dev', title: '开发', children: [
          { id: 'gh', title: 'GitHub', children: [
            { id: 'a', title: 'a', url: 'https://github.com/a' },
            { id: 'b', title: 'b', url: 'https://www.github.com/b' },
          ]},
        ]},
        { id: 'tmp', title: '临时', children: [
          { id: 'c', title: 'c', url: 'https://github.com/c' },
        ]},
        { id: 'd', title: 'd', url: 'https://bilibili.com/1' },
        { id: 'e', title: 'e', url: 'javascript:alert(1)' },
      ]},
      { id: 'other', title: '其他书签', children: [
        { id: 'f', title: 'f', url: 'https://github.com/f' },
      ]},
    ]},
  ]

  it('按文件夹层级建树，子孙数汇总到父级，过道文件夹折叠', () => {
    expect(domainFolderTree(tree, 'github.com')).toEqual([
      {
        id: 'bar', title: '书签栏', count: 3, directCount: 0, bookmarks: [], children: [
          {
            id: 'gh', title: '开发 / GitHub', count: 2, directCount: 2, children: [],
            bookmarks: [
              { id: 'a', title: 'a', url: 'https://github.com/a' },
              { id: 'b', title: 'b', url: 'https://www.github.com/b' },
            ],
          },
          {
            id: 'tmp', title: '临时', count: 1, directCount: 1, children: [],
            bookmarks: [{ id: 'c', title: 'c', url: 'https://github.com/c' }],
          },
        ],
      },
      {
        id: 'other', title: '其他书签', count: 1, directCount: 1, children: [],
        bookmarks: [{ id: 'f', title: 'f', url: 'https://github.com/f' }],
      },
    ])
  })

  it('每个文件夹带上其中的书签标题和 URL，保持树内顺序', () => {
    const gh = domainFolderTree(tree, 'github.com')[0]?.children.find((n) => n.id === 'gh')
    expect(gh?.bookmarks).toEqual([
      { id: 'a', title: 'a', url: 'https://github.com/a' },
      { id: 'b', title: 'b', url: 'https://www.github.com/b' },
    ])
  })

  it('www 与裸域计入同一 domain', () => {
    const [bar] = domainFolderTree(tree, 'github.com')
    expect(bar?.children[0]?.count).toBe(2)
  })

  it('根下书签落在根文件夹自己名下，空标题根不成行', () => {
    expect(domainFolderTree(tree, 'bilibili.com')).toEqual([
      {
        id: 'bar', title: '书签栏', count: 1, directCount: 1, children: [],
        bookmarks: [{ id: 'd', title: 'd', url: 'https://bilibili.com/1' }],
      },
    ])
  })

  it('同层按 count 降序，同数按标题稳定', () => {
    const tied: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'z', title: 'zeta', children: [
          { id: 'z1', title: 'z1', url: 'https://x.com/1' },
        ]},
        { id: 'a', title: 'alpha', children: [
          { id: 'a1', title: 'a1', url: 'https://x.com/2' },
        ]},
      ]},
    ]
    expect(domainFolderTree(tied, 'x.com').map((n) => n.title)).toEqual([
      'alpha',
      'zeta',
    ])
  })

  it('无关域名和非 http(s) 不进结果', () => {
    expect(domainFolderTree(tree, 'example.com')).toEqual([])
    expect(domainFolderTree(tree, 'javascript:alert(1)')).toEqual([])
  })

  it('根节点 count 等于该域名在树上的书签总数', () => {
    const total = domainFolderTree(tree, 'github.com').reduce((n, node) => n + node.count, 0)
    expect(total).toBe(4)
  })

  it('自己有书签又有子文件夹的分支不折叠，directCount 反映直接书签', () => {
    const mixed: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'p', title: '项目', children: [
          { id: 'p1', title: 'p1', url: 'https://x.com/1' },
          { id: 'sub', title: '子', children: [
            { id: 's1', title: 's1', url: 'https://x.com/2' },
          ]},
        ]},
      ]},
    ]
    expect(domainFolderTree(mixed, 'x.com')).toEqual([
      {
        id: 'p', title: '项目', count: 2, directCount: 1,
        bookmarks: [{ id: 'p1', title: 'p1', url: 'https://x.com/1' }],
        children: [
          {
            id: 'sub', title: '子', count: 1, directCount: 1, children: [],
            bookmarks: [{ id: 's1', title: 's1', url: 'https://x.com/2' }],
          },
        ],
      },
    ])
  })
})


describe('visitSplitTree', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: 'bar', title: '书签栏', children: [
        { id: 'dev', title: '开发', children: [
          { id: 'lib', title: '墨析 · 小说拆解工作台', url: 'https://localhost/analysis/library' },
        ]},
        { id: 'home', title: '首页', url: 'https://localhost/home' },
      ]},
    ]},
  ]

  it('已收藏的页面单列一段，带上所在文件夹路径', () => {
    const split = visitSplitTree([
      { url: 'https://localhost/analysis/library', title: 'Lib', weight: 502 },
      { url: 'https://localhost/home', title: 'Home', weight: 90 },
      { url: 'https://localhost/analysis/upload', title: 'Upload', weight: 62 },
    ], tree, 'localhost')

    expect(split.saved).toEqual([
      {
        id: 'https://localhost/analysis/library',
        title: '墨析 · 小说拆解工作台',
        url: 'https://localhost/analysis/library',
        weight: 502,
        folderPath: ['书签栏', '开发'],
        sourceUrls: ['https://localhost/analysis/library'],
      },
      {
        id: 'https://localhost/home',
        title: '首页',
        url: 'https://localhost/home',
        weight: 90,
        folderPath: ['书签栏'],
        sourceUrls: ['https://localhost/home'],
      },
    ])
  })

  it('没收藏的页面一行一个，不按路径收成文件夹', () => {
    const split = visitSplitTree([
      { url: 'https://localhost/analysis/library', title: 'Lib', weight: 13 },
      { url: 'https://localhost/analysis/upload', title: 'Upload', weight: 62 },
      { url: 'https://localhost/home', title: 'Home', weight: 8 },
    ], [], 'localhost')

    expect(split.unsaved.map((page) => page.url)).toEqual([
      'https://localhost/analysis/upload',
      'https://localhost/analysis/library',
      'https://localhost/home',
    ])
    expect(split.unsaved[0]).toEqual({
      id: 'https://localhost/analysis/upload',
      title: 'Upload',
      url: 'https://localhost/analysis/upload',
      weight: 62,
      sourceUrls: ['https://localhost/analysis/upload'],
    })
  })

  it('带 query/hash 的访问算命中同一条书签，次数合并', () => {
    const split = visitSplitTree([
      { url: 'https://localhost/analysis/library?tab=a', title: 'A', weight: 40 },
      { url: 'https://localhost/analysis/library', title: 'B', weight: 315 },
    ], tree, 'localhost')

    expect(split.saved).toHaveLength(1)
    expect(split.saved[0]?.weight).toBe(355)
    expect(split.unsaved).toEqual([])
  })

  it('躺在根目录的书签给空路径，其它域名和 0 次访问都丢掉', () => {
    const flat: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'x', title: '首页', url: 'https://localhost/home' },
      ]},
    ]
    const split = visitSplitTree([
      { url: 'https://localhost/home', title: 'Home', weight: 9 },
      { url: 'https://github.com/a', title: 'A', weight: 99 },
      { url: 'https://localhost/dead', title: 'Dead', weight: 0 },
    ], flat, 'localhost')

    expect(split.saved).toEqual([
      {
        id: 'https://localhost/home',
        title: '首页',
        url: 'https://localhost/home',
        weight: 9,
        folderPath: [],
        sourceUrls: ['https://localhost/home'],
      },
    ])
    expect(split.unsaved).toEqual([])
  })

  it('书签标题为空时退回访问记录里的页面标题', () => {
    const untitled: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'x', title: '   ', url: 'https://localhost/home' },
      ]},
    ]
    const split = visitSplitTree(
      [{ url: 'https://localhost/home', title: 'Home', weight: 4 }],
      untitled,
      'localhost',
    )

    expect(split.saved[0]?.title).toBe('Home')
  })

  it('query 变体并成一行，但 sourceUrls 留住每一条原始历史地址', () => {
    const split = visitSplitTree([
      { url: 'https://localhost/analysis/library?tab=a', title: 'A', weight: 40 },
      { url: 'https://localhost/analysis/library#section', title: 'B', weight: 10 },
      { url: 'https://localhost/analysis/library', title: 'Lib', weight: 5 },
    ], tree, 'localhost')

    expect(split.saved).toHaveLength(1)
    expect(split.saved[0]?.url).toBe('https://localhost/analysis/library')
    expect(split.saved[0]?.sourceUrls.sort()).toEqual([
      'https://localhost/analysis/library',
      'https://localhost/analysis/library#section',
      'https://localhost/analysis/library?tab=a',
    ])
  })

  it('未收藏的 query 变体并成一行，但 sourceUrls 留住每一条原始地址', () => {
    const split = visitSplitTree([
      { url: 'https://example.com/datasets?x=1', title: 'A', weight: 5 },
      { url: 'https://example.com/datasets#y', title: 'B', weight: 2 },
    ], [], 'example.com')

    expect(split.unsaved).toHaveLength(1)
    expect(split.unsaved[0]?.url).toBe('https://example.com/datasets')
    expect(split.unsaved[0]?.weight).toBe(7)
    expect(split.unsaved[0]?.sourceUrls.sort()).toEqual([
      'https://example.com/datasets#y',
      'https://example.com/datasets?x=1',
    ])
  })

  it('historyUrlsForHost 只收当前集合里 host 相同的原始 URL', () => {
    expect(historyUrlsForHost([
      { url: 'https://github.com/a', weight: 2 },
      { url: 'https://github.com/a?x=1', weight: 1 },
      { url: 'http://localhost:8501/settings', weight: 4 },
      { url: 'http://localhost:5629/home', weight: 9 },
      { url: 'javascript:alert(1)', weight: 1 },
    ], 'localhost:8501')).toEqual(['http://localhost:8501/settings'])
  })
})


describe('看板按来源聚合，端口算身份', () => {
  it('rankDomains 把一台机器上的两个端口排成两行', () => {
    expect(rankDomains([
      { url: 'http://localhost:5173/settings' },
      { url: 'http://localhost:5173/settings/tasks' },
      { url: 'http://localhost:8501/settings/license' },
    ])).toEqual([
      { domain: 'localhost:5173', count: 2, sampleUrl: 'http://localhost:5173/settings' },
      { domain: 'localhost:8501', count: 1, sampleUrl: 'http://localhost:8501/settings/license' },
    ])
  })

  it('普通网站没变——默认端口不成为另一个来源', () => {
    expect(rankDomains([
      { url: 'https://github.com/a' },
      { url: 'https://github.com:443/b' },
      { url: 'https://www.github.com/c' },
    ])).toEqual([
      { domain: 'github.com', count: 3, sampleUrl: 'https://github.com/a' },
    ])
  })


  it('visitSplitTree 也按端口分：另一个端口的书签不算这边收藏了', () => {
    const bookmarks: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'bar', title: '书签栏', children: [
          { id: 'a', title: '墨析设置', url: 'http://localhost:5173/settings' },
        ]},
      ]},
    ]
    const split = visitSplitTree([
      { url: 'http://localhost:8501/settings', title: '授权管理', weight: 4 },
    ], bookmarks, 'localhost:8501')

    expect(split.saved).toEqual([])
    expect(split.unsaved.map((page) => [page.title, page.weight])).toEqual([['授权管理', 4]])
  })

  it('domainFolderTree 按端口挑书签', () => {
    const bookmarks: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'bar', title: '书签栏', children: [
          { id: 'a', title: '墨析', url: 'http://localhost:5173/settings' },
          { id: 'b', title: '授权', url: 'http://localhost:8501/settings' },
        ]},
      ]},
    ]

    expect(domainFolderTree(bookmarks, 'localhost:8501').map((node) => [node.title, node.count]))
      .toEqual([['书签栏', 1]])
    expect(domainFolderTree(bookmarks, 'localhost:8501')[0]?.bookmarks.map((b) => b.id))
      .toEqual(['b'])
  })
})

describe('siteName', () => {
  it('同源页面标题全一样时，整条就是站点名', () => {
    expect(siteName([
      '墨析 · 小说拆解工作台',
      '墨析 · 小说拆解工作台',
      '墨析 · 小说拆解工作台',
    ])).toBe('墨析 · 小说拆解工作台')
  })

  it('标题各不相同时取分隔符后的公共尾段', () => {
    expect(siteName([
      '授权管理 – TradingAgents-CN',
      '配置管理 – TradingAgents-CN',
      '数据导入管理 – TradingAgents-CN',
    ])).toBe('TradingAgents-CN')
  })

  it('公共尾巴不落在分隔符上就不算站点名——「管理」不是谁的名字', () => {
    expect(siteName(['授权管理', '配置管理', '数据导入管理'])).toBeUndefined()
  })

  it('没有公共部分就没有名字', () => {
    expect(siteName(['GitHub', 'Stack Overflow'])).toBeUndefined()
  })

  it('空标题不参与——剩下不足两个就报不出名字', () => {
    expect(siteName(['', '  ', ''])).toBeUndefined()
    expect(siteName(['', '墨析 · 小说拆解工作台'])).toBeUndefined()
    expect(siteName(['', '墨析 · 小说拆解工作台', '墨析 · 小说拆解工作台']))
      .toBe('墨析 · 小说拆解工作台')
  })

  it('只有一个页面时不报名字——那是页面标题，不是站点名', () => {
    expect(siteName(['研究报告 – TradingAgents-CN'])).toBeUndefined()
  })
})

describe('rankDomains 的站点名', () => {
  it('排行榜每一行带上站点名，取不到就不给', () => {
    expect(rankDomains([
      { url: 'http://localhost:5629/home', title: '墨析 · 小说拆解工作台' },
      { url: 'http://localhost:5629/settings', title: '墨析 · 小说拆解工作台' },
      { url: 'https://github.com/a', title: 'sst/opencode' },
      { url: 'https://github.com/b', title: 'openai/codex' },
    ])).toEqual([
      // 并列时按域名字典序，github.com 在前
      { domain: 'github.com', count: 2, sampleUrl: 'https://github.com/a' },
      {
        domain: 'localhost:5629',
        siteName: '墨析 · 小说拆解工作台',
        count: 2,
        sampleUrl: 'http://localhost:5629/home',
      },
    ])
  })
})

describe('bookmarkUrls 带上标题', () => {
  it('书签栏那一侧也能报站点名', () => {
    const tree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'bar', title: '书签栏', children: [
          { id: 'a', title: '授权管理 – TradingAgents-CN', url: 'http://localhost:8501/settings/license' },
          { id: 'b', title: '配置管理 – TradingAgents-CN', url: 'http://localhost:8501/settings/config' },
        ]},
      ]},
    ]

    expect(bookmarkUrls(tree)).toEqual([
      { url: 'http://localhost:8501/settings/license', title: '授权管理 – TradingAgents-CN' },
      { url: 'http://localhost:8501/settings/config', title: '配置管理 – TradingAgents-CN' },
    ])
    expect(rankDomains(bookmarkUrls(tree))[0]?.siteName).toBe('TradingAgents-CN')
  })
})


describe('sourceUrlsForPages', () => {
  it('只展开选中的未收藏页面，不把同站其它地址算进去', () => {
    const split = visitSplitTree([
      { url: 'https://example.com/datasets?x=1', title: 'A', weight: 5 },
      { url: 'https://example.com/datasets#y', title: 'B', weight: 2 },
      { url: 'https://example.com/other', title: 'C', weight: 1 },
    ], [], 'example.com')
    const datasets = split.unsaved.find((page) => page.url === 'https://example.com/datasets')
    expect(datasets).toBeDefined()
    expect(sourceUrlsForPages([], split.unsaved, new Set([datasets!.id])).sort()).toEqual([
      'https://example.com/datasets#y',
      'https://example.com/datasets?x=1',
    ])
  })
})

