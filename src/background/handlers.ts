import { currentLocale, resolveLocale, setLocale, t } from '@/i18n'
import { buildCandidatesFromFolders } from '@/core/map'
import {
  collapseSameNameFolders, dropFallbackFromCandidates,
  findOversizedFolders, measureFallbackShare, measureTopSiblings, promoteFallbackChildren,
} from '@/core/audit'
import type { Locale } from '@/core/locale'
import {
  applyReclassifyResults, buildPlan, type FolderMoveSpec, type NewFolderSpec, type RenameFolderSpec,
} from '@/core/plan'
import { findScopeRoots, looseBookmarks, scanTree } from '@/core/scan'
import { detectMode } from '@/core/mode'
import { DEFAULT_TITLE_RULE_IDS, planTitleRewrites } from '@/core/titles'
import { MAX_SIBLINGS as PRODUCT_MAX_SIBLINGS } from '@/core/tree'
import { FALLBACK_SHARE_LIMIT, SHAPE_MAX_SIBLINGS } from '@/core/shape'
import { clusterHomeless, dropAlreadyGrouped, planFallbackFolder, planNewFolders } from '@/core/newTopics'
import type { Ports } from '@/core/ports'
import type { CachedClassification, TagResult } from '@/core/types'
import { applyPlan } from '@/engine/apply'
import { applyCleanup, scanForCleanup } from '@/engine/cleanup'
import { aggregateBookmarks } from '@/engine/aggregate'
import { scanStaleBookmarks } from '@/engine/stale'
import { checkLinks } from '@/engine/linkCheck'
import { loadSnapshot } from '@/engine/snapshot'
import { undoLast } from '@/engine/undo'
import { createLlmClient, type LlmClient, type LlmConfig } from '@/llm/client'
import { isModelConfigured, llmConcurrency } from '@/llm/config'
import { listRemoteModels } from '@/llm/models'
import { probeModel } from '@/llm/probe'
import { classifyBookmarks } from '@/llm/classify'
import { nameNewTopics } from '@/llm/folders'
import {
  DEFAULT_SETTINGS, activeLlm, clearCache, loadCache, loadSettings, saveCache, saveSettings,
  findEndpoint,
} from '@/storage/settings'
import { findBookmarksBar } from '@/core/import'
import { importTree } from '@/engine/importTree'
import { moveBookmarks, MoveBookmarksError } from '@/engine/moveBookmarks'
import type { EmitProgress, ProgressPhase } from './events'
import type { Request, Response } from './messages'
import {
  classifyRebuildDraft,
  designRebuildDraft,
  InvalidStructureDraftError,
  isRebuildDraftFresh,
  RebuildCancelledError,
  RebuildClassificationError,
  staleRebuildDraftError,
  StaleStructureDraftError,
} from './rebuild'

export { deepenBudget } from './rebuild'

export interface HandlerDeps {
  createClient?: (config: LlmConfig, locale: Locale) => LlmClient
  now?: () => number
  /** 仅供测试注入，生产环境使用 classifyBookmarks 的默认值。 */
  batchSize?: number
  /** 把进度与日志推回侧栏。 */
  onEvent?: EmitProgress
  /** 用户是否点了取消。分析在批次之间检查它。 */
  isCancelled?: () => boolean
  /**
   * 整轮分析的取消信号，交给 LlmClient 去掐在飞的请求。
   *
   * 和 isCancelled 是两件事，缺一不可：isCancelled 只挡得住「还没发出去的下一批」，
   * 已经飞出去的那几个（最多 concurrency 个）只有 abort 掐得掉。少了它，用户点完
   * 取消要等当前批次自己跑完（见 llm/client.ts 的 runSignal）。
   */
  signal?: AbortSignal
  /** 列出端点上的模型。测试注入，生产走 GET /models。 */
  listModels?: (baseUrl: string, apiKey: string) => Promise<string[]>
  /** 仅供测试注入，生产环境使用 checkLinks 的默认值。 */
  fetchImpl?: typeof fetch
}

function describeMoveError(error: MoveBookmarksError): string {
  switch (error.code) {
    case 'emptySelection': return t('moveErrEmptySelection')
    case 'missingBookmark': return t('moveErrMissingBookmark')
    case 'missingTarget': return t('moveErrMissingTarget')
    case 'emptyFolderName': return t('moveErrEmptyFolderName')
    case 'missingParent': return t('moveErrMissingParent')
  }
}

