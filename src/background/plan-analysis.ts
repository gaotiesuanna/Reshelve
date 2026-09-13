import { t } from '@/i18n'
import { dropFallbackFromCandidates } from '@/core/audit'
import type { Locale } from '@/core/locale'
import { buildPlan, type FolderMoveSpec, type NewFolderSpec, type RenameFolderSpec } from '@/core/plan'
import { looseBookmarks, scanTree } from '@/core/scan'
import { buildCandidatesFromFolders } from '@/core/map'
import { DEFAULT_TITLE_RULE_IDS, planTitleRewrites } from '@/core/titles'
import type { Ports } from '@/core/ports'
import type { FolderItem, OrganizePlan, ScanResult } from '@/core/types'
import { clusterHomeless, dropAlreadyGrouped, planFallbackFolder, planNewFolders } from '@/core/newTopics'
import { loadCache, saveCache } from '@/storage/settings'
import { classifyBookmarks } from '@/llm/classify'
import { nameNewTopics } from '@/llm/folders'
import type { LlmClient } from '@/llm/client'
import type { EmitProgress } from './events'
import {
  appendMeasurementWarnings,
  collapseSameNameLayer,
  promoteFallbackLayer,
} from './rebuild'

/**
 * 归入现有模式的分析管线：计划装配到一半被打断时抛出的业务错误。
 * message 已是本地化文案，handlers 原样转成 { ok: false, error }。
 */
export class PlanAnalysisError extends Error {}

/** 用户取消：handlers 映射成 cancelled 终态，不算失败。 */
export class PlanCancelledError extends Error {}

/**
 * 只生成 GitHub 标题改名方案：不调模型、不建缓存连接、不产出移动操作。
 * 标题统一与目录整理相互独立，由自己的开关与规则集决定。
 */
export async function planTitleOnlyAnalysis(input: {
  ports: Ports
  scopeRootIds: string[]
  ruleIds?: string[]
  locale: Locale
  emit: EmitProgress
  now: () => number
}): Promise<OrganizePlan> {
  const log = (phase: 'scan' | 'classify', message: string): void =>
    input.emit({ phase, message })
  const tree = await input.ports.bookmarks.getTree()
  const scan = scanTree(tree, input.scopeRootIds)
  const titleRewrites = planTitleRewrites(
    scan.bookmarks,
    input.ruleIds ?? DEFAULT_TITLE_RULE_IDS,
  )
  log('scan', t('logScanDone', String(scan.stats.totalBookmarks), String(scan.stats.totalFolders)))
  if (titleRewrites.length > 0) {
    log('classify', t('logTitleRewrites', String(titleRewrites.length)))
  }
  const plan = buildPlan({
    id: `plan-${input.now()}`,
    createdAt: input.now(),
    scopeRootIds: input.scopeRootIds,
    rebuildStructure: false,
    titleOnly: true,
    totalBookmarks: scan.bookmarks.length,
    items: [],
    candidates: [],
    classifications: [],
    newFolders: [],
    titleRewrites,
  })
  log('classify', t('logAnalyzeDone', '0'))
  return plan
}

export interface PlanAdditiveInput {
  ports: Ports
  /** 已按 scopeRootIds 扫好的结果（与范围根目录列表配套）。 */
  scan: ScanResult
  /** findScopeRoots 去重过父子后的范围根（按书签树顺序，非用户点击顺序）。 */
  roots: FolderItem[]
  scopeRootIds: string[]
  locale: Locale
  llm: { baseUrl: string; model: string }
  client: LlmClient
  concurrency: number
  batchSize?: number
  /** 「只整理散落书签」：跳过的书签这一轮压根不看，也不进 plan。 */
  onlyLoose: boolean
  rewriteGithubTitles: boolean
  emit: EmitProgress
  isCancelled: () => boolean
  now: () => number
}

/**
 * 归入现有模式的完整分析管线：候选表 → 分类 → 「新主题无处可去」链条 →
 * 结构自检 → 组装 plan。
 *
 * 从 handlers 的 analyze 分支整体搬来（那里曾经 415 行，排序规则只活在散文注释里，
 * 与 rebuild.ts 各养了一份自检，警告去重只有一份做了）。错误以类型抛出：
 * PlanCancelledError → cancelled 终态；PlanAnalysisError → { ok: false }；
 * 其余照常上抛（信号中断、网络等非业务错误）。
 */
