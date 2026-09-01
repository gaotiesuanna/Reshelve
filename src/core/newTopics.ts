import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import { folderNumber } from './order'
import type { NewFolderSpec } from './plan'
import { FALLBACK_TITLE, MAX_SIBLINGS } from './tree'
import type { BookmarkItem, CategoryCandidate, Classification, FolderItem } from './types'

/**
 * 同一主题攒够几条才值得开一个新目录。
 *
 * 曾经是 3：内部常量而不是设置项，理由是「用户无从判断 3 还是 5 更好」
 * （见 issues/08-settings-tradeoffs.md）。真实使用改判了这件事——用户直接反馈：
 * 攒不够 3 条就原地不动，等于一条散落书签永远没有归宿，用户要的是「每条都有地方去」，
 * 不是「够不够开一个专属目录」（见 issues/42-loose-bookmark-always-lands-somewhere.md）。
 * 改成 1 之后，任何一个能从模型那里问到独立主题名的书签都值得单独开一个目录；
 * `MAX_SIBLINGS` 已经把一次分析新建的目录数封了顶（`planNewFolders` 的 `chosen`），
 * 不会因为这里改成 1 就无限生长。真正连主题名都问不出来的，落到 `planFallbackFolder`
 * 那道最后的「其他」兜底，不会再原地不动。
 *
 * 与 `MIN_FOLDER_BOOKMARKS`（core/prune.ts）**依然不合并**：那个管「推翻模式下设计出来
 * 的目录装不满几条就撤掉」，是另一个模式的另一条规则，两边各自变化互不牵连。
 */
export const MIN_NEW_FOLDER_SIZE = 1

export interface TopicCluster {
  /** 归一化后的主题，用于合并同义写法。 */
  key: string
  /** 展示用的主题名：簇内出现次数最多的原始写法，已剥掉编号前缀。 */
  title: string
  /** 属于这一簇的书签 id，按输入顺序。 */
  bookmarkIds: string[]
}

/** 纯数字（含形如 1.2 的多段编号）的 topic 不算一个主题，见下方过滤说明。 */
const PURE_NUMBER = /^\d+(?:\.\d+)*$/

/**
 * 把「分不进任何已有目录」的书签按模型带回的主题聚成簇。
 *
 * 规则定量、模型只负责起名（见 issues/13-additive-mode-design.md）：这里只做确定性的
 * 归并与计数，不问模型「该不该建这个目录」——那会让同一类书签在不同批次里得到不同答案。
 *
 * 并行批次之间的标签本来就不保证一致，`normalizeName` 只能救回大小写、空白、下划线、
 * 连字符这一层的差异。「同一主题被拆成两个近义标签、于是都攒不够」是已知且可接受的
 * 失败——那时书签留在原地，不算错。同理，两个近义标签（「语音合成」与「TTS」）也可能
 * 各自都攒够下限，各建一个目录，没有消歧或合并的步骤——这种情况通常会在下一轮自愈：
 * 模型再遇到这两个目录时，倾向把书签都分进其中一个，另一个空了会被清理掉。
 *
 * 排序：先按簇大小降序，同样大小按首次出现顺序。同样的输入必须产出同样的树。
 */
export function clusterHomeless(
  classifications: Classification[],
  minSize: number = MIN_NEW_FOLDER_SIZE,
): TopicCluster[] {
  interface Bucket {
    key: string
    order: number
    bookmarkIds: string[]
    /** 原始写法 → 出现次数，用来挑一个展示名。 */
    titles: Map<string, number>
  }

  const buckets = new Map<string, Bucket>()
  for (const c of classifications) {
    // 只看无家可归的：有归属的书签不需要新目录
    if (c.targetCategoryId !== null) continue
    if (c.topic === undefined) continue
    const title = stripNumberPrefix(c.topic.trim()).trim()
    const key = normalizeName(title)
    // 空白的 topic 归一化后为空，纯数字（'01'、'2024'、'1.2' 剥完前缀剩下的 '2'）
    // 剥不动、trim 完也还在，得单独再挡一道——两种都当没给
    if (key === '' || PURE_NUMBER.test(title)) continue
    const bucket = buckets.get(key) ?? { key, order: buckets.size, bookmarkIds: [], titles: new Map<string, number>() }
    bucket.bookmarkIds.push(c.bookmarkId)
    bucket.titles.set(title, (bucket.titles.get(title) ?? 0) + 1)
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .filter((b) => b.bookmarkIds.length >= minSize)
    .sort((a, b) => b.bookmarkIds.length - a.bookmarkIds.length || a.order - b.order)
    .map((b) => ({
      key: b.key,
      // Map 保插入顺序，所以同票数时先出现的写法胜出
      title: [...b.titles.entries()].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0],
      bookmarkIds: b.bookmarkIds,
    }))
}

