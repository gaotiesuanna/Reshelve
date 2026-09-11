import { useMemo, useState } from 'react'
import { t } from '@/i18n'
import { BookmarkTree, filterBookmarkTree, topLevelNodes } from '../components/BookmarkTree'
import { ExportPanel } from '../components/ExportPanel'
import { FolderPicker } from '../components/FolderPicker'
import { ImportPanel } from '../components/ImportPanel'
import { segmentActive, segmentButton, segmentTrack } from '../components/buttonStyles'
import { StickyActionBar } from '../components/IndexControls'
import { DownloadIcon, UploadIcon } from '../components/icons'
import { collectAllFolderIds, useStore } from '../store'
import type { BookmarkNode } from '@/core/ports'
import type { MoveBookmarksInput } from '@/engine/moveBookmarks'

type TransferPanel = 'export' | 'import' | null
type MovePanelMode = 'existing' | 'new'


function selectedIdsInTree(nodes: BookmarkNode[], selected: Set<string>): string[] {
  const ids: string[] = []
  function visit(node: BookmarkNode): void {
    if (node.url !== undefined) {
      if (selected.has(node.id)) ids.push(node.id)
      return
    }
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of nodes) visit(node)
  return ids
}

function initialTransfer(): TransferPanel {
  const { importFile, importError, importDone } = useStore.getState()
  return importFile !== null || importError !== null || importDone !== null ? 'import' : null
}

export function TransferStep() {
  const { tree, checkedIds, toggle, moveSelection, toggleBookmarkSelection, busy } = useStore()
  const [transfer, setTransfer] = useState<TransferPanel>(initialTransfer)
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Set<string> | null>(null)
  const [searchExpandedIds, setSearchExpandedIds] = useState<Set<string> | null>(null)
  const defaultExpanded = useMemo(
    () => new Set(topLevelNodes(tree).map((node) => node.id)),
    [tree],
  )
  const expandedIds = expanded ?? defaultExpanded
  const searchActive = searchQuery.trim().length > 0
  const searchResult = useMemo(
    () => filterBookmarkTree(tree, searchQuery),
    [tree, searchQuery],
  )
  const visibleNodes = searchActive ? searchResult.nodes : tree
  const visibleExpandedIds = searchActive
    ? (searchExpandedIds ?? searchResult.expandedIds)
    : expandedIds
  const folderIds = collectAllFolderIds(visibleNodes)
  const allOpen = folderIds.length > 0 && folderIds.every((id) => visibleExpandedIds.has(id))

  function changeSearchQuery(value: string): void {
    const wasActive = searchQuery.trim().length > 0
    const willBeActive = value.trim().length > 0
    if (!wasActive && willBeActive) setExpandedBeforeSearch(new Set(expandedIds))
    if (wasActive && !willBeActive) {
      setExpanded(expandedBeforeSearch ?? expandedIds)
      setExpandedBeforeSearch(null)
    }
    setSearchExpandedIds(null)
    setSearchQuery(value)
  }

  function toggleExpand(id: string): void {
    const next = new Set(visibleExpandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (searchActive) setSearchExpandedIds(next)
    else setExpanded(next)
  }

  function setAllExpanded(ids: string[]): void {
    if (searchActive) setSearchExpandedIds(new Set(ids))
    else setExpanded(new Set(ids))
  }

  return (
    <div>
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-neutral-500">{t('transferIntro')}</p>

        <div className="flex gap-1 text-sm leading-caption">
          <button
            className="rounded border px-2 py-1 hover:bg-neutral-50"
            onClick={() => setAllExpanded(allOpen ? [] : folderIds)}
          >
            {t(allOpen ? 'scopeCollapseAll' : 'scopeExpandAll')}
          </button>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('treeSearchLabel')}</span>
            <input
              type="search"
              aria-label={t('treeSearchLabel')}
              value={searchQuery}
              onChange={(event) => changeSearchQuery(event.target.value)}
              placeholder={t('treeSearchPlaceholder')}
              className="w-full min-w-0 rounded border px-2 py-1 outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-300"
            />
          </label>
        </div>

        <div className="rounded border">
          <BookmarkTree
            nodes={visibleNodes}
            checkedIds={checkedIds}
            onToggle={toggle}
            selectedBookmarkIds={moveSelection}
            onToggleBookmark={toggleBookmarkSelection}
            expandedIds={visibleExpandedIds}
            onToggleExpand={toggleExpand}
            showBookmarks={searchActive}
          />
          {searchActive && !searchResult.hasMatches && (
            <p className="px-2 py-3 text-center text-sm leading-caption text-neutral-500">{t('treeSearchEmpty')}</p>
          )}
        </div>
      </div>
      {/* 操作区钉在底部：书签上千条时目录树很长，导入导出不该被推到要滚半天才看得见的地方。
          切换条和选项组直接铺在 sticky 栏里，不再套一层灰底卡片——那层 padding
          会把「导出 / 导入」撑得比真按钮还壮。 */}
      <StickyActionBar>
        {moveSelection.size > 0 && <MoveBookmarksPanel tree={tree} busy={busy} />}
        <div className={segmentTrack} role="group">
          <button
            type="button"
            className={`${segmentButton} ${transfer === 'export' ? segmentActive : ''}`}
            aria-expanded={transfer === 'export'}
            aria-pressed={transfer === 'export'}
            disabled={busy !== null}
            onClick={() => setTransfer((prev) => (prev === 'export' ? null : 'export'))}
          >
            <DownloadIcon className={`h-3.5 w-3.5 shrink-0 ${transfer === 'export' ? 'text-index-ink' : 'text-index-faint'}`} />
            {t('exportToggle')}
          </button>
          <button
            type="button"
            className={`${segmentButton} ${transfer === 'import' ? segmentActive : ''}`}
            aria-expanded={transfer === 'import'}
            aria-pressed={transfer === 'import'}
            disabled={busy !== null}
            onClick={() => setTransfer((prev) => (prev === 'import' ? null : 'import'))}
          >
            <UploadIcon className={`h-3.5 w-3.5 shrink-0 ${transfer === 'import' ? 'text-index-ink' : 'text-index-faint'}`} />
            {t('importToggle')}
          </button>
        </div>
        {transfer !== null && (
          <div className="mt-2">
            {transfer === 'export' ? <ExportPanel /> : <ImportPanel />}
          </div>
        )}
      </StickyActionBar>
    </div>
  )
}