export async function planAdditiveAnalysis(input: PlanAdditiveInput): Promise<OrganizePlan> {
  const { scan, roots, locale } = input
  const log = (phase: 'scan' | 'classify' | 'tree', message: string, level?: 'info' | 'warn' | 'error'): void =>
    input.emit({ phase, message, level })
  const progress = (phase: 'classify') => (done: number, total: number): void =>
    input.emit({ phase, message: '', done, total })
  const CANCELLED = (): never => { throw new PlanCancelledError('cancelled') }

  const rootIds = new Set(roots.map((r) => r.id))

  // 候选目录要排除的是「范围根自己」，不是勾选界面级联勾上的整个 id 集合——
  // 勾书签栏会把它所有子目录的 id 也塞进 scopeRootIds，照单排除就是排除了一切，
  // 非推翻模式的候选表永远是空的（见 issues review C2）。roots 已经用
  // findScopeRoots 去重过父子，这里直接拿它的 id 集合。
  let candidates = buildCandidatesFromFolders(scan.folders, roots.map((r) => r.id))
  // 日志报「实际折叠掉几个」，不借用 scan.stats.duplicateFolderGroups——那是「组数」，
  // 范围根也算在内；候选却排除范围根，两个数字对不上（勾两个同名范围根时
  // stats 说 1 组、这里实际一个都没折叠）。用非根目录数减候选数，才是这次
  // buildCandidatesFromFolders 真的合并掉的数量。
  const nonRootFolderCount = scan.folders.length - roots.length
  const foldedCount = nonRootFolderCount - candidates.length
  if (foldedCount > 0) {
    log('scan', t('logDuplicateFolders', String(foldedCount)))
  }
  let newFolders: NewFolderSpec[] = []
  let renameFolders: RenameFolderSpec[] = []
  let folderMoves: FolderMoveSpec[] = []

  // 「归入现有」却一个候选目录都没有。自动判断下够不着：detectMode 在没有任何
  // 非根目录时判 rebuild，而候选恰恰就是那批非根目录（buildCandidatesFromFolders
  // 排除的同样是范围根）。今天只有显式传 modeOverride: 'additive' 才走得到这里，
  // 留着当兜底。
  // 文案原先写着「请开启「重建结构」」——那个开关已随模式自动判断一起删掉，不能再往回指。
  if (candidates.length === 0) {
    throw new PlanAnalysisError(t('errNoTargetFolders'))
  }

  // 「散落」= 直接挂在勾中的范围根底下，一层都没进——与 core/mode.ts 的
  // reasonLoose 同一把尺子。推翻模式本来就要从零设计整棵树，不存在「只处理
  // 一部分」这回事，所以这个开关只在归入现有模式下看。
  const onlyLoose = input.onlyLoose
  const toClassify = onlyLoose ? looseBookmarks(scan) : scan.bookmarks
  // 提前拦住、不建缓存连接也不建 client 请求：省的不只是一次没意义的
  // 「0 条书签的分类」空转，还替用户省下了本可以避免的一次模型调用判断。
  if (onlyLoose && toClassify.length === 0) {
    throw new PlanAnalysisError(t('errNoLooseBookmarks'))
  }
  const cache = await loadCache(input.ports)
  log('classify', t('logClassifyStart', String(toClassify.length), String(candidates.length)))
  if (onlyLoose) {
    log('classify', t('logClassifyLooseOnly', String(toClassify.length), String(scan.bookmarks.length - toClassify.length)))
  }
  // 归入现有模式下把范围根直属的「其他」挡在提示词外：它在候选表里就等于给了模型
  // 一个合法的出口，「无合适目录 → 带回 topic → 建新目录」那条链于是永远等不到输入
  // （见 core/audit.ts 的 dropFallbackFromCandidates）。剔的只是分类候选，
  // candidates 本身不动——「其他」还要当结构页的回落点、还要被 A5 量到。
  const classifyCandidates = dropFallbackFromCandidates(
    candidates, scan.folders, input.scopeRootIds, locale,
  )
  const llmResults = await classifyBookmarks({
    items: toClassify,
    candidates: classifyCandidates,
    client: input.client,
    cache,
    batchSize: input.batchSize,
    concurrency: input.concurrency,
    onProgress: progress('classify'),
    onLog: (message, level) => log('classify', message, level),
    isCancelled: input.isCancelled,
    locale,
    model: input.llm.model,
    includeTopicRule: true,
  })
  let classifications = [...llmResults]
  // 已经跑完的批次仍然写进缓存，重来时不必再花一次钱
  await saveCache(input.ports, cache)
  if (input.isCancelled()) return CANCELLED()

  // source === 'none' 只在请求失败或模型漏返回时出现——模型判定"无合适目录"
  // 走的是 source === 'llm' + targetCategoryId === null 这条路。这道全军覆没的
  // 判断要放在新建目录那一步之前：不然「N 本书签放不进已有目录」的日志会抢在
  // 真正的失败原因前面出现，看着像是新建目录那步自己出的错。
  const failed = llmResults.filter((c) => c.source === 'none')
  if (toClassify.length > 0 && failed.length === toClassify.length) {
    throw new PlanAnalysisError(t('errClassifyAllFailed', failed[0]!.reason))
  }

  // ---- 新主题无处可去：规则定量、模型只负责起名 ----
  {
    const allClusters = clusterHomeless(classifications)
    // 「已聚齐」这道幂等性闸赶在起名之前生效：命名要花一次模型请求，不该为
    // 注定被丢弃的簇破费（见 core/newTopics.ts 的 dropAlreadyGrouped）
    const clusters = dropAlreadyGrouped(allClusters, scan.bookmarks, scan.folders, rootIds)
    const droppedByGuard = allClusters.length - clusters.length
    if (droppedByGuard > 0) {
      log('tree', t('logNewFoldersGrouped', String(droppedByGuard)))
    }
    // 「已聚齐」丢弃的书签 targetCategoryId 同样是 null，但那不是「没地方去」，
    // 是「已经在正确的地方，不用再动」——下面的「其他」兜底不能把它们扫进去，
    // 否则会把 dropAlreadyGrouped 存在的理由（防 churn）原样破坏：第二轮把
    // 已经建好、已经落位的书签又判一次「无处可去」，churn 只是换了个目的地。
    const survivingKeys = new Set(clusters.map((c) => c.key))
    const alreadyGroupedIds = new Set(
      allClusters.filter((c) => !survivingKeys.has(c.key)).flatMap((c) => c.bookmarkIds),
    )
    // 只数模型真正判过的「无合适目录」，请求失败落下的 source: 'none' 不算——
    // 那批已经在上面的全军覆没判断里处理过了，这里再数进去只会让日志说谎
    const homelessCount = classifications.filter(
      (c) => c.targetCategoryId === null && c.source !== 'none',
    ).length
    if (clusters.length > 0) {
      log('tree', t('logNewFoldersStart', String(homelessCount)))
      const rootId = roots[0]?.id
      if (rootId === undefined) throw new PlanAnalysisError(t('errNoScope'))
      // 勾了多个范围根时新目录固定挂第一个——这是刻意的简化（见 issues review I2），
      // 但不能悄悄发生，用户该知道自己另一个范围根下的书签会被搬过来这一侧
      if (roots.length > 1) {
        log('tree', t('logNewFoldersMultiRoot', roots[0]!.title))
      }
      const names = await nameNewTopics(
        clusters,
        // 给全部范围根的直接子目录，不能只看新目录要挂的那一个根：漏了另一个根
        // 下的已有目录名，起名这步就可能撞出一个别处已经在用的名字
        scan.folders.filter((f) => f.parentId !== null && rootIds.has(f.parentId)).map((f) => f.title),
        input.client, locale,
        { onLog: (message, level) => log('tree', message, level) },
      )
      if (input.isCancelled()) return CANCELLED()
      // 撞名被 nameNewTopics 整簇跳过的，不能悄悄消失——不然「N 本书签无处可去」
      // 的日志后面跟着「新建 0 个目录」，用户看不出原因
      const nameSkipped = clusters.filter((c) => !names.has(c.key)).length
      if (nameSkipped > 0) {
        log('tree', t('logNewFoldersNameCollision', String(nameSkipped)))
      }
      const added = planNewFolders({
        clusters, names, rootId, folders: scan.folders, classifications, locale,
      })
      newFolders = [...newFolders, ...added.newFolders]
      candidates = [...candidates, ...added.candidates]
      classifications = added.classifications
      log('tree', t('logNewFoldersDone', String(added.newFolders.length), String(added.placedCount)))
      if (added.truncatedCount > 0) {
        log('tree', t('logNewFoldersCapped', String(added.truncatedCount)))
      }
    } else if (homelessCount > 0 && droppedByGuard === 0) {
      // droppedByGuard > 0 时上面已经说明过原因（已聚齐），这里不再重复一句
      // 「没有给出可用的主题名」——那会跟已聚齐的真实原因矛盾
      log('tree', t('logNewFoldersNone', String(homelessCount)))
    }

    // 上面这轮不管走哪条分支，仍可能有书签卡在 targetCategoryId === null——
    // 没给出可用主题名（走进了 logNewFoldersNone 那条）、命名撞名被跳过
    // （logNewFoldersNameCollision）、或超出同层上限被截断（logNewFoldersCapped）。
    // 「实在不行，就建一个文件夹叫做其他」：这里不区分成因，一视同仁地兜底，
    // 不再让任何书签原地不动（issues/42-loose-bookmark-always-lands-somewhere.md，
    // 正面推翻 issues/05-homeless-bookmarks.md 决定 2 的「非推翻模式不建其他」）。
    // alreadyGroupedIds 里的不算——那些是「已经在正确的地方」，不是「没地方去」。
    if (classifications.some((c) => (
      c.targetCategoryId === null && c.source !== 'none' && !alreadyGroupedIds.has(c.bookmarkId)
    ))) {
      const rootId = roots[0]?.id
      if (rootId === undefined) throw new PlanAnalysisError(t('errNoScope'))
      const fallback = planFallbackFolder({
        classifications, rootId, folders: scan.folders, newFolders, candidates, locale,
        excludeIds: alreadyGroupedIds,
      })
      if (fallback.newFolder !== null) newFolders = [...newFolders, fallback.newFolder]
      if (fallback.candidate !== null) candidates = [...candidates, fallback.candidate]
      classifications = fallback.classifications
      if (fallback.strandedCount > 0) {
        log('tree', t('logNewFoldersFallback', String(fallback.strandedCount)))
      }
    }
  }

  let warnings =
    failed.length > 0
      ? [
          t(
            'logClassifyFailed',
            String(failed.length),
            // detail 是 reason 剥掉「分类失败，保持原位：」这类双语前缀后的纯错误信息；
            // logClassifyFailed 自己的文案已经说过"分类失败"，不能再把整句 reason 塞进去重复一遍。
            failed[0]!.detail ?? failed[0]!.reason,
          ),
        ]
      : []

  // ---- 结构自检（与推翻模式共用，见 rebuild.ts）----
  // 顺序即契约：塌名 → 提族 → 量警告。塌名必须在前（塌完第 2 层升第 1 层，
  // 深度预算凭空多出一层）；提族改变一级目录数，所以量警告必须收尾。
  {
    const collapsed = collapseSameNameLayer({
      candidates, newFolders, classifications,
      existingFolders: scan.folders,
      locale,
      mergeRootTemporaryId: null,
    }, (message, level) => log('classify', message, level))
    candidates = collapsed.candidates
    newFolders = collapsed.newFolders
    classifications = collapsed.classifications

    const promotion = promoteFallbackLayer({
      candidates, newFolders, classifications,
      locale,
      rootIds: roots.map((r) => r.id),
      existingFolders: scan.folders.map((f) => ({ id: f.id, parentId: f.parentId, index: f.index })),
      scanBookmarks: scan.bookmarks,
    }, (message, level) => log('classify', message, level))
    candidates = promotion.candidates
    newFolders = promotion.newFolders
    classifications = promotion.classifications
    folderMoves = promotion.folderMoves
    warnings.push(...promotion.warnings)
  }
  appendMeasurementWarnings(warnings, candidates, classifications, newFolders, locale, scan.bookmarks.length)

  // 标题统一与目录整理相互独立：它由自己的开关决定，不受移动建议的勾选影响
  const titleRewrites = input.rewriteGithubTitles ? planTitleRewrites(scan.bookmarks) : []
  if (titleRewrites.length > 0) {
    log('classify', t('logTitleRewrites', String(titleRewrites.length)))
  }
  // 与 classifyRebuildDraft 同一条收尾：自检与提升可能让同一句话出现两次
  // （提族警告与量警告撞车、失败文案与后续重复），复核页去重后更干净。
  const uniqueWarnings = [...new Set(warnings)]
  const plan = buildPlan({
    id: `plan-${input.now()}`,
    createdAt: input.now(),
    scopeRootIds: input.scopeRootIds,
    rebuildStructure: false,
    // onlyLoose 时这两者不同：跳过的书签这一轮压根没被看过，不该顶着
    // 「分类失败」的名义出现在复核页——那会说一句假话。用 toClassify
    // 而不是 scan.bookmarks，跳过的书签就不出现在 plan 的任何一处。
    // onlyLoose 为 false 时两者是同一个引用，行为不变。
    items: toClassify,
    candidates,
    classifications,
    newFolders,
    renameFolders,
    warnings: uniqueWarnings,
    tags: [],
    folderMoves,
    titleRewrites,
  })
  for (const warning of uniqueWarnings) log('classify', warning, 'warn')
  log('classify', t('logAnalyzeDone', String(plan.rows.length)))
  return plan
}