export interface PlanNewFoldersInput {
  clusters: TopicCluster[]
  /** 簇 key → 目录名，来自 llm/folders.ts 的 nameNewTopics。缺了这一项就跳过这个簇。 */
  names: Map<string, string>
  /** 新目录挂在这个目录下。一律范围根，不做「挂进语义最近的已有目录」。 */
  rootId: string
  folders: FolderItem[]
  classifications: Classification[]
  /** 落位理由要讲哪种语言。 */
  locale: Locale
}

export interface PlanNewFoldersResult {
  newFolders: NewFolderSpec[]
  candidates: CategoryCandidate[]
  classifications: Classification[]
  /** 实际落进新目录的书签数，供调用方记日志——不能再靠 clusters 的前缀去猜。 */
  placedCount: number
  /** 因为超过同层上限（MAX_SIBLINGS）而没能建目录的簇数，供调用方记日志。 */
  truncatedCount: number
}

/** 落位理由：讲清楚这条书签为什么进了这个目录，不能沿用模型「无合适目录」那句话。 */
function newFolderReason(locale: Locale, title: string): string {
  return locale === 'zh_CN' ? `新建「${title}」目录收纳` : `Placed in new folder "${title}"`
}

/**
 * 「已经独占一个目录」的簇不再建目录（幂等性第四道闸，见 issues review C1，
 * 以及二次复核对这道闸形状的收窄决定）。
 *
 * 只有当一个簇的成员**独占**一个已有目录——目录里除了它们什么都没有、也没有子目录，
 * 而且这个目录本身不是任何一个范围根——才判定「已聚齐」并丢弃这个簇：重新给它们建
 * 目录不会带来任何变化，只会白建一个新目录、把书签再搬一趟。这正是「模型持续判定
 * 无处可去」时会撞上的死循环——第一轮建了目录，第二轮模型又把同一批书签判成无归属、
 * 还是那个主题，如果照样建目录，产出的要么是同名兄弟要么是二次搬家，两种都是 churn。
 * 判定只看物理位置，不问模型这次给的 target_category_id 是不是 null——模型的判断
 * 本就是触发这个流程的原因，不能再拿它当收敛条件。
 *
 * 这道闸比「只要共享一个非根父目录就算聚齐」窄得多，是刻意收窄的：旧规则连用户自己的
 * 杂物目录（「杂项」「未分类」）也会当成「已聚齐」——那种目录通常混着不止一个主题，
 * 簇成员只是恰好也在里面，一旦命中就会让「从杂物目录里挑出主题」这个最常见的用法直接
 * 失效。窄化后，只有目录**恰好**只装着这一簇——也就是这条流程自己在上一轮建出来的
 * 目录——才会被拦。
 *
 * 收敛性说明：第一轮书签是散的（或跟别的东西混在一起），这道闸不命中，正常建目录；
 * 第二轮这些书签已经独居在新目录里，命中，什么都不做。如果后续又有第四本书签被分类
 * 进这个新目录，这道闸会在下一轮因为「目录里不止这一簇」而不再命中，原来的三本会被
 * 重新抽出来再建一次目录——这是刻意接受的代价：多一轮可界定的搬动，而不是无界的
 * churn。
 *
 * `rootIds` 必须是**全部**范围根，不能只传其中一个：书签散落在第二个范围根下时，
 * 拿它的 parentId 去跟单个根比较会误判成「挤在一个已有目录里」（见二次复核 I2）。
 *
 * 在命名（`nameNewTopics`）之前调用：命名要花一次模型请求，不该为注定被丢弃的簇
 * 破费，日志也该在丢弃的第一时间说清楚，而不是等命名结束后才说「新建 0 个目录」。
 */
