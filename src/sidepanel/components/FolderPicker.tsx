import { useMemo, useState } from 'react'
import type { BookmarkNode } from '@/core/ports'
import { t } from '@/i18n'
import { FolderIcon } from './icons'
import { topLevelNodes } from './BookmarkTree'

export interface FolderPickerProps {
  tree: BookmarkNode[]
  selectedId: string
  onSelect: (id: string) => void
  disabled?: boolean
  label?: string
  name?: string
}

export function countBookmarks(node: BookmarkNode): number {
  return (node.children ?? []).reduce(
    (sum, child) => sum + (child.url !== undefined ? 1 : countBookmarks(child)),
    0,
  )
}

export function findFolderPath(nodes: BookmarkNode[], targetId: string): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return [node.title]
    if (node.children) {
      const childPath = findFolderPath(node.children, targetId)
      if (childPath !== null) {
        return node.title === '' ? childPath : [node.title, ...childPath]
      }
    }
  }
  return null
}

export function findAncestorFolderIds(
  nodes: BookmarkNode[],
  targetId: string,
  ancestors: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.url !== undefined) continue
    if (node.id === targetId) return ancestors
    if (node.children) {
      const found = findAncestorFolderIds(node.children, targetId, [...ancestors, node.id])
      if (found !== null) return found
    }
  }
  return null
}

export interface FilterFolderResult {
  nodes: BookmarkNode[]
  expandedIds: Set<string>
  hasMatches: boolean
}

export function filterFolderTree(nodes: BookmarkNode[], query: string): FilterFolderResult {
  const normalized = query.trim().toLocaleLowerCase()
  const expandedIds = new Set<string>()

  function visit(node: BookmarkNode): BookmarkNode | null {
    if (node.url !== undefined) return null
    const selfMatches = normalized === '' ? true : node.title.toLocaleLowerCase().includes(normalized)
    const folderChildren = (node.children ?? [])
      .map(visit)
      .filter((child): child is BookmarkNode => child !== null)

    if (normalized === '') {
      return { ...node, children: folderChildren }
    }

    if (!selfMatches && folderChildren.length === 0) return null
    if (folderChildren.length > 0) expandedIds.add(node.id)
    return { ...node, children: folderChildren }
  }

  const filtered = nodes.map(visit).filter((node): node is BookmarkNode => node !== null)
  return { nodes: filtered, expandedIds, hasMatches: filtered.length > 0 }
}

export function collectFolderIds(nodes: BookmarkNode[]): string[] {
  const ids: string[] = []
  function visit(node: BookmarkNode): void {
    if (node.url !== undefined) return
    ids.push(node.id)
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of nodes) visit(node)
  return ids
}

