import { useMemo, useState } from 'react'
import { plural, t } from '@/i18n'
import { countScopedBookmarks } from '@/core/export'
import { scanTree, scopeFolderPaths } from '@/core/scan'
import { BookmarkTree, topLevelNodes } from '../components/BookmarkTree'
import { BookmarkWorkspace } from '../components/BookmarkWorkspace'
import { InlineStatus } from '../components/InlineStatus'
import { PrimaryButton, SecondaryButton } from '../components/IndexControls'
import { isModelConfigured } from '@/llm/config'
import { activeLlm } from '@/storage/settings'
import { collectAllFolderIds, useStore } from '../store'

export function ScopeStep() {
  const { tree, checkedIds, toggle, goScan, busy, settings, openSettings } = useStore()
  // 模型配置在设置页，而扫描一步根本用不上它——不在这里先说一声，新用户会一路顺畅
  // 走完勾选和扫描，直到第三步才发现没地方填 Key，那时他已经投入了。
  // 「配好了没有」用共用谓词判，不是自己看一眼 apiKey：本机 Ollama 不要 Key，
  // 只认 apiKey 的话这条提示对他永远不消失（见 llm/config.ts）。
  const needModel = !isModelConfigured(activeLlm(settings))
  // null 表示还没手动展开过，此时默认只展开根节点，也就是先只看一级目录
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const defaultExpanded = useMemo(
    () => new Set(topLevelNodes(tree).map((node) => node.id)),
    [tree],
  )
  const expandedIds = expanded ?? defaultExpanded
  const folderIds = collectAllFolderIds(tree)
  const allOpen = folderIds.length > 0 && folderIds.every((id) => expandedIds.has(id))
  // 按钮报的是「这次要处理多少条书签」，不是勾中几个文件夹：一个目录下的书签既可能
  // 分在子目录里、也可能直接散着，而目录树只画文件夹，散着的那些在这一页从不显形。
  // 只报文件夹数时，用户没有任何地方能确认那些散链算不算在内（真实案例：某个目录
  // 10 个子目录共 73 条、另有 123 条直接散在它底下，按钮却只说「11 个文件夹」）。
  // 这个数走 findScopeRoots 去重后整棵子树遍历，和导入导出页用的是同一个函数。
  const scopedCount = useMemo(
    () => countScopedBookmarks(tree, [...checkedIds]),
    [tree, checkedIds],
  )
  // 勾选当下就能从已经在手的树算出范围统计，不必等点扫描、跳到偏好页。
  // 和后台 goScan 走同一个 scanTree：空文件夹、无标题、重名这些树上看不出来的数，口径才对得上。
  const preview = useMemo(() => {
    if (checkedIds.size === 0) return null
    const ids = [...checkedIds]
    return {
      paths: scopeFolderPaths(tree, ids),
      stats: scanTree(tree, ids).stats,
    }
  }, [tree, checkedIds])

  function toggleExpand(id: string): void {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-index-muted">{t('scopeIntro')}</p>

      {needModel && (
        <div className="mb-4">
          <InlineStatus
            tone="neutral"
            action={<SecondaryButton onClick={openSettings}>{t('scopeNeedModelAction')}</SecondaryButton>}
          >
            {t('scopeNeedModel')}
          </InlineStatus>
        </div>
      )}

      <BookmarkWorkspace
        viewportLabel={t('bookmarkWorkspaceLabel')}
        toolbar={(
          <SecondaryButton
            size="sm"
            onClick={() => setExpanded(new Set(allOpen ? [] : folderIds))}
          >
            {t(allOpen ? 'scopeCollapseAll' : 'scopeExpandAll')}
          </SecondaryButton>
        )}
        footer={(
          <div className="space-y-3">
            <PrimaryButton
              className="w-full"
              disabled={checkedIds.size === 0 || busy !== null}
              onClick={() => void goScan()}
            >
              {plural(
                scopedCount,
                'scopeScanOne',
                'scopeScanOther',
                String(scopedCount),
                // 文件夹数降为附注，但仍要单独过一次 plural：英文的 folder/folders
                // 由文件夹数决定，跟着书签数的单复数走会拼出「1 bookmark in 2 folder」
                plural(
                  checkedIds.size,
                  'scopeScanFolderOne',
                  'scopeScanFolderOther',
                  String(checkedIds.size),
                ),
              )}
            </PrimaryButton>
            {preview !== null && (
              <section className="rounded-index border border-index-line bg-index-surface p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold tracking-[-0.01em] text-index-ink">{t('prefsScanTitle')}</h3>
                  <span className="shrink-0 rounded-full bg-index-surface-muted px-2 py-0.5 font-mono text-xs text-index-muted">
                    {preview.stats.totalBookmarks}
                  </span>
                </div>
                {preview.paths.length > 0 && (
                  <div className="mt-2 flex min-w-0 gap-2 text-xs leading-caption">
                    <span className="shrink-0 text-index-muted">{t('prefsScanScope')}</span>
                    <ul className="max-h-10 min-w-0 flex-1 overflow-y-auto font-mono [overflow-wrap:anywhere]">
                      {preview.paths.map((path) => <li key={path}>{path}</li>)}
                    </ul>
                  </div>
                )}
                <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1.5 text-xs leading-caption sm:grid-cols-4">
                  <div className="flex items-baseline justify-between gap-2"><dt className="text-index-muted">{t('prefsStatBookmarks')}</dt><dd>{preview.stats.totalBookmarks}</dd></div>
                  <div className="flex items-baseline justify-between gap-2"><dt className="text-index-muted">{t('prefsStatFolders')}</dt><dd>{preview.stats.totalFolders}</dd></div>
                  <div className="flex items-baseline justify-between gap-2"><dt className="text-index-muted">{t('prefsStatEmpty')}</dt><dd>{preview.stats.emptyFolders}</dd></div>
                  <div className="flex items-baseline justify-between gap-2"><dt className="text-index-muted">{t('prefsStatUntitled')}</dt><dd>{preview.stats.untitledBookmarks}</dd></div>
                  <div className="flex items-baseline justify-between gap-2"><dt className="text-index-muted">{t('prefsStatDuplicates')}</dt><dd>{preview.stats.duplicateUrlGroups}</dd></div>
                  <div className="flex items-baseline justify-between gap-2"><dt className="text-index-muted">{t('prefsStatDuplicateFolders')}</dt><dd>{preview.stats.duplicateFolderGroups}</dd></div>
                  <div className="flex items-baseline justify-between gap-2"><dt className="text-index-muted">{t('prefsStatDepth')}</dt><dd>{preview.stats.maxDepth}</dd></div>
                </dl>
              </section>
            )}
          </div>
        )}
      >
        <div data-testid="scope-section" className="p-2">
          <BookmarkTree
            nodes={tree}
            checkedIds={checkedIds}
            onToggle={toggle}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
          />
        </div>
      </BookmarkWorkspace>
    </div>
  )
}