export function dropAlreadyGrouped(
  clusters: TopicCluster[],
  bookmarks: BookmarkItem[],
  folders: FolderItem[],
  rootIds: Set<string>,
): TopicCluster[] {
  const parentByBookmark = new Map(bookmarks.map((b) => [b.id, b.parentId]))
  const folderIds = new Set(folders.map((f) => f.id))
  const parentsWithSubfolder = new Set(
    folders.flatMap((f) => (f.parentId === null ? [] : [f.parentId])),
  )
  const bookmarkCountByParent = new Map<string, number>()
  for (const b of bookmarks) {
    bookmarkCountByParent.set(b.parentId, (bookmarkCountByParent.get(b.parentId) ?? 0) + 1)
  }

  const isExclusivelyGrouped = (cluster: TopicCluster): boolean => {
    let parentId: string | undefined
    for (const id of cluster.bookmarkIds) {
      const p = parentByBookmark.get(id)
      // 找不到归属信息就不拦——宁可多建一次，也不能因为数据缺失误伤真正无处可去的书签
      if (p === undefined) return false
      if (parentId === undefined) parentId = p
      else if (parentId !== p) return false
    }
    if (parentId === undefined) return false
    // 是范围根本身：书签本来就散落在根下（哪个根都算），不算「已经聚齐」
    if (rootIds.has(parentId)) return false
    // 不在范围内的目录一律不拦
    if (!folderIds.has(parentId)) return false
    // 目录下还有子目录，不是簇独占的那种「纯净」目录
    if (parentsWithSubfolder.has(parentId)) return false
    // 前面的循环已经确认簇成员全部共享 parentId，这里只需比较数量：
    // 相等就说明目录里没有多余的书签，簇独占了它
    return bookmarkCountByParent.get(parentId) === cluster.bookmarkIds.length
  }

  return clusters.filter((c) => !isExclusivelyGrouped(c))
}

/**
 * 把主题簇变成「新建目录 + 书签落位」。
 *
 * 三条硬约束（见 issues/13-additive-mode-design.md）：
 *
 * 1. **一律挂在范围根下。** 不做「挂进语义最近的已有目录」——那正是 prune 现在掉进去的坑
 *    （只看父子不看语义），而且判错了不好发现。放错了用户自己拖一下就行。
 * 2. **编号跟随已有做法。** 范围根的直接子目录带编号就接着最大号往后编，都不带就不编。
 *    **绝不重排已有目录的号**——`renumberPlan` 在非推翻模式下直接返回，全树重排的路不走。
 * 3. **一个改名都不产出。** 新建目录这件事不能让任何已有目录改名，那是幂等性的最后一道闸。
 *
 * 落位是确定性的：簇成员直接进以它命名的目录，不再花一次重分类调用——那个目录本来就是
 * 按这批书签的主题起的名，再问一遍模型是同义反复。
 *
 * 传入的 `input.clusters` 已经在调用方经过 `dropAlreadyGrouped` 过滤——「已聚齐」这道
 * 幂等性闸不在这里，是因为它要赶在命名调用之前生效（见 `dropAlreadyGrouped` 的说明）。
 */
