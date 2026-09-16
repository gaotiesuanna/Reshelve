import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@/i18n'
import { BookmarkTree, filterBookmarkTree, topLevelNodes } from '../components/BookmarkTree'
import { BookmarkWorkspace } from '../components/BookmarkWorkspace'
import { ExportPanel } from '../components/ExportPanel'
import { FolderPicker } from '../components/FolderPicker'
import { ImportPanel } from '../components/ImportPanel'
import { segmentActive, segmentButton, segmentTrack } from '../components/buttonStyles'
import { ChevronDownIcon, DownloadIcon, UploadIcon } from '../components/icons'
import { isTabView } from '../lib/openInTab'
import { collectAllFolderIds, useStore } from '../store'
import type { BookmarkNode } from '@/core/ports'
import { collectMoveNodeIds, type MoveBookmarksInput } from '@/engine/moveBookmarks'

type TransferPanel = 'export' | 'import' | null
type MovePanelMode = 'existing' | 'new'

const TRANSFER_FEATURES = [
  'transferFeatureSearch',
  'transferFeatureMove',
  'transferFeatureExport',
  'transferFeatureImport',
] as const



function initialTransfer(): TransferPanel {
  const { importFile, importError, importDone } = useStore.getState()
  return importFile !== null || importError !== null || importDone !== null ? 'import' : null
}

export function TransferStep() {
  const { tree, checkedIds, toggle, moveSelection, toggleBookmarkSelection, busy } = useStore()
  const [transfer, setTransfer] = useState<TransferPanel>(initialTransfer)
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [moveOpen, setMoveOpen] = useState(false)
  const movePanelRef = useRef<HTMLDivElement>(null)
  const transferPanelRef = useRef<HTMLDivElement>(null)
  const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Set<string> | null>(null)
  const [searchExpandedIds, setSearchExpandedIds] = useState<Set<string> | null>(null)
  const tabView = isTabView()
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
  const moveNodeIds = useMemo(
    () => collectMoveNodeIds(tree, checkedIds, moveSelection),
    [tree, checkedIds, moveSelection],
  )
  const canMove = moveNodeIds.length > 0 && busy === null
  // 全部取消勾选后收起移动面板：下次重新勾选时不该自动弹开
  useEffect(() => {
    if (moveNodeIds.length === 0) setMoveOpen(false)
  }, [moveNodeIds.length])
  useEffect(() => {
    if (moveOpen) movePanelRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [moveOpen])
  useEffect(() => {
    if (transfer !== null) transferPanelRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [transfer])

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

  const workspace = (
    <BookmarkWorkspace
      viewportLabel={t('bookmarkWorkspaceLabel')}
      toolbar={(
        <div className="flex gap-2 text-sm leading-caption">
          <button
            className="cursor-pointer rounded-index border border-index-line-strong bg-index-surface px-2 py-1 text-index-ink transition-colors duration-150 hover:bg-index-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-accent motion-reduce:transition-none"
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
              className="w-full min-w-0 rounded-index border border-index-line-strong bg-index-surface px-2 py-1 text-index-ink outline-none placeholder:text-index-faint focus:border-index-accent focus:ring-1 focus:ring-index-accent"
            />
          </label>
        </div>
      )}
      footer={(
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={moveOpen}
                disabled={!canMove}
                onClick={() => setMoveOpen((prev) => !prev)}
                className="flex min-h-index-row min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-index border border-index-line bg-index-blue-soft px-3 text-sm leading-caption font-semibold text-index-ink transition-colors duration-150 hover:enabled:bg-index-blue-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-blue disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
              >
                <span>{t('moveSelectedBookmarks')}</span>
                <span className="flex items-center gap-1.5 text-xs font-normal text-index-muted">
                  {moveNodeIds.length > 0
                    ? t('moveCount', String(moveNodeIds.length))
                    : t('moveSelectHint')}
                  <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${moveOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {canMove && (
                <button
                  type="button"
                  onClick={() => {
                    useStore.setState({ checkedIds: new Set(), moveSelection: new Set() })
                    setMoveOpen(false)
                  }}
                  className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-index px-2 text-xs leading-caption text-index-muted transition-colors duration-150 hover:bg-index-surface-muted hover:text-index-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-accent motion-reduce:transition-none"
                >
                  {t('importCancel')}
                </button>
              )}
            </div>
            {moveOpen && (
              <div ref={movePanelRef}>
                <MoveBookmarksPanel tree={tree} busy={busy} nodeIds={moveNodeIds} />
              </div>
            )}
          </div>
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
            <div ref={transferPanelRef}>
              {transfer === 'export' ? <ExportPanel /> : <ImportPanel />}
            </div>
          )}
        </div>
      )}
    >
      <div className="p-2">
        <BookmarkTree
          nodes={visibleNodes}
          checkedIds={checkedIds}
          onToggle={toggle}
          selectedBookmarkIds={moveSelection}
          onToggleBookmark={toggleBookmarkSelection}
          expandedIds={visibleExpandedIds}
          onToggleExpand={toggleExpand}
          showBookmarks
        />
        {searchActive && !searchResult.hasMatches && (
          <p className="px-2 py-3 text-center text-sm leading-caption text-neutral-500">{t('treeSearchEmpty')}</p>
        )}
      </div>
    </BookmarkWorkspace>
  )

  if (tabView) {
    return (
      <div className="flex min-h-full flex-col md:flex-row gap-3 md:gap-4">
        <aside
          data-testid="transfer-sidebar"
          className="w-full md:w-20 lg:w-20 shrink-0 border-b md:border-b-0 md:border-r border-index-line pb-4 md:pb-0 pr-0 md:pr-3"
        >
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-index-muted">
            {t('shellModeTransfer')}
          </div>
          <ul className="flex flex-col space-y-1" aria-label={t('shellModeTransfer')}>
            {TRANSFER_FEATURES.map((key) => (
              <li
                key={key}
                className="rounded-index px-2.5 py-2 text-xs leading-relaxed text-index-muted"
              >
                {t(key)}
              </li>
            ))}
          </ul>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {workspace}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <p className="mb-3 text-sm leading-relaxed text-neutral-500">{t('transferIntro')}</p>
      {workspace}
    </div>
  )
}

function MoveBookmarksPanel({
  tree,
  busy,
  nodeIds,
}: {
  tree: BookmarkNode[]
  busy: string | null
  nodeIds: string[]
}) {
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
  const canSubmit = busy === null
    && nodeIds.length > 0
    && (mode === 'existing' ? targetFolderId !== '' : newFolderTitle.trim() !== '' && parentFolderId !== '')

  function submit(): void {
    if (!canSubmit) return
    const destination: MoveBookmarksInput['destination'] = mode === 'existing'
      ? { kind: 'existing', folderId: targetFolderId }
      : { kind: 'new', parentId: parentFolderId, title: newFolderTitle }
    void moveBookmarks({ nodeIds, destination })
  }

  return (
    <div className="mt-2 space-y-2 rounded-index border border-index-line bg-index-surface-muted p-3">
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
              className="min-h-index-row w-full rounded-index border border-index-line-strong bg-index-surface px-2 text-sm text-index-ink placeholder:text-index-faint focus-visible:outline focus-visible:ring-2 focus-visible:ring-index-accent"
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
        className="inline-flex min-h-index-row w-full items-center justify-center rounded-index bg-index-ink px-3 text-sm leading-caption font-medium text-index-canvas transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:ring-2 focus-visible:ring-index-accent"
        disabled={!canSubmit}
        onClick={submit}
      >
        {t('moveConfirm')}
      </button>
    </div>
  )
}