export async function handle(
  ports: Ports,
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const createClient = deps.createClient
    ?? ((config: LlmConfig, locale: Locale) => createLlmClient(config, locale, undefined, deps.signal))
  const now = deps.now ?? (() => Date.now())
  const emit = deps.onEvent ?? ((): void => {})
  const log = (phase: ProgressPhase, message: string, level: 'info' | 'warn' | 'error' = 'info'): void =>
    emit({ phase, message, level })
  const progress = (phase: ProgressPhase) => (done: number, total: number): void =>
    emit({ phase, message: '', done, total })
  const isCancelled = deps.isCancelled ?? ((): boolean => false)
  // 每个请求进来先读设置再定语言：t() 是模块级状态，不先设好就会用上一次请求
  // 留下的语言。这一次读到的 settings 下面各分支直接复用，不重复读。
  // 读不到设置只该影响语言，不该把与设置无关的请求（get_tree/undo/import）一起打挂——
  // 那些请求改造前根本不碰存储，抛出去的还是没经过翻译的原文。
  const settings = await loadSettings(ports).catch(() => DEFAULT_SETTINGS)
  setLocale(resolveLocale(settings.uiLocale))
  // 这份 locale 是本次请求的常量，传给 core/llm 后不受后续 setLocale 影响：
  // 用户在分析跑到一半时改语言，产出的目录名、提示词、规则理由仍然同源；
  // 会跟着切的只有 t() 取的日志与错误文案，而且是剩下的整段分析都跟着切，
  // 不是一瞬——analyze 可以跑好几分钟。只影响文案，不产生半中半英的数据。
  const locale = currentLocale()
  const CANCELLED: Response = { ok: false, error: t('errAnalysisCancelled'), cancelled: true }

  try {
    switch (request.kind) {
      case 'get_tree':
        return { ok: true, kind: 'get_tree', tree: await ports.bookmarks.getTree() }

      case 'scan': {
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)
        log('scan', t('logScanDone', String(scan.stats.totalBookmarks), String(scan.stats.totalFolders)))
        return { ok: true, kind: 'scan', scan }
      }

      case 'analyze': {
        if (request.titleOnly === true) {
          const tree = await ports.bookmarks.getTree()
          const scan = scanTree(tree, request.scopeRootIds)
          const titleRewrites = planTitleRewrites(
            scan.bookmarks,
            request.ruleIds ?? DEFAULT_TITLE_RULE_IDS,
          )
          log('scan', t('logScanDone', String(scan.stats.totalBookmarks), String(scan.stats.totalFolders)))
          if (titleRewrites.length > 0) {
            log('classify', t('logTitleRewrites', String(titleRewrites.length)))
          }
          const plan = buildPlan({
            id: `plan-${now()}`,
            createdAt: now(),
            scopeRootIds: request.scopeRootIds,
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
          return { ok: true, kind: 'analyze', outcome: 'plan', plan }
        }
        // 本机模型服务器不校验 Key，所以这里问的是「模型配好了没有」而不是「有没有 Key」，
        // 与选范围页、偏好页共用同一个谓词——三处各判各的时，本地 Ollama 用户会被卡在
        // 一个界面已经放行、后台仍然拒收的缝里
        const llm = activeLlm(settings)
        if (!isModelConfigured(llm)) {
          return { ok: false, error: t('errNoApiKey') }
        }
        const concurrency = llmConcurrency(llm.baseUrl)
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)
        // findScopeRoots 按书签树顺序返回，确定性；
        // 直接取 scopeRootIds[0] 拿到的是用户的点击顺序，先点子目录时甚至不是真正的根
        const roots = findScopeRoots(tree, request.scopeRootIds).flatMap((root) => {
          const folder = scan.folders.find((candidate) => candidate.id === root.id)
          return folder === undefined ? [] : [folder]
        })

        // 走哪条路由产品自己判，不推给用户拨开关（见 issues/14-mode-detection.md）。
        // 判断只看这次扫描的结果，与设置无关；用户在偏好页推翻时才带 modeOverride 过来。
        const decision = detectMode(scan, locale)
        const rebuild = (request.modeOverride ?? decision.mode) === 'rebuild'
        // 日志跟着实际走的模式说话，不跟着「是否推翻」说话——modeOverride 的类型两个
        // 方向都收得下（后台自身的测试大量靠传 'additive' 把模式钉死），一旦只认
        // 「带了 override 就说重新设计」，传 'additive' 的调用点就会让这行日志说假话。
        // 推翻时把原判断的理由也缀上，方便用户事后翻日志看出自己否掉了什么、凭什么。
        log('scan', request.modeOverride !== undefined
          ? t(rebuild ? 'logModeOverriddenRebuild' : 'logModeOverriddenAdditive', decision.reason)
          : t(decision.mode === 'rebuild' ? 'logModeRebuild' : 'logModeAdditive', decision.reason))

        const client = createClient(llm, locale)
        if (rebuild) {
          const destinationRootId = roots[0]?.id
          if (destinationRootId === undefined) return { ok: false, error: t('errNoScope') }
          try {
            const createdAt = now()
            const draft = await designRebuildDraft({
              id: `structure-${createdAt}`,
              createdAt,
              scopeRootIds: request.scopeRootIds,
              destinationRootId,
              locale,
              llm: { baseUrl: llm.baseUrl, model: llm.model },
              rewriteGithubTitles: settings.rewriteGithubTitles,
              scan,
              roots,
              client,
              concurrency,
              batchSize: deps.batchSize,
              emit,
              isCancelled,
            })
            return { ok: true, kind: 'analyze', outcome: 'structure', draft }
          } catch (error) {
            if (error instanceof RebuildCancelledError) return CANCELLED
            throw error
          }
        }
        // 候选目录要排除的是「范围根自己」，不是勾选界面级联勾上的整个 id 集合——
        // 勾书签栏会把它所有子目录的 id 也塞进 scopeRootIds，照单排除就是排除了一切，
        // 非推翻模式的候选表永远是空的（见 issues review C2）。roots 已经用
        // findScopeRoots 去重过父子，这里直接拿它的 id 集合。
        let candidates = buildCandidatesFromFolders(scan.folders, roots.map((r) => r.id))
        // 日志报「实际折叠掉几个」，不借用 scan.stats.duplicateFolderGroups——那是「组数」，
        // 范围根也算在内；候选却排除范围根，两个数字对不上（勾两个同名范围根时
        // stats 说 1 组、这里实际一个都没折叠）。用非根目录数减候选数，才是这次
        // buildCandidatesFromFolders 真的合并掉的数量。
        // 只在归入现有模式下打：推翻模式的候选来自下面的 buildCategoryTree，根本不经过
        // buildCandidatesFromFolders（这里算出的 candidates 会在 rebuild 分支里被整个
        // 覆盖），在那条路上打这句话说的是另一条代码路径发生的事，会误导用户。
        const nonRootFolderCount = scan.folders.length - roots.length
        const foldedCount = nonRootFolderCount - candidates.length
        if (foldedCount > 0) {
          log('scan', t('logDuplicateFolders', String(foldedCount)))
        }
        let newFolders: NewFolderSpec[] = []
        let renameFolders: RenameFolderSpec[] = []
        let folderMoves: FolderMoveSpec[] = []
        const tags: TagResult[] = []

        // 「归入现有」却一个候选目录都没有。自动判断下够不着：detectMode 在没有任何
        // 非根目录时判 rebuild，而候选恰恰就是那批非根目录（buildCandidatesFromFolders
        // 排除的同样是范围根）。今天只有显式传 modeOverride: 'additive' 才走得到这里，
        // 留着当兜底。
        // 文案原先写着「请开启「重建结构」」——那个开关已随模式自动判断一起删掉，不能再往回指。
        if (candidates.length === 0) {
          return { ok: false, error: t('errNoTargetFolders') }
        }
        // 「散落」= 直接挂在勾中的范围根底下，一层都没进——与 core/mode.ts 的
        // reasonLoose 同一把尺子。只在非推翻模式下看这个开关：推翻模式本来就要
        // 从零设计整棵树，不存在「只处理一部分」这回事。
        const rootIds = new Set(roots.map((r) => r.id))
        const onlyLoose = settings.onlyLooseInAdditive
        const toClassify = onlyLoose ? looseBookmarks(scan) : scan.bookmarks
        // 提前拦住、不建缓存连接也不建 client 请求：省的不只是一次没意义的
        // 「0 条书签的分类」空转，还替用户省下了本可以避免的一次模型调用判断。
        if (onlyLoose && toClassify.length === 0) {
          return { ok: false, error: t('errNoLooseBookmarks') }
        }
        const cache = await loadCache(ports)
        log('classify', t('logClassifyStart', String(toClassify.length), String(candidates.length)))
        if (onlyLoose) {
          log('classify', t('logClassifyLooseOnly', String(toClassify.length), String(scan.bookmarks.length - toClassify.length)))
        }
        // 归入现有模式下把范围根直属的「其他」挡在提示词外：它在候选表里就等于给了模型
        // 一个合法的出口，「无合适目录 → 带回 topic → 建新目录」那条链于是永远等不到输入
        // （见 core/audit.ts 的 dropFallbackFromCandidates）。剔的只是分类候选，
        // candidates 本身不动——「其他」还要当结构页的回落点、还要被 A5 量到。
        const classifyCandidates = dropFallbackFromCandidates(
          candidates, scan.folders, request.scopeRootIds, locale,
        )
        // 推翻模式的候选是刚设计出来的，模型永远找得到归属，用不上「无合适目录时
        // 带回 topic」这条规则；让它的分类提示词继续保持这个工作流存在之前的样子，
        // 一个字节都不因为新增的非推翻建目录能力而改变（见 issues review M9）。
        const llmResults = await classifyBookmarks({
          items: toClassify,
          candidates: classifyCandidates,
          client,
          cache,
          batchSize: deps.batchSize,
          concurrency,
          onProgress: progress('classify'),
          onLog: (message, level) => log('classify', message, level),
          isCancelled,
          locale,
          model: llm.model,
          includeTopicRule: true,
        })
        let classifications = [...llmResults]
        // 已经跑完的批次仍然写进缓存，重来时不必再花一次钱
        await saveCache(ports, cache)
        if (isCancelled()) return CANCELLED

        // source === 'none' 只在请求失败或模型漏返回时出现——模型判定"无合适目录"
        // 走的是 source === 'llm' + targetCategoryId === null 这条路。这道全军覆没的
        // 判断要放在新建目录那一步之前：不然「N 本书签放不进已有目录」的日志会抢在
        // 真正的失败原因前面出现，看着像是新建目录那步自己出的错。
        const failed = llmResults.filter((c) => c.source === 'none')
        if (toClassify.length > 0 && failed.length === toClassify.length) {
          return {
            ok: false,
            error: t('errClassifyAllFailed', failed[0]!.reason),
          }
        }

        // 非推翻模式补上「新主题无处可去」这一块：规则定量、模型只负责起名。
        // 推翻模式不走这里——那条路的候选本来就是刚设计出来的，不存在放不进去。
        if (!rebuild) {
          // rootIds 已经在上面为 onlyLoose 那道判断算过一次，这里直接复用同一份。
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
            if (rootId === undefined) return { ok: false, error: t('errNoScope') }
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
              client, locale,
              { onLog: (message, level) => log('tree', message, level) },
            )
            if (isCancelled()) return CANCELLED
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
            if (rootId === undefined) return { ok: false, error: t('errNoScope') }
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
        // 目录下限的最后一道：前两道只能按标签数预估，书签最终落在哪个目录是刚才那步定的。
        // 只在推翻重建模式下做——非推翻模式的候选目录全是用户自己的，一个都不该撤。

        // ---- 结构自检其一：塌掉与上层同名的穿透层 ----
        // 不分模式跑：非推翻模式下 core/newTopics.ts 同样会在范围根下建新目录，
        // 同名套娃是同一个 bug。只动 newFolders 里的目录，用户自己的目录一根手指都不碰。
        // 必须排在下切之前——塌完之后原本第 2 层的目录升到第 1 层，深度预算凭空多出一层。
        {
          const collapsed = collapseSameNameFolders({
            candidates, newFolders, classifications,
            existingFolders: scan.folders,
            mergeRootTemporaryId: null,
          })
          candidates = collapsed.candidates
          newFolders = collapsed.newFolders
          classifications = collapsed.classifications
          if (collapsed.collapsedTitles.length > 0) {
            log('classify', t('logReviewCollapsed', String(collapsed.collapsedTitles.length)))
          }
        }

        // ---- 结构自检其二：撑爆的叶子再切一层 ----
        // MAX_LEAF 这条判准此前只在 core/shape.ts 里对**书签总数**用过一次，用来推导
        // 该分几层——形状是开工前一次性预测的，从来没有对实际落成的目录验算过。
        // 这里是第一次验算，也是唯一一处会因为「产出不达标」再花钱的地方。
        //
        // 只在推翻重建模式下跑：非推翻模式的承诺是「不重新设计结构」，往用户自己的
        // 目录里塞新子目录会破这条承诺，改为只出警告（见本块末尾）。

        // ---- 结构自检其三：把「其他」切出来的族提到一级 ----
        // 「其他」是收容所，不应成为主题目录的父级。推翻模式下处理本轮新建的
        // 子目录；归入现有模式下则生成 move_folder，把已有子目录整体移到范围根。
        {
          const bookmarkCountByFolder = new Map<string, number>()
          for (const bookmark of scan.bookmarks) {
            bookmarkCountByFolder.set(
              bookmark.parentId,
              (bookmarkCountByFolder.get(bookmark.parentId) ?? 0) + 1,
            )
          }
          const promotion = promoteFallbackChildren({
            candidates,
            newFolders,
            classifications,
            locale,
            rootIds: roots.map((r) => r.id),
            existingFolders: scan.folders.map((f) => ({
              id: f.id, parentId: f.parentId, index: f.index,
            })),
            bookmarkCountByFolder,
          })
          candidates = promotion.candidates
          newFolders = promotion.newFolders
          classifications = promotion.classifications
          folderMoves = promotion.folderMoves
          warnings.push(...promotion.warnings)
          for (const warning of promotion.warnings) log('classify', warning, 'warn')
          if (promotion.promoted.length > 0) {
            const detail = promotion.promoted
              .map((p) => (locale === 'zh_CN' ? `「${p.title}」${p.count} 条` : `"${p.title}" (${p.count})`))
              .join(locale === 'zh_CN' ? '、' : ', ')
            log('classify', t('logPromotedFallback', String(promotion.promoted.length), detail))
          }
        }

        // 判准 A3：一级目录有几个。此前只有设计/建树期的执行点，落成之后没人再数——
        // 而上面那步提升恰恰是在验算阶段改变一级目录数的。不补这一道，提升就是又造一个
        // 「产出了状态但没人验算」的洞，而那正是本轮要治的病（07 票判准 A 的挂钩条件）。
        // 两档要分开报：判准嫌多，和产品自己的闸都没拦住，性质不同（判准 B）。
        const topSiblings = measureTopSiblings(candidates)
        if (topSiblings !== null) {
          warnings.push(topSiblings.tier === 'product'
            ? t('warnTopSiblingsProduct', String(topSiblings.count), String(PRODUCT_MAX_SIBLINGS))
            : t('warnTopSiblingsJudgment', String(topSiblings.count), String(SHAPE_MAX_SIBLINGS)))
        }

        // 封顶之后仍然偏大的目录只点名、不动手：给用户一条看得见的信息，
        // 好过在四层菜单里给他一个「技术上正确」的树。非推翻模式下这是唯一的动作。
        for (const folder of findOversizedFolders({
          candidates, newFolders, classifications, locale,
          // 两种模式都用 'all'：推翻模式下切完之后仍然偏大的目录里也可能有复用的那种，
          // 上面的下切循环既然已经看得见它们，这条收尾警告就不该再瞎一只眼（03 票）。
          scope: 'all',
          maxLevel: Number.MAX_SAFE_INTEGER,
        })) {
          // 两种触发原因的说法完全不同：留守那种没有越过任何上限，套「超过建议上限」
          // 的文案会说出一句自相矛盾的话（04 票判准 C：这个状态要如实上报）
          warnings.push(folder.kind === 'leftovers'
            ? t('warnStrandedLeftovers', folder.title, String(folder.count))
            : t('warnOversizedFolder', folder.title, String(folder.count)))
        }

        // 判准 A5：「其他」整个子树占了范围内多大比例。此前**全链路一个执行点都没有**——
        // 真实那一遍的 34.8% 没有任何人算过，用户看到的是一棵没有任何警告的树。
        //
        // 动作是「量 + 如实告知」，不是阻断、也不是回头重设计（05 票判准 A/B）：钱已经花了、
        // 树已经生成，把东西收走换不到任何他能行动的东西；而破线的树并非不可用，
        // 只是顶层在说谎。真正的治法在上游（预算与落位），不在这一步。
        // 文案必须带上具体数字——没有数字，这条警告只是句空话（05 票判准 C）。
        const fallbackShare = measureFallbackShare({
          candidates, classifications, locale, total: scan.bookmarks.length,
        })
        if (fallbackShare !== null && fallbackShare.share > FALLBACK_SHARE_LIMIT) {
          warnings.push(t(
            'warnFallbackShare',
            String(fallbackShare.count),
            (fallbackShare.share * 100).toFixed(1),
            String(FALLBACK_SHARE_LIMIT * 100),
          ))
        }

        // 标题统一与目录整理相互独立：它由自己的开关决定，不受移动建议的勾选影响
        const titleRewrites = settings.rewriteGithubTitles
          ? planTitleRewrites(scan.bookmarks)
          : []
        if (titleRewrites.length > 0) {
          log('classify', t('logTitleRewrites', String(titleRewrites.length)))
        }
        const plan = buildPlan({
          id: `plan-${now()}`,
          createdAt: now(),
          scopeRootIds: request.scopeRootIds,
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
          warnings,
          tags,
          folderMoves,
          titleRewrites,
        })
        for (const warning of warnings) log('classify', warning, 'warn')
        log('classify', t('logAnalyzeDone', String(plan.rows.length)))
        return { ok: true, kind: 'analyze', outcome: 'plan', plan }
      }

      case 'classify_structure': {
        const draftLocale = request.draft.locale
        setLocale(draftLocale)
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.draft.scopeRootIds)
        const roots = findScopeRoots(tree, request.draft.scopeRootIds).flatMap((root) => {
          const folder = scan.folders.find((candidate) => candidate.id === root.id)
          return folder === undefined ? [] : [folder]
        })
        if (!isRebuildDraftFresh(request.draft, scan, roots)) {
          return { ok: false, error: staleRebuildDraftError(draftLocale).message }
        }

        const endpoint = findEndpoint(settings, request.draft.llm.baseUrl)
        const llm: LlmConfig | null = endpoint !== null && endpoint.models.includes(request.draft.llm.model)
          ? { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, model: request.draft.llm.model }
          : null
        if (llm === null || !isModelConfigured(llm)) {
          return {
            ok: false,
            error: draftLocale === 'zh_CN'
              ? '结构草案使用的模型配置已失效，请返回偏好页重新生成结构'
              : 'The model configuration used by this draft is no longer available. Return to Preferences and regenerate the structure.',
          }
        }

        const cache = await loadCache(ports)
        try {
          const plan = await classifyRebuildDraft({
            draft: request.draft,
            edits: request.edits,
            locale: draftLocale,
            scan,
            roots,
            client: createClient(llm, draftLocale),
            concurrency: llmConcurrency(llm.baseUrl),
            batchSize: deps.batchSize,
            emit,
            isCancelled,
            cache,
          })
          return { ok: true, kind: 'classify_structure', plan }
        } catch (error) {
          if (error instanceof RebuildCancelledError) return CANCELLED
          if (
            error instanceof StaleStructureDraftError ||
            error instanceof InvalidStructureDraftError ||
            error instanceof RebuildClassificationError
          ) {
            return { ok: false, error: error.message }
          }
          throw error
        } finally {
          // 已完成的批次即使随后取消或失败也保留，重试不重复花钱。
          await saveCache(ports, cache)
        }
      }

      case 'reclassify': {
        const llm = activeLlm(settings)
        if (!isModelConfigured(llm)) {
          return { ok: false, error: t('errNoApiKey') }
        }
        const concurrency = llmConcurrency(llm.baseUrl)
        // 重新扫一遍而不是信侧栏传来的 plan 里那份旧数据：书签的 parentId/index/
        // currentPath 得是这一刻的真实值，classifyBookmarks 要拿它们拼提示词。
        // plan 本身仍然以侧栏传来的为准——那是这次要贴回去的底子，重新分析一份
        // 后台自己现算的 plan 是另一件事，不该在这里顺手做。
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.plan.scopeRootIds)
        const requestedIds = new Set(request.bookmarkIds)
        const items = scan.bookmarks.filter((b) => requestedIds.has(b.id))
        // 选中的书签这一刻一条都找不到了（多半是在复核页开着的时候被手动删掉/挪走）：
        // 没有东西可问，原样把 plan 退回去，不报错——用户等的这次操作对哪些书签
        // 都没起作用，不代表整个请求失败了
        if (items.length === 0) {
          return { ok: true, kind: 'reclassify', plan: request.plan }
        }
        // 「排除它当前的目标目录」是这个功能的全部意义：不排除的话，同一批候选、
        // 同一个模型，大概率原样把上次那个不满意的答案再报一遍。选中的书签各自
        // 目标可能不同，这里排除的是它们目标的并集——被排除的目录对这一批里的
        // 每一条都不再是选项，包括本来目标就是它、以及本来目标是另一条候选目录
        // 但那条恰好也在这批排除名单里的情形。
        const excludedTargetIds = new Set(
          request.plan.rows.filter((r) => requestedIds.has(r.bookmarkId)).map((r) => r.toCategoryId),
        )
        const excludedCandidates = request.plan.candidates.filter((c) => !excludedTargetIds.has(c.id))
        // 「其他」在非推翻模式下不能是重新分类的合法答案，跟 analyze 主流程同一条
        // 规则（见上面 383 行）：它一旦是候选，模型会直接把书签扔进去，而「其他」
        // 是本轮才因为 issue 42 变成必然存在的兜底桶——把它算作候选，重新分类
        // 唯一可能出现的方向就是把一条原本待在真实主题目录里的书签，改判成待在
        // 一个更差的地方。这不是「排除原目录后没有更好的答案」，是把答案变差了。
        // 推翻模式下不挡：那条路径的候选是刚设计出来的，「其他」是这棵树自己的
        // 一个真实叶子，不是需要提防的逃生口（与主流程第 383 行同一个判断）。
        const candidates = request.plan.rebuildStructure
          ? excludedCandidates
          : dropFallbackFromCandidates(excludedCandidates, scan.folders, request.plan.scopeRootIds, locale)
        if (candidates.length === 0) {
          return { ok: false, error: t('errNoAlternativeFolders') }
        }
        const client = createClient(llm, locale)
        // 不读、也不写共享缓存：候选表已经排除了本轮选中的目标，cacheKey 里的
        // 候选路径集合因此天然是这一批独有的，不会撞上分析主流程留下的缓存条目，
        // 读不到也无所谓——但如果写回去，会拿这批「排除态」特有的 key 去挤占
        // MAX_CACHE_ENTRIES 那 10000 条的额度，换不来任何一轮会命中它们。
        // 更要紧的是：如果读缓存，「排除原目录后依然没有更好的选择」这个结论
        // 本身也会被写进去（fromCache 认 targetPath: null 为合法结果）——同一批
        // 候选、同一个排除集，用户点第二次「重新分类」会静默命中缓存，什么都
        // 没问就把上次那句「依然没有更好的」原样吐回来，跟用户「再试一次」的
        // 意图正相反。
        const cache = new Map<string, CachedClassification>()
        log('classify', t('logReclassifyStart', String(items.length), String(candidates.length)))
        const results = await classifyBookmarks({
          items,
          candidates,
          client,
          cache,
          batchSize: deps.batchSize,
          concurrency,
          onProgress: progress('classify'),
          onLog: (message, level) => log('classify', message, level),
          isCancelled,
          locale,
          model: llm.model,
          // 跟着 plan 自己的模式走，不写死——推翻模式下这条规则本就用不上
          // （模型在设计出来的树里永远找得到归属），写死 true 会让这条路径的
          // 提示词在推翻模式下无端跟主流程（400 行的 includeTopicRule: !rebuild）
          // 长得不一样。
          includeTopicRule: !request.plan.rebuildStructure,
        })
        if (isCancelled()) return CANCELLED
        const nextPlan = applyReclassifyResults(request.plan, results, locale)
        const changed = results.filter((r) => r.targetCategoryId !== null && r.source !== 'none').length
        log('classify', t('logReclassifyDone', String(changed), String(results.length - changed)))
        return { ok: true, kind: 'reclassify', plan: nextPlan }
      }

      case 'apply': {
        const result = await applyPlan(ports, request.plan, new Set(request.accepted), locale, {
          removeEmptyFolders: settings.removeEmptyFolders,
          onProgress: progress('apply'),
        })
        log(
          'apply',
          t(
            result.status === 'completed' ? 'logApplyDone' : 'logApplyInterrupted',
            String(result.executed),
            String(result.removedFolders.length),
            String(result.sortedFolders),
          ),
          result.status === 'completed' ? 'info' : 'error',
        )
        return { ok: true, kind: 'apply', result }
      }

      case 'cleanup_scan': {
        const scan = await scanForCleanup(ports)
        log('cleanup', t(
          'logCleanupScanDone',
          String(scan.duplicates.length),
          String(scan.emptyFolders.length),
        ))
        return { ok: true, kind: 'cleanup_scan', scan }
      }

      case 'cleanup_stale_scan': {
        const scan = await scanStaleBookmarks(ports, request.scopeRootIds)
        return { ok: true, kind: 'cleanup_stale_scan', scan }
      }

      case 'apply_cleanup': {
        const result = await applyCleanup(ports, request.input, locale, {
          onProgress: progress('cleanup'),
        })
        log('cleanup', t(
          'logCleanupDone',
          String(result.deleted),
          String(result.removedFolders.length),
          String(result.moved),
        ))
        return { ok: true, kind: 'apply_cleanup', result }
      }

      case 'apply_aggregate': {
        const result = await aggregateBookmarks(ports, request.input, locale, {
          onProgress: progress('cleanup'),
        })
        return { ok: true, kind: 'apply_aggregate', result }
      }

      case 'check_links': {
        const results = await checkLinks(request.targets, {
          onProgress: progress('cleanup'),
          ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
          ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        })
        log('cleanup', t('logLinkCheckDone', String(results.length)))
        return { ok: true, kind: 'check_links', results }
      }

      case 'undo': {
        const result = await undoLast(ports, locale, progress('undo'))
        log('undo', t('logUndoDone', String(result.restored), String(result.removedFolders)))
        return { ok: true, kind: 'undo', result }
      }

      case 'get_settings':
        return { ok: true, kind: 'get_settings', settings }

      case 'save_settings':
        await saveSettings(ports, request.settings)
        // 立刻生效：cancel 端口的日志不走请求路径，等下一个请求就晚了
        setLocale(resolveLocale(request.settings.uiLocale))
        return { ok: true, kind: 'save_settings' }

      case 'import': {
        // 用自己新读的树查书签栏，不接受侧栏传来的 id——那份树可能已经过期
        const tree = await ports.bookmarks.getTree()
        const bar = findBookmarksBar(tree)
        if (bar === null) return { ok: false, error: t('errNoBookmarksBar') }

        const result = await importTree(ports, request.nodes, request.targetName, bar.id)
        log('import', t('logImportDone', String(result.bookmarks), String(result.folders)))
        return { ok: true, kind: 'import', result }
      }

      case 'move_bookmarks': {
        try {
          const result = await moveBookmarks(ports, request.input)
          return { ok: true, kind: 'move_bookmarks', result }
        } catch (error) {
          if (error instanceof MoveBookmarksError) return { ok: false, error: describeMoveError(error) }
          throw error
        }
      }

      // 取消标记由 service worker 持有，这里只是让消息类型闭合
      case 'cancel':
        return { ok: true, kind: 'cancel' }

      case 'clear_classify_cache': {
        await clearCache(ports)
        return { ok: true, kind: 'clear_classify_cache' }
      }

      case 'test_model': {
        // 用真的客户端发一个最小 schema 的请求。不在这里挡「模型没配好」：设置页的
        // 按钮已经用 isModelConfigured 禁着，而真按下去时，一份空 Key 的配置得到的
        // 401 → 'auth' 本身就是准确答案，多一道门只会把它换成一句更笼统的话。
        //
        // 测的是用户点的那一行眼前这份（含还没保存的草稿），不是当前在用的那一对。
        const llm: LlmConfig = {
          baseUrl: request.baseUrl, apiKey: request.apiKey, model: request.model,
        }
        const result = await probeModel(
          () => createClient(llm, locale),
          locale,
          llm.apiKey,
          now,
        )
        if (!result.ok) return { ok: false, error: result.error, reason: result.reason }
        return { ok: true, kind: 'test_model', ms: result.ms }
      }


      case 'list_models': {
        // Key 跟请求走，不从 settings 里找：编辑态下那把还没落盘。
        const list = deps.listModels ?? listRemoteModels
        try {
          const models = await list(request.baseUrl, request.apiKey)
          return { ok: true, kind: 'list_models', models }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }


      case 'get_undo_state': {
        const snapshot = await loadSnapshot(ports)
        return {
          ok: true,
          kind: 'get_undo_state',
          available: snapshot !== null,
          createdAt: snapshot?.createdAt ?? null,
        }
      }
    }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