export function planNewFolders(input: PlanNewFoldersInput): PlanNewFoldersResult {
  const root = input.folders.find((f) => f.id === input.rootId)
  const rootPath = root === undefined ? [] : [...root.path, root.title]

  // 只看范围根的直接子目录：更深层的编号是别人的习惯，不代表这一层
  const siblings = input.folders.filter((f) => f.parentId === input.rootId)
  const numbers = siblings.map((f) => folderNumber(f.title)).filter((n): n is number => n !== null)
  const startNumber = numbers.length === 0 ? null : Math.floor(Math.max(...numbers)) + 1

  // 上限只约束本轮新建的：已有目录是用户的，撑爆了也只报告不改动。
  // 这里先用现成的同层上限兜住，清单第 5 项的形状推导落地后换成按 homeless 数量推导。
  const chosen = input.clusters.slice(0, MAX_SIBLINGS)
  const truncatedCount = Math.max(0, input.clusters.length - MAX_SIBLINGS)

  // 命名阶段撞名的簇会被跳过、拿不到名字（见 llm/folders.ts 的 nameNewTopics）：
  // 这些书签也留在原地，不拿簇自己的主题名兜底——那正是造出重名兄弟的老路
  const named = chosen.filter((c) => input.names.has(c.key))

  const newFolders: NewFolderSpec[] = []
  const candidates: CategoryCandidate[] = []
  const targetByBookmark = new Map<string, string>()
  const targetTitleByBookmark = new Map<string, string>()
  let placedCount = 0

  named.forEach((cluster, index) => {
    const name = input.names.get(cluster.key)!
    const title = startNumber === null
      ? name
      : `${String(startNumber + index).padStart(2, '0')} ${name}`
    const temporaryId = `new:${index + 1}`
    newFolders.push({ temporaryId, parentId: input.rootId, parentTemporaryId: null, title })
    candidates.push({ id: temporaryId, path: [...rootPath, title] })
    for (const bookmarkId of cluster.bookmarkIds) {
      targetByBookmark.set(bookmarkId, temporaryId)
      targetTitleByBookmark.set(bookmarkId, name)
    }
    placedCount += cluster.bookmarkIds.length
  })

  const classifications = input.classifications.map((c) => {
    const target = targetByBookmark.get(c.bookmarkId)
    if (target === undefined || c.targetCategoryId !== null) return c
    // topic 已经兑现成目录了，不再往下游传——留着会让复核页显示一个已经不成立的「无归属」
    const { topic: _topic, ...rest } = c
    return {
      ...rest,
      targetCategoryId: target,
      confidence: 1,
      reason: newFolderReason(input.locale, targetTitleByBookmark.get(c.bookmarkId)!),
    }
  })

  return { newFolders, candidates, classifications, placedCount, truncatedCount }
}

export interface PlanFallbackFolderInput {
  classifications: Classification[]
  rootId: string
  folders: FolderItem[]
  /** 这一轮已经新建的目录——找空号时要把它们也算进去，不能只看存量目录。 */
  newFolders: NewFolderSpec[]
  /** 已有候选，用来判断「其他」是不是已经存在——存在就并进去，不重复造一个近义兄弟。 */
  candidates: CategoryCandidate[]
  locale: Locale
  /**
   * 不算「卡住」的书签 id——目前唯一的成员是被 `dropAlreadyGrouped` 判定「已聚齐」
   * 的那些：它们的 `targetCategoryId` 同样是 `null`，但那不是「没地方去」，是
   * 「已经在正确的地方，不用再动」。这两种 `null` 看起来一样，成因完全相反，
   * 不拦住前者，「其他」就会把 dropAlreadyGrouped 存在的理由（防 churn）
   * 原样破坏——第二轮把已经建好、已经落位的书签又一次判定「无处可去」，
   * 这次改判进「其他」，churn 换了个目的地，没有真的被挡住。
   *
   * 必填而不给默认值 `new Set()`：漏传会让这道闸悄悄失效，那种 bug 编译器
   * 抓不到，必须由调用方每次显式回答（这一份 codebase 里 `beginRun` 的
   * `cancellable` 参数就是同一个理由不给默认值）。
   */
  excludeIds: Set<string>
}

export interface PlanFallbackFolderResult {
  /** 新建了才有值；并进已有「其他」时是 null。 */
  newFolder: NewFolderSpec | null
  candidate: CategoryCandidate | null
  classifications: Classification[]
  strandedCount: number
}

/**
 * 与 newFolderReason 分开：这条书签不是被判给了某个具体主题，措辞不能装作它是——
 * 「新建「其他」目录收纳」会让用户以为模型认出了「其他」这个主题，事实是它什么
 * 主题都没认出来。
 */
function fallbackFolderReason(locale: Locale): string {
  return locale === 'zh_CN'
    ? '没有可用的主题名，暂存进「其他」'
    : 'No usable topic name; placed in "Other" for now'
}