function FolderRow({
  node,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpand,
  disabled,
  name,
}: {
  node: BookmarkNode
  depth: number
  selectedId: string
  onSelect: (id: string) => void
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  disabled?: boolean
  name: string
}) {
  const children = (node.children ?? []).filter((child) => child.url === undefined)
  const expanded = expandedIds.has(node.id)
  const isSelected = selectedId === node.id
  const bookmarkCount = countBookmarks(node)

  return (
    <div>
      <div
        className={`flex items-center rounded px-1 py-1 transition-colors cursor-pointer ${
          isSelected
            ? 'bg-blue-50 text-blue-900 font-medium'
            : 'hover:bg-neutral-100 text-neutral-700'
        }`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => {
          if (!disabled) onSelect(node.id)
        }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="h-5 w-5 shrink-0 text-sm leading-caption text-neutral-400 hover:text-neutral-700"
            aria-label={expanded ? t('treeCollapse', node.title) : t('treeExpand', node.title)}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.id)
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        <label
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-2"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="radio"
            name={name}
            value={node.id}
            checked={isSelected}
            disabled={disabled}
            aria-label={t('folderPickerSelectRadio', node.title)}
            onChange={() => onSelect(node.id)}
            className="h-3.5 w-3.5 shrink-0 accent-blue-600"
          />
          <FolderIcon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-blue-600' : 'text-neutral-400'}`} />
          <span className="min-w-0 truncate text-sm leading-caption">{node.title}</span>
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-neutral-400">
            {bookmarkCount}
          </span>
        </label>
      </div>

      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              disabled={disabled}
              name={name}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function FolderPicker({
  tree,
  selectedId,
  onSelect,
  disabled = false,
  label,
  name = 'folder-picker-radio',
}: FolderPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Set<string> | null>(null)
  const [searchExpandedIds, setSearchExpandedIds] = useState<Set<string> | null>(null)

  const roots = useMemo(() => topLevelNodes(tree), [tree])
  const defaultExpanded = useMemo(() => {
    const base = new Set(roots.map((node) => node.id))
    if (selectedId) {
      const ancestors = findAncestorFolderIds(tree, selectedId)
      if (ancestors) {
        for (const id of ancestors) base.add(id)
      }
    }
    return base
  }, [roots, tree, selectedId])

  const expandedIds = expanded ?? defaultExpanded

  const searchActive = searchQuery.trim().length > 0
  const searchResult = useMemo(
    () => filterFolderTree(roots, searchQuery),
    [roots, searchQuery],
  )
  const visibleNodes = searchActive ? searchResult.nodes : roots
  const visibleExpandedIds = searchActive
    ? (searchExpandedIds ?? searchResult.expandedIds)
    : expandedIds

  const folderIds = useMemo(() => collectFolderIds(visibleNodes), [visibleNodes])
  const allOpen = folderIds.length > 0 && folderIds.every((id) => visibleExpandedIds.has(id))

  const selectedPath = useMemo(() => {
    if (!selectedId) return null
    return findFolderPath(tree, selectedId)
  }, [tree, selectedId])

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

  function toggleAll(): void {
    const next = allOpen ? new Set<string>() : new Set(folderIds)
    if (searchActive) setSearchExpandedIds(next)
    else setExpanded(next)
  }

  return (
    <div className="space-y-1.5">
      {label && <span className="block font-medium text-sm text-index-ink">{label}</span>}

      {/* 搜索与展开收起栏 */}
      <div className="flex gap-1 text-sm leading-caption">
        <button
          type="button"
          className="rounded border border-index-line bg-index-canvas px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
          disabled={disabled || folderIds.length === 0}
          onClick={toggleAll}
        >
          {t(allOpen ? 'scopeCollapseAll' : 'scopeExpandAll')}
        </button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('folderPickerSearchLabel')}</span>
          <input
            type="search"
            aria-label={t('folderPickerSearchLabel')}
            placeholder={t('folderPickerSearchPlaceholder')}
            value={searchQuery}
            disabled={disabled}
            onChange={(e) => changeSearchQuery(e.target.value)}
            className="w-full min-w-0 rounded border border-index-line bg-index-canvas px-2 py-1 text-xs outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-300"
          />
        </label>
      </div>

      {/* 已选文件夹路径提示 */}
      {selectedPath && (
        <div className="rounded bg-neutral-100 px-2 py-1 text-xs leading-caption text-neutral-600 truncate">
          <span className="font-medium text-neutral-800">
            {t('folderPickerSelected', selectedPath.join(' / '))}
          </span>
        </div>
      )}

      {/* 文件夹树(自然高度,随页面滚动) */}
      <div
        className="rounded border border-index-line bg-index-canvas p-1"
        role="radiogroup"
        aria-label={label ?? t('moveDestinationLabel')}
      >
        {visibleNodes.length > 0 ? (
          visibleNodes.map((node) => (
            <FolderRow
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={visibleExpandedIds}
              onToggleExpand={toggleExpand}
              disabled={disabled}
              name={name}
            />
          ))
        ) : (
          <p className="py-4 text-center text-xs text-neutral-400">
            {t('folderPickerEmpty')}
          </p>
        )}
      </div>
    </div>
  )
}
