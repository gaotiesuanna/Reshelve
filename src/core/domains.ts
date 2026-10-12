import type { BookmarkNode } from './ports'
import { sanitizeUrl } from './sanitize'

export interface WeightedUrl {
  url: string
  weight?: number
  title?: string
}

/** 标题里用来分隔「本页叫什么」和「这站叫什么」的符号，两侧都留了空白才算。 */
const TITLE_SEPARATOR = /\s[-–—·|:]\s/

function commonTail(a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1
  return a.slice(a.length - i)
}

/**
 * 一批同源页面共同的站点名。取不到就返回 undefined，界面退回显示 host。
 *
 * 标题全一样时整条就是名字——`墨析 · 小说拆解工作台` 里的分隔符是它自己名字的一部分，
 * 从那儿切一刀会把「墨析」切掉。
 *
 * 标题各不相同时才切：公共尾巴里第一个分隔符之后的那截才是站名。
 * 「授权管理 / 配置管理 / 数据导入管理 – TradingAgents-CN」的公共尾巴是
 * `管理 – TradingAgents-CN`，「管理」是这几页碰巧撞上的字，不是谁的名字，得切掉。
 * 公共尾巴里根本没有分隔符，那就整段都是撞上的字，一个名字也报不出来。
 */
export function siteName(titles: readonly string[]): string | undefined {
  const named = titles.map((title) => title.trim()).filter((title) => title !== '')
  // 一个页面证明不了站点叫什么，它的标题就是它自己的标题。要有第二个页面作证。
  if (named.length < 2) return undefined
  if (named.every((title) => title === named[0])) return named[0]

  const tail = named.reduce(commonTail)
  const separator = TITLE_SEPARATOR.exec(tail)
  if (separator === null) return undefined
  const name = tail.slice(separator.index + separator[0].length).trim()
  return name === '' ? undefined : name
}

export interface DomainRank {
  /**
   * 域名带端口，`localhost:5173` 与 `localhost:8501` 是两行。
   *
   * 看板不能按纯域名聚合：一台机器上常常跑着好几个项目，它们的 `/settings`、`/analysis`
   * 各是各的，叠进一棵树就成了两套路由的混合物，谁也读不出哪一段属于谁。
   * 端口才是它们的身份。默认端口(:80/:443)不写，普通网站看上去和以前一样。
   */
  domain: string
  /** 这个来源自称什么，见 siteName。取不到就没有，界面退回显示 domain。 */
  siteName?: string
  count: number
  sampleUrl: string
}

export const DEFAULT_TOP_DOMAINS = 15
export const TOP_DOMAIN_MIN = 1
export const TOP_DOMAIN_MAX = 50

/** 看板「显示前几名」的合法区间。非法存量、空输入都回落到默认 15。 */
export function clampTopDomainCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOP_DOMAINS
  const n = Math.round(value)
  if (n < TOP_DOMAIN_MIN) return TOP_DOMAIN_MIN
  if (n > TOP_DOMAIN_MAX) return TOP_DOMAIN_MAX
  return n
}

const DEFAULT_LIMIT = DEFAULT_TOP_DOMAINS

/**
 * 把 URL 按域名聚合成排行。
 *
 * weight 缺省为 1（一条书签算一次）；浏览记录把 visitCount 传进来。
 * 0 和负数丢掉——那不是一次真实出现。
 */
export function rankDomains(items: WeightedUrl[], limit = DEFAULT_LIMIT): DomainRank[] {
  const byDomain = new Map<string, DomainRank>()
  const titles = new Map<string, string[]>()
  for (const item of items) {
    const weight = item.weight ?? 1
    if (weight <= 0) continue
    const parsed = sanitizeUrl(item.url)
    if (parsed === null) continue
    titles.get(parsed.host)?.push(item.title ?? '') ?? titles.set(parsed.host, [item.title ?? ''])
    const existing = byDomain.get(parsed.host)
    if (existing === undefined) {
      byDomain.set(parsed.host, {
        domain: parsed.host,
        count: weight,
        sampleUrl: item.url,
      })
    } else {
      existing.count += weight
    }
  }
  return [...byDomain.values()]
    .map((row) => {
      const name = siteName(titles.get(row.domain) ?? [])
      return name === undefined ? row : { ...row, siteName: name }
    })
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, limit)
}