/**
 * 「实在不行，就建一个文件夹叫做其他」——`planNewFolders` 之后仍然
 * `targetCategoryId === null` 的书签，不再原地不动，一律收进一个跟其余目录同样
 * 编号的「其他」（见 issues/42-loose-bookmark-always-lands-somewhere.md）。
 *
 * 会落到这里的三种情况，这个函数不区分、一视同仁地兜底：
 * 1. 模型没给出任何可用主题（topic 为空、纯数字，被 `clusterHomeless` 直接滤掉）；
 * 2. 攒出了簇，但命名撞名被 `nameNewTopics` 跳过；
 * 3. 簇数超过 `MAX_SIBLINGS`，被 `planNewFolders` 截断。
 *
 * 与 issues/05-homeless-bookmarks.md 决定 2（「非推翻模式不建其他，原地不动」）
 * 正面冲突，是刻意推翻：那条决定成立的前提是「凭空造一个其他就是在动用户没同意
 * 改的结构」，但这里的「其他」不是凭空造的收容所——它是**问过模型、模型答不上来**
 * 之后的最后一道兜底，跟「无合适目录」在推翻模式下走的是同一件事，只是名字选了
 * 用户已经熟悉的那个词。
 */
export function planFallbackFolder(input: PlanFallbackFolderInput): PlanFallbackFolderResult {
  const stranded = input.classifications.filter(
    (c) => c.targetCategoryId === null && c.source !== 'none' && !input.excludeIds.has(c.bookmarkId),
  )
  if (stranded.length === 0) {
    return { newFolder: null, candidate: null, classifications: input.classifications, strandedCount: 0 }
  }

  const strandedIds = new Set(stranded.map((c) => c.bookmarkId))
  const place = (c: Classification, targetCategoryId: string): Classification => {
    // topic 已经兑现成目录了，不再往下游传——留着会让复核页显示一个已经不成立的「无归属」
    const { topic: _topic, ...rest } = c
    return { ...rest, targetCategoryId, confidence: 1, reason: fallbackFolderReason(input.locale) }
  }

  // 范围根下已经有一个「其他」——不管它是不是 Reshelve 自己建的——直接并进去，
  // 不再造一个近义的兄弟目录（「其他」和「20 其他」并排摆着没有任何意义）。
  // 只认真正挂在这个范围根下的：candidates 的路径不带 id，靠 folders 反查
  // 这条候选是不是 rootId 的直接子目录。
  const fallbackKey = normalizeName(FALLBACK_TITLE[input.locale])
  const existing = input.candidates.find((c) => (
    c.path.length === 1
    && normalizeName(stripNumberPrefix(c.path[0]!)) === fallbackKey
    && input.folders.some((f) => f.id === c.id && f.parentId === input.rootId)
  ))

  if (existing !== undefined) {
    const classifications = input.classifications.map((c) => (
      strandedIds.has(c.bookmarkId) ? place(c, existing.id) : c
    ))
    return { newFolder: null, candidate: null, classifications, strandedCount: stranded.length }
  }

  const root = input.folders.find((f) => f.id === input.rootId)
  const rootPath = root === undefined ? [] : [...root.path, root.title]

  // 接着「存量目录 + 这一轮新建的目录」两头一起的最大号往后编，只看存量会跟
  // planNewFolders 刚建出来的那些撞号。
  const existingNumbers = input.folders
    .filter((f) => f.parentId === input.rootId)
    .map((f) => folderNumber(f.title))
  const newNumbers = input.newFolders
    .filter((f) => f.parentId === input.rootId && f.parentTemporaryId === null)
    .map((f) => folderNumber(f.title))
  const numbers = [...existingNumbers, ...newNumbers].filter((n): n is number => n !== null)
  const nextNumber = numbers.length === 0 ? null : Math.floor(Math.max(...numbers)) + 1

  const name = FALLBACK_TITLE[input.locale]
  const title = nextNumber === null ? name : `${String(nextNumber).padStart(2, '0')} ${name}`
  const temporaryId = 'new:fallback'
  const newFolder: NewFolderSpec = { temporaryId, parentId: input.rootId, parentTemporaryId: null, title }
  const candidate: CategoryCandidate = { id: temporaryId, path: [...rootPath, title] }

  const classifications = input.classifications.map((c) => (
    strandedIds.has(c.bookmarkId) ? place(c, temporaryId) : c
  ))

  return { newFolder, candidate, classifications, strandedCount: stranded.length }
}
