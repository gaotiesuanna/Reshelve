import { sanitizeUrl } from './sanitize'
import type { BookmarkItem } from './types'
import {
  dockerRule,
  gitlabRule,
  huggingfaceRule,
  npmRule,
  pypiRule,
} from './titleRules'

/** 一次标题改写：改的是书签自己的名字，不影响它的位置。 */
export interface TitleRewrite {
  bookmarkId: string
  oldTitle: string
  newTitle: string
  providerId?: string
  reason?: string
}

/**
 * GitHub 自己的功能页，第一段看着像 owner 其实不是。
 * 漏掉一个的后果只是那条书签被改成一个怪名字，不会丢数据。
 */
const RESERVED_OWNERS = new Set([
  'settings', 'topics', 'orgs', 'explore', 'marketplace', 'pricing', 'features',
  'notifications', 'search', 'sponsors', 'apps', 'codespaces', 'collections',
  'trending', 'events', 'about', 'login', 'join', 'new', 'organizations',
])

/** 收藏的是仓库里的具体文件时，`blob/<分支>` 与 `tree/<分支>` 这两段是噪音。 */
const REF_PREFIXES = new Set(['blob', 'tree'])

/**
 * 从 URL 推出统一的 GitHub 书签标题，不是 GitHub 仓库页则返回 null。
 *
 * 用 URL 而不是网页 title：同一批收藏里 title 的写法是乱的——有的带
 * `GitHub - ` 前缀，有的丢了 owner，子页面的 owner 还被甩到最后。
 * URL 的结构是确定的。
 */
export function githubTitle(item: BookmarkItem): string | null {
  const url = sanitizeUrl(item.url)
  if (url === null || url.domain !== 'github.com') return null

  const segments = url.path.split('/').filter(Boolean)
  const [owner, repo, ...rest] = segments
  if (owner === undefined || repo === undefined) return null
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null

  const suffix = pathSuffix(rest)
  return suffix === null ? `${repo} (${owner})` : `${repo} › ${suffix} (${owner})`
}

/** 仓库名之后那段路径压成一个短标识；指向仓库根时返回 null。 */
function pathSuffix(rest: string[]): string | null {
  if (rest.length === 0) return null
  if (REF_PREFIXES.has(rest[0]!)) {
    // blob/tree 后面跟的是分支或 commit，对人没有意义，连同它一起丢掉
    const withinRepo = rest.slice(2)
    return withinRepo.at(-1) ?? null
  }
  return rest.join('/')
}

export interface TitleProposal {
  providerId: string
  oldTitle: string
  newTitle: string
  reason: string
}

export interface TitleNormalizationRule {
  id: string
  category: 'code' | 'content'
  label: string
  match(item: BookmarkItem): boolean
  propose(item: BookmarkItem): TitleProposal | null
}

export interface TitleRuleGroup {
  id: string
  category: 'code' | 'content'
  label: string
  ruleIds: readonly string[]
}

export const githubRule: TitleNormalizationRule = {
  id: 'github',
  category: 'code',
  label: 'titleRuleGithub',
  match(item) {
    const url = sanitizeUrl(item.url)
    return url !== null && url.domain === 'github.com'
  },
  propose(item) {
    const newTitle = githubTitle(item)
    if (newTitle === null || newTitle === item.title || newTitle === '') return null
    return {
      providerId: 'github',
      oldTitle: item.title,
      newTitle,
      reason: 'titleRuleGithubReason',
    }
  },
}

export const TITLE_RULES: TitleNormalizationRule[] = [
  githubRule, gitlabRule, npmRule, pypiRule, dockerRule, huggingfaceRule,
]

export const TITLE_RULE_GROUPS: TitleRuleGroup[] = [
  { id: 'github', category: 'code', label: 'titleRuleGithub', ruleIds: ['github'] },
  { id: 'gitlab', category: 'code', label: 'titleRuleGitlab', ruleIds: ['gitlab'] },
  { id: 'packages', category: 'code', label: 'titleRulePackages', ruleIds: ['npm', 'pypi', 'docker'] },
  { id: 'huggingface', category: 'code', label: 'titleRuleHuggingface', ruleIds: ['huggingface'] },
]

export const DEFAULT_TITLE_RULE_IDS: readonly string[] = ['github']

export function planTitleRewrites(
  items: BookmarkItem[],
  ruleIds: readonly string[] = DEFAULT_TITLE_RULE_IDS,
): TitleRewrite[] {
  const selected = TITLE_RULES.filter((rule) => ruleIds.includes(rule.id))
  const seen = new Set<string>()
  const out: TitleRewrite[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    for (const rule of selected) {
      let proposal: TitleProposal | null = null
      try {
        if (!rule.match(item)) continue
        proposal = rule.propose(item)
      } catch {
        continue
      }
      if (proposal === null) continue
      if (proposal.newTitle === '' || proposal.newTitle === item.title) continue
      seen.add(item.id)
      out.push({
        bookmarkId: item.id,
        oldTitle: item.title,
        newTitle: proposal.newTitle,
        providerId: proposal.providerId,
        reason: proposal.reason,
      })
      break
    }
  }
  return out
}
