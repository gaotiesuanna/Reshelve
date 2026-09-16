import { useEffect, useMemo, useState } from 'react'
import type { Locale } from '@/core/locale'
import { bookmarksMatchingContent } from '@/core/cleanup'
import { plural, t } from '@/i18n'
import { CheckCircleIcon, ChevronDownIcon } from './icons'
import { useStore } from '../store'

interface PresetTagDef {
  key: string
  label: string
  query: string
  folderTitle: string
}

interface SuggestedTag extends PresetTagDef {
  count: number
}

function getPresetDefinitions(locale: Locale): PresetTagDef[] {
  const isZh = locale === 'zh_CN'
  return [
    { key: 'github', label: 'GitHub', query: 'github', folderTitle: 'GitHub' },
    { key: 'youtube', label: 'YouTube', query: 'youtube', folderTitle: 'YouTube' },
    { key: 'csdn', label: 'CSDN', query: 'csdn', folderTitle: 'CSDN' },
    { key: 'bilibili', label: 'Bilibili', query: 'bilibili', folderTitle: 'Bilibili' },
    { key: 'zhihu', label: isZh ? '知乎' : 'Zhihu', query: 'zhihu', folderTitle: isZh ? '知乎' : 'Zhihu' },
    { key: 'juejin', label: isZh ? '掘金' : 'Juejin', query: 'juejin', folderTitle: isZh ? '掘金' : 'Juejin' },
    { key: 'stackoverflow', label: 'Stack Overflow', query: 'stackoverflow', folderTitle: 'Stack Overflow' },
  ]
}