/** 整棵书签树里带 url 的节点，深度优先、保持树内顺序。 */
export function bookmarkUrls(tree: BookmarkNode[]): WeightedUrl[] {
  const out: WeightedUrl[] = []
  const walk = (node: BookmarkNode): void => {
    if (node.url !== undefined) {
      // 标题一并带上：排行榜要靠它认出这个来源自称什么。
      out.push({ url: node.url, title: node.title })
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  for (const node of tree) walk(node)
  return out
}

export interface DomainFolderNode {
  id: string
  title: string
  /** 该域名的书签在这个文件夹里 + 所有子孙里的总数。 */
  count: number
  /** 该域名的书签直接躺在这个文件夹里的数量（不含子孙）。 */
  directCount: number
  children: DomainFolderNode[]
  bookmarks: Array<{
    id: string
    title: string
    url: string
    weight?: number
    sourceUrls?: string[]
  }>
  /**
   * 这一段路径底下只有一个页面、再没有别的分支，界面直接画成页面行，不摆目录。
   * 只有访问记录那棵树会打这个标：段名就是 URL 里的那一截，和页面地址一字不差，
   * 单独成行等于把每条记录抄两遍。书签树的目录名是用户自己起的，吞掉就丢信息了。
   */
  pageOnly?: boolean
  /**
   * 这一行是并出来的，不是路径上真有的一段：点开才露出被并起来的页面。
   * 两种来路——同层的 ID 段并成一行，或者同一个来源里标题相同的页面收成一夹。
   *
   * 刚并出来时 title 是空的——它没有段名可用。父段要是自己没有页面、底下又只剩它一个，
   * 过道折叠会把父段的名字给它(`works`)，那之后它就有段名了，再往上按 `甲 / 乙` 正常接。
   */
  grouped?: true
}

/**
 * 某域名的书签在文件夹树上的分布结构。
 *
 * 返回修剪过的森林：只留含该域名书签（或子孙含）的文件夹，count 为 0 的剪掉。
 * 空标题的根节点不成行，其合格子节点上浮到本层。每层按 count 降序、同数按标题稳定。
 * 自己没有直接书签、又只有一个子文件夹的「过道文件夹」折叠成 `甲 / 乙` 一行，
 * 免得单链一路缩进。
 */
export function domainFolderTree(
  tree: BookmarkNode[],
  domain: string,
): DomainFolderNode[] {
  const matches = (url: string): boolean => {
    const parsed = sanitizeUrl(url)
    return parsed !== null && parsed.host === domain
  }

  const collapse = (node: DomainFolderNode): DomainFolderNode => {
    const only = node.children.length === 1 ? node.children[0] : undefined
    if (node.directCount === 0 && only !== undefined) {
      return {
        id: only.id,
        title: `${node.title} / ${only.title}`,
        count: only.count,
        directCount: only.directCount,
        children: only.children,
        bookmarks: only.bookmarks,
      }
    }
    return node
  }

  const forest = (nodes: BookmarkNode[]): DomainFolderNode[] => {
    const out: DomainFolderNode[] = []
    for (const node of nodes) {
      if (node.url !== undefined) continue
      const kids = forest(node.children ?? [])
      if (node.title === '') {
        out.push(...kids)
        continue
      }
      const directCount = (node.children ?? []).reduce(
        (n, child) => n + (child.url !== undefined && matches(child.url) ? 1 : 0),
        0,
      )
      const bookmarks = (node.children ?? []).flatMap((child) =>
        child.url !== undefined && matches(child.url)
          ? [{ id: child.id, title: child.title, url: child.url }]
          : [],
      )
      const count = directCount + kids.reduce((n, kid) => n + kid.count, 0)
      if (count === 0) continue
      out.push(collapse({ id: node.id, title: node.title, count, directCount, children: kids, bookmarks }))
    }
    return sortLevel(out)
  }

  return forest(tree)
}

/** 同一层按次数降序，同数按名字，排出来的顺序不随输入顺序漂。 */
function sortLevel(nodes: DomainFolderNode[]): DomainFolderNode[] {
  return [...nodes].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
}


function visitPageHref(raw: string): string {
  try {
    const url = new URL(raw)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return raw
  }
}

/** 展示层丢掉 query/hash 后相同的地址合成一条，访问次数相加。 */
function mergeVisitPages(pages: DomainFolderNode['bookmarks']): DomainFolderNode['bookmarks'] {
  const byPath = new Map<string, { page: DomainFolderNode['bookmarks'][number]; topWeight: number }>()
  for (const page of pages) {
    const parsed = sanitizeUrl(page.url)
    const key = parsed === null ? page.url : `${parsed.host}${parsed.path}`
    const weight = page.weight ?? 1
    const href = visitPageHref(page.url)
    const incoming = page.sourceUrls ?? [page.url]
    const existing = byPath.get(key)
    if (existing === undefined) {
      byPath.set(key, {
        page: { ...page, id: href, url: href, weight, sourceUrls: [...incoming] },
        topWeight: weight,
      })
      continue
    }
    existing.page.weight = (existing.page.weight ?? 1) + weight
    existing.page.sourceUrls = [...new Set([...(existing.page.sourceUrls ?? []), ...incoming])]
    if (weight > existing.topWeight) {
      existing.topWeight = weight
      existing.page.title = page.title
      existing.page.id = href
      existing.page.url = href
    }
  }
  return [...byPath.values()]
    .map((entry) => entry.page)
    .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.url.localeCompare(b.url))
}

export interface SavedVisit {
  /** 去掉 query/hash 后的展示地址，同时充当列表 key。 */
  id: string
  title: string
  url: string
  weight: number
  /** 书签所在的文件夹路径，从根往下。空数组表示直接躺在根目录。 */
  folderPath: string[]
  sourceUrls: string[]
}

export interface UnsavedVisit {
  id: string
  title: string
  url: string
  weight: number
  sourceUrls: string[]
}

export interface VisitSplit {
  /** 访问过、并且已经收进书签的页面，按访问次数降序。 */
  saved: SavedVisit[]
  /** 访问过但没收藏的页面。一行一个地址，不按路径收成文件夹。 */
  unsaved: UnsavedVisit[]
}

/**
 * 某域名的访问记录劈成「已收藏」「未收藏」两半。
 *
 * 收没收藏按 `域名+路径` 判断，和 mergeVisitPages 的合并口径一致：
 * 带 query/hash 的访问算命中同一条书签，不然同一个页面会两边各出现一次。
 * 已收藏那半给出文件夹路径。未收藏那半没有文件夹，一行一个页面。
 */
export function visitSplitTree(
  pages: readonly WeightedUrl[],
  tree: BookmarkNode[],
  domain: string,
): VisitSplit {
  const index = domainBookmarkIndex(tree, domain)
  const savedPages: DomainFolderNode['bookmarks'] = []
  const unsavedPages: DomainFolderNode['bookmarks'] = []
  for (const page of pages) {
    const weight = page.weight ?? 1
    if (weight <= 0) continue
    const parsed = sanitizeUrl(page.url)
    if (parsed === null || parsed.host !== domain) continue
    if (index.has(`${parsed.host}${parsed.path}`)) {
      savedPages.push({ id: page.url, title: page.title ?? '', url: page.url, weight })
    } else {
      unsavedPages.push({ id: page.url, title: page.title ?? '', url: page.url, weight })
    }
  }

  const saved = mergeVisitPages(savedPages).map((page) => {
    const parsed = sanitizeUrl(page.url)
    const entry = parsed === null ? undefined : index.get(`${parsed.host}${parsed.path}`)
    const bookmarkTitle = (entry?.title ?? '').trim()
    return {
      id: page.id,
      title: bookmarkTitle === '' ? page.title : bookmarkTitle,
      url: page.url,
      weight: page.weight ?? 1,
      folderPath: entry?.folderPath ?? [],
      sourceUrls: page.sourceUrls ?? [page.url],
    }
  })

  return { saved, unsaved: mergeVisitPages(unsavedPages).map((page) => ({
    id: page.id,
    title: page.title,
    url: page.url,
    weight: page.weight ?? 1,
    sourceUrls: page.sourceUrls ?? [page.url],
  })) }
}

export function historyUrlsForHost(items: readonly WeightedUrl[], domain: string): string[] {
  const urls: string[] = []
  for (const item of items) {
    const parsed = sanitizeUrl(item.url)
    if (parsed !== null && parsed.host === domain) urls.push(item.url)
  }
  return urls
}

/** 该节点及其子孙的展示页 id。夹本身的 id 不是页面 id。 */
export function pageIdsUnder(node: DomainFolderNode): string[] {
  return [
    ...node.bookmarks.map((page) => page.id),
    ...node.children.flatMap(pageIdsUnder),
  ]
}

/**
 * 选中展示行背后的原始历史地址。
 * 书签行的 sourceUrls 可能缺席，那时退回展示地址本身。
 */
export function sourceUrlsForPages(
  saved: readonly SavedVisit[],
  unsaved: readonly UnsavedVisit[],
  selectedIds: ReadonlySet<string>,
): string[] {
  const urls: string[] = []
  for (const page of saved) {
    if (selectedIds.has(page.id)) urls.push(...page.sourceUrls)
  }
  for (const page of unsaved) {
    if (selectedIds.has(page.id)) urls.push(...page.sourceUrls)
  }
  return [...new Set(urls)]
}

/**
 * 该域名的书签按 `域名+路径` 建索引，顺带记下所在文件夹路径。
 * 同一个地址收藏了多份时留深度优先遇到的第一条——排行榜不做去重仲裁。
 * 空标题的节点（书签树的根）不进路径。
 */
function domainBookmarkIndex(
  tree: BookmarkNode[],
  domain: string,
): Map<string, { title: string; folderPath: string[] }> {
  const index = new Map<string, { title: string; folderPath: string[] }>()
  const walk = (node: BookmarkNode, path: string[]): void => {
    if (node.url !== undefined) {
      const parsed = sanitizeUrl(node.url)
      if (parsed === null || parsed.host !== domain) return
      const key = `${parsed.host}${parsed.path}`
      if (!index.has(key)) index.set(key, { title: node.title, folderPath: path })
      return
    }
    const next = node.title === '' ? path : [...path, node.title]
    for (const child of node.children ?? []) walk(child, next)
  }
  for (const node of tree) walk(node, [])
  return index
}