function MoveBookmarksPanel({ tree, busy }: { tree: BookmarkNode[]; busy: string | null }) {
  const moveBookmarks = useStore((state) => state.moveBookmarks)
  const [mode, setMode] = useState<MovePanelMode>('existing')
  const [existingFolderId, setExistingFolderId] = useState('')
  const [newFolderParentId, setNewFolderParentId] = useState('')
  const [newFolderTitle, setNewFolderTitle] = useState('')
  const fallbackFolderId = useMemo(() => {
    function findFirst(nodes: BookmarkNode[]): string {
      for (const node of nodes) {
        if (node.url === undefined) return node.id
        if (node.children) {
          const found = findFirst(node.children)
          if (found) return found
        }
      }
      return ''
    }
    return findFirst(topLevelNodes(tree))
  }, [tree])
  const targetFolderId = existingFolderId
  const parentFolderId = newFolderParentId || fallbackFolderId
  const selectedCount = useStore((state) => state.moveSelection.size)
  const canSubmit = busy === null
    && selectedCount > 0
    && (mode === 'existing' ? targetFolderId !== '' : newFolderTitle.trim() !== '' && parentFolderId !== '')

  function submit(): void {
    if (!canSubmit) return
    const destination: MoveBookmarksInput['destination'] = mode === 'existing'
      ? { kind: 'existing', folderId: targetFolderId }
      : { kind: 'new', parentId: parentFolderId, title: newFolderTitle }
    const bookmarkIds = selectedIdsInTree(tree, useStore.getState().moveSelection)
    void moveBookmarks({ bookmarkIds, destination })
  }

  return (
    <div className="mb-3 space-y-2 rounded-index border border-index-line bg-index-blue-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm leading-caption font-semibold text-index-ink">{t('moveSelectedBookmarks')}</p>
        <span className="text-xs leading-caption text-index-muted">{t('moveCount', String(selectedCount))}</span>
      </div>
      <div className={segmentTrack} role="group" aria-label={t('moveDestinationLabel')}>
        <button
          type="button"
          className={`${segmentButton} ${mode === 'existing' ? segmentActive : ''}`}
          aria-pressed={mode === 'existing'}
          onClick={() => setMode('existing')}
        >
          {t('moveExistingFolder')}
        </button>
        <button
          type="button"
          className={`${segmentButton} ${mode === 'new' ? segmentActive : ''}`}
          aria-pressed={mode === 'new'}
          onClick={() => setMode('new')}
        >
          {t('moveNewFolder')}
        </button>
      </div>
      {mode === 'existing' ? (
        <FolderPicker
          tree={tree}
          selectedId={targetFolderId}
          onSelect={setExistingFolderId}
          disabled={busy !== null}
          label={t('moveDestinationLabel')}
          name="move-existing-folder-target"
        />
      ) : (
        <div className="space-y-2">
          <label className="block text-sm leading-caption text-index-ink">
            <span className="mb-1 block font-medium">{t('moveNewFolderName')}</span>
            <input
              type="text"
              value={newFolderTitle}
              onChange={(event) => setNewFolderTitle(event.target.value)}
              className="min-h-index-row w-full rounded-index border border-index-line bg-index-canvas px-2 text-sm text-index-ink placeholder:text-index-faint focus-visible:outline focus-visible:ring-2 focus-visible:ring-index-blue"
              aria-label={t('moveNewFolderName')}
            />
          </label>
          <FolderPicker
            tree={tree}
            selectedId={parentFolderId}
            onSelect={setNewFolderParentId}
            disabled={busy !== null}
            label={t('moveParentFolder')}
            name="move-new-folder-parent"
          />
        </div>
      )}
      <button
        type="button"
        className="inline-flex min-h-index-row w-full items-center justify-center rounded-index bg-index-ink px-3 text-sm leading-caption font-medium text-index-canvas transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:ring-2 focus-visible:ring-index-blue"
        disabled={!canSubmit}
        onClick={submit}
      >
        {t('moveConfirm')}
      </button>
    </div>
  )
}