export function AggregateCleanupSection() {
  const { cleanupScan, busy, undoAvailable, runAggregate, locale } = useStore()
  const [query, setQuery] = useState('')
  const [folderTitle, setFolderTitle] = useState('')
  const [parentId, setParentId] = useState<string | null>(cleanupScan?.scopeRootIds[0] ?? null)
  const [parentText, setParentText] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [parentPickerOpen, setParentPickerOpen] = useState(false)
  const [parentQuery, setParentQuery] = useState('')
  const [activeParentIndex, setActiveParentIndex] = useState<number | null>(null)

  const matches = useMemo(
    () => bookmarksMatchingContent(cleanupScan?.items ?? [], query),
    [cleanupScan, query],
  )
  const matchKey = matches.map((item) => item.id).join('\u0000')
  const folders = useMemo(
    () => (cleanupScan?.folders ?? []).filter((folder) => folder.title.trim() !== ''),
    [cleanupScan],
  )
  const folderOptions = useMemo(
    () => folders.map((folder) => ({
      folder,
      label: [...folder.path, folder.title].filter((part) => part !== '').join(' / '),
    })),
    [folders],
  )
  const filteredFolderOptions = useMemo(() => {
    const needle = parentQuery.trim().toLocaleLowerCase()
    if (needle === '') return folderOptions
    return folderOptions.filter((option) => option.label.toLocaleLowerCase().includes(needle))
  }, [folderOptions, parentQuery])
  const suggestedTags = useMemo<SuggestedTag[]>(() => {
    const items = cleanupScan?.items ?? []
    const presets = getPresetDefinitions(locale)

    const presetTags: SuggestedTag[] = presets.map((preset) => ({
      ...preset,
      count: bookmarksMatchingContent(items, preset.query).length,
    }))

    const coveredQueries = new Set(presets.map((p) => p.query.toLowerCase()))
    const domainCounts = new Map<string, number>()
    for (const item of items) {
      try {
        const host = new URL(item.url).hostname.replace(/^www\./, '').toLowerCase()
        if (host && !Array.from(coveredQueries).some((q) => host.includes(q))) {
          domainCounts.set(host, (domainCounts.get(host) ?? 0) + 1)
        }
      } catch {
        // 忽略无效网址
      }
    }

    const extraDomainTags: SuggestedTag[] = Array.from(domainCounts.entries())
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([domain, count]) => {
        const mainPart = domain.split('.')[0] ?? domain
        const capitalized = mainPart.charAt(0).toUpperCase() + mainPart.slice(1)
        return {
          key: `domain-${domain}`,
          label: domain,
          query: domain,
          folderTitle: capitalized,
          count,
        }
      })

    const withMatches = presetTags.filter((p) => p.count > 0).sort((a, b) => b.count - a.count)
    const withoutMatches = presetTags.filter((p) => p.count === 0)

    return [...withMatches, ...extraDomainTags, ...withoutMatches]
  }, [cleanupScan, locale])

  const allPresetFolderTitles = useMemo(
    () => new Set(suggestedTags.map((t) => t.folderTitle)),
    [suggestedTags],
  )

  const handleSelectTag = (tag: SuggestedTag): void => {
    const isCurrentlyActive = query.trim().toLocaleLowerCase() === tag.query.toLocaleLowerCase()
    if (isCurrentlyActive) {
      setQuery('')
      if (folderTitle.trim() === tag.folderTitle) {
        setFolderTitle('')
      }
    } else {
      setQuery(tag.query)
      if (folderTitle.trim() === '' || allPresetFolderTitles.has(folderTitle.trim())) {
        setFolderTitle(tag.folderTitle)
      }
    }
  }
  const selectedParentLabel = parentId === null
    ? parentText
    : folderOptions.find((option) => option.folder.id === parentId)?.label ?? parentText

  const openParentPicker = (): void => {
    if (parentPickerOpen) return
    setParentQuery('')
    setActiveParentIndex(null)
    setParentPickerOpen(true)
  }

  const chooseParent = (id: string): void => {
    const option = folderOptions.find((entry) => entry.folder.id === id)
    if (option === undefined) return
    setParentId(id)
    setParentText(option.label)
    setParentPickerOpen(false)
    setParentQuery('')
    setActiveParentIndex(null)
  }

  const commitParentInput = (value: string): void => {
    const text = value.trim()
    if (text !== '') {
      const exact = folderOptions.find((option) => option.label === text)
      if (exact !== undefined) {
        chooseParent(exact.folder.id)
        return
      }
      setParentId(null)
      setParentText(text)
    }
    setParentPickerOpen(false)
    setParentQuery('')
    setActiveParentIndex(null)
  }

  useEffect(() => {
    setSelected(new Set(matches.map((item) => item.id)))
  }, [matchKey])

  useEffect(() => {
    if (parentId === null) return
    const option = folderOptions.find((entry) => entry.folder.id === parentId)
    if (option !== undefined) {
      setParentText(option.label)
      return
    }
    const fallback = folderOptions.find((entry) =>
      cleanupScan?.scopeRootIds.includes(entry.folder.id)) ?? folderOptions[0]
    setParentId(fallback?.folder.id ?? null)
    setParentText(fallback?.label ?? '')
  }, [cleanupScan, folderOptions, parentId])

  if (cleanupScan === null) return null

  const selectedCount = selected.size
  const manualPath = parentId === null
    ? parentText.split('/').map((part) => part.trim()).filter((part) => part !== '')
    : []
  const canRun = selectedCount > 0
    && (parentId !== null || manualPath.length > 0)
    && folderTitle.trim() !== ''
    && busy === null

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupAggregateExplain')}</p>

      <label className="block space-y-1 text-xs font-medium text-neutral-700">
        <span>{t('cleanupAggregateQueryLabel')}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('cleanupAggregateQueryPlaceholder')}
          className="w-full rounded-md border border-neutral-300 px-2.5 py-2 text-sm font-normal text-neutral-800 outline-none transition-colors duration-150 placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-300 motion-reduce:transition-none"
        />
      </label>
      <div className="space-y-1.5">
        <div className="text-xs text-neutral-500">
          {t('cleanupAggregateQuickTagsLabel')}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('cleanupAggregateQuickTagsLabel')}>
          {suggestedTags.map((tag) => {
            const isActive = query.trim().toLocaleLowerCase() === tag.query.toLocaleLowerCase()
            return (
              <button
                key={tag.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleSelectTag(tag)}
                className={[
                  'inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
                  isActive
                    ? 'bg-neutral-800 font-medium text-white shadow-sm hover:bg-neutral-900'
                    : 'border border-neutral-200 bg-neutral-50 font-normal text-neutral-600 hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900',
                ].join(' ')}
              >
                <span>{tag.label}</span>
                {tag.count > 0 && (
                  <span
                    className={[
                      'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                      isActive ? 'bg-neutral-700 text-neutral-200' : 'bg-neutral-200/80 text-neutral-500',
                    ].join(' ')}
                  >
                    {tag.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>


      {query.trim() !== '' && matches.length === 0 && (
        <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-500">
          {t('cleanupAggregateNoMatches')}
        </p>
      )}


      {matches.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">
              {t('cleanupAggregateMatchCount', String(matches.length), String(selectedCount))}
            </p>
            <button
              type="button"
              className="cursor-pointer rounded px-1.5 py-1 text-xs font-medium text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
              onClick={() => setSelected(
                selectedCount === matches.length
                  ? new Set()
                  : new Set(matches.map((item) => item.id)),
              )}
            >
              {selectedCount === matches.length ? t('cleanupAggregateClearAll') : t('cleanupAggregateSelectAll')}
            </button>
          </div>

          <ul aria-label={t('cleanupAggregateMatchListLabel')} className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-1">
            {matches.map((item) => (
              <li key={item.id} className="rounded px-2 py-1.5 hover:bg-neutral-50">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={selected.has(item.id)}
                    aria-label={t('cleanupAggregateSelectItem', item.title.trim() === '' ? item.url : item.title)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      setSelected(next)
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-neutral-700">
                      {item.title.trim() === '' ? item.url : item.title}
                    </span>
                    <span className="block break-all text-xs leading-snug text-neutral-400">{item.url}</span>
                    <span className="block truncate text-xs text-neutral-400">/{item.currentPath.join('/')}/</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="grid gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <label className="block space-y-1 text-xs font-medium text-neutral-700">
              <span>{t('cleanupAggregateFolderLabel')}</span>
              <input
                value={folderTitle}
                onChange={(event) => setFolderTitle(event.target.value)}
                placeholder={t('cleanupAggregateFolderPlaceholder')}
                className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-sm font-normal text-neutral-800 outline-none transition-colors duration-150 placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-300 motion-reduce:transition-none"
              />
            </label>

            <label className="block space-y-1 text-xs font-medium text-neutral-700">
              <span>{t('cleanupAggregateParentLabel')}</span>
              <div className="relative">
                <input
                  role="combobox"
                  aria-label={t('cleanupAggregateParentLabel')}
                  aria-autocomplete="list"
                  aria-expanded={parentPickerOpen}
                  aria-controls="cleanup-aggregate-parent-listbox"
                  {...(parentPickerOpen && activeParentIndex !== null
                    && filteredFolderOptions[activeParentIndex] !== undefined
                    ? { 'aria-activedescendant': `cleanup-aggregate-parent-option-${activeParentIndex}` }
                    : {})}
                  autoComplete="off"
                  value={parentPickerOpen ? parentQuery : selectedParentLabel}
                  placeholder={t('cleanupAggregateParentSearchPlaceholder')}
                  onFocus={openParentPicker}
                  onClick={openParentPicker}
                  onBlur={() => commitParentInput(parentQuery)}
                  onChange={(event) => {
                    if (!parentPickerOpen) openParentPicker()
                    setParentQuery(event.target.value)
                    setActiveParentIndex(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      if (!parentPickerOpen) openParentPicker()
                      else setActiveParentIndex((index) =>
                        Math.min((index ?? -1) + 1, Math.max(filteredFolderOptions.length - 1, 0)))
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setActiveParentIndex((index) =>
                        index === null
                          ? Math.max(filteredFolderOptions.length - 1, 0)
                          : Math.max(index - 1, 0))
                    } else if (event.key === 'Enter' && parentPickerOpen) {
                      event.preventDefault()
                      const option = activeParentIndex === null
                        ? undefined
                        : filteredFolderOptions[activeParentIndex]
                      if (option !== undefined) chooseParent(option.folder.id)
                      else commitParentInput(parentQuery)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setParentPickerOpen(false)
                      setParentQuery('')
                      setActiveParentIndex(null)
                    }
                  }}
                  className="w-full rounded-md border border-neutral-300 bg-white py-2 pl-2.5 pr-8 text-sm font-normal text-neutral-800 outline-none transition-colors duration-150 placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-300 motion-reduce:transition-none"
                />
                <ChevronDownIcon
                  className={`pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none ${parentPickerOpen ? 'rotate-180' : ''}`}
                />
                {parentPickerOpen && (
                  <ul
                    id="cleanup-aggregate-parent-listbox"
                    role="listbox"
                    className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 shadow-lg"
                  >
                    {filteredFolderOptions.length === 0 ? (
                      <li
                        role="option"
                        aria-disabled="true"
                        className="px-2 py-1.5 text-xs font-normal text-neutral-500"
                      >
                        {parentQuery.trim() === ''
                          ? t('cleanupAggregateParentNoMatches')
                          : t('cleanupAggregateParentUseTyped')}
                      </li>
                    ) : filteredFolderOptions.map((option, index) => {
                      const chosen = option.folder.id === parentId
                      const active = index === activeParentIndex
                      return (
                        <li
                          key={option.folder.id}
                          id={`cleanup-aggregate-parent-option-${index}`}
                          role="option"
                          aria-selected={chosen}
                          className={[
                            'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-normal',
                            active ? 'bg-blue-50 text-neutral-900' : 'text-neutral-700 hover:bg-neutral-50',
                          ].join(' ')}
                          onMouseEnter={() => setActiveParentIndex(index)}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            chooseParent(option.folder.id)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{option.label}</span>
                          {chosen && <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
              <span className="block text-xs font-normal leading-relaxed text-neutral-500">
                {t('cleanupAggregateParentHint')}
              </span>
            </label>
          </div>
        </>
      )}

      {matches.length > 0 && (
        <div
          data-testid="cleanup-aggregate-action-region"
          className="space-y-2 border-t border-index-line pt-4"
        >
          {undoAvailable && (
            <p className="text-xs leading-relaxed text-amber-700">{t('cleanupOverwriteUndoWarning')}</p>
          )}
          <button
            type="button"
            className="w-full cursor-pointer rounded-index bg-index-ink py-2 text-base leading-body font-medium text-index-canvas shadow-sm transition-colors duration-150 hover:enabled:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-accent focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
            disabled={!canRun}
            onClick={() => void runAggregate({
              bookmarkIds: [...selected],
              destination: parentId === null
                ? { kind: 'path', segments: manualPath }
                : { kind: 'existing', folderId: parentId },
              folderTitle: folderTitle.trim(),
            })}
          >
            {plural(selectedCount, 'cleanupAggregateRunOne', 'cleanupAggregateRunOther', String(selectedCount))}
          </button>
        </div>
      )}
    </div>
  )
}
