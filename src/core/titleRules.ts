import { sanitizeUrl } from './sanitize'
import type { BookmarkItem } from './types'
import type { TitleNormalizationRule, TitleProposal } from './titles'

function domainOf(item: { url: string }): string | null {
  return sanitizeUrl(item.url)?.domain ?? null
}

function segmentsOf(item: { url: string }): string[] | null {
  const url = sanitizeUrl(item.url)
  if (url === null) return null
  return url.path.split('/').filter(Boolean)
}

function proposal(
  rule: { id: string; reason: string },
  item: { title: string },
  newTitle: string | null,
): TitleProposal | null {
  if (newTitle === null || newTitle === '' || newTitle === item.title) return null
  return { providerId: rule.id, oldTitle: item.title, newTitle, reason: rule.reason }
}

const GITLAB_RESERVED = new Set([
  'explore',
  'users',
  'help',
  'admin',
  'groups',
  'projects',
  'dashboard',
  'search',
  'signin',
  'usersignup',
  'oauth',
])

function gitlabTitle(item: BookmarkItem): string | null {
  const segments = segmentsOf(item)
  if (segments === null) return null
  const dash = segments.indexOf('-')
  const projectPath = dash === -1 ? segments : segments.slice(0, dash)
  if (projectPath.length < 2) return null
  const first = projectPath[0]
  if (first === undefined || GITLAB_RESERVED.has(first)) return null
  const project = projectPath[projectPath.length - 1]
  const group = projectPath[projectPath.length - 2]
  if (project === undefined || group === undefined) return null
  return `${project} · ${group}`
}

export const gitlabRule: TitleNormalizationRule = {
  id: 'gitlab',
  category: 'code',
  label: 'titleRuleGitlab',
  match(item) {
    return domainOf(item) === 'gitlab.com'
  },
  propose(item) {
    return proposal({ id: 'gitlab', reason: 'titleRuleGitlabReason' }, item, gitlabTitle(item))
  },
}

function npmTitle(item: BookmarkItem): string | null {
  const segments = segmentsOf(item)
  if (segments === null || segments[0] !== 'package') return null
  const first = segments[1]
  if (first === undefined || first === '') return null
  if (first.startsWith('@')) {
    const scoped = segments[2]
    if (scoped === undefined || scoped === '') return null
    return `${first}/${scoped} (npm)`
  }
  return `${first} (npm)`
}

export const npmRule: TitleNormalizationRule = {
  id: 'npm',
  category: 'code',
  label: 'titleRuleNpm',
  match(item) {
    return domainOf(item) === 'npmjs.com'
  },
  propose(item) {
    return proposal({ id: 'npm', reason: 'titleRuleNpmReason' }, item, npmTitle(item))
  },
}

function pypiTitle(item: BookmarkItem): string | null {
  const segments = segmentsOf(item)
  if (segments === null || segments[0] !== 'project') return null
  const name = segments[1]
  if (name === undefined || name === '') return null
  return `${name} (PyPI)`
}

export const pypiRule: TitleNormalizationRule = {
  id: 'pypi',
  category: 'code',
  label: 'titleRulePypi',
  match(item) {
    return domainOf(item) === 'pypi.org'
  },
  propose(item) {
    return proposal({ id: 'pypi', reason: 'titleRulePypiReason' }, item, pypiTitle(item))
  },
}

function dockerTitle(item: BookmarkItem): string | null {
  const segments = segmentsOf(item)
  if (segments === null) return null
  if (segments[0] === '_') {
    const image = segments[1]
    if (image === undefined || image === '') return null
    return `${image} (Docker)`
  }
  if (segments[0] === 'r') {
    const ns = segments[1]
    const image = segments[2]
    if (ns === undefined || ns === '' || image === undefined || image === '') return null
    return `${ns}/${image} (Docker)`
  }
  if (segments[0] === 'repository' && segments[1] === 'docker') {
    const ns = segments[2]
    const image = segments[3]
    if (ns === undefined || ns === '' || image === undefined || image === '') return null
    return `${ns}/${image} (Docker)`
  }
  return null
}

export const dockerRule: TitleNormalizationRule = {
  id: 'docker',
  category: 'code',
  label: 'titleRuleDocker',
  match(item) {
    return domainOf(item) === 'hub.docker.com'
  },
  propose(item) {
    return proposal({ id: 'docker', reason: 'titleRuleDockerReason' }, item, dockerTitle(item))
  },
}

const HUGGINGFACE_RESERVED = new Set([
  'spaces',
  'models',
  'docs',
  'organizations',
  'login',
  'join',
  'blog',
  'learn',
  'pricing',
  'hardware',
  'api',
  'posts',
  'discuss',
  'support',
])

function huggingfaceTitle(item: BookmarkItem): string | null {
  const segments = segmentsOf(item)
  if (segments === null) return null
  const first = segments[0]
  if (first === undefined) return null
  if (first === 'datasets') {
    const owner = segments[1]
    const name = segments[2]
    if (owner === undefined || owner === '' || name === undefined || name === '') return null
    return `${name} (${owner}) · dataset`
  }
  if (HUGGINGFACE_RESERVED.has(first)) return null
  const owner = first
  const name = segments[1]
  if (name === undefined || name === '') return null
  return `${name} (${owner})`
}

export const huggingfaceRule: TitleNormalizationRule = {
  id: 'huggingface',
  category: 'code',
  label: 'titleRuleHuggingface',
  match(item) {
    return domainOf(item) === 'huggingface.co'
  },
  propose(item) {
    return proposal(
      { id: 'huggingface', reason: 'titleRuleHuggingfaceReason' },
      item,
      huggingfaceTitle(item),
    )
  },
}

const ARXIV_VIEWS: Record<string, true> = {
  abs: true,
  pdf: true,
  html: true,
  'e-print': true,
  src: true,
  ps: true,
  format: true,
}
const ARXIV_NEW_ID = /^(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i
const ARXIV_OLD_ARCHIVE = /^[a-z]+(?:-[a-z]+)?(?:\.[a-z]{2})?$/i
const ARXIV_OLD_NUMBER = /^(\d{7})(?:v\d+)?(?:\.pdf)?$/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function arxivIdFromSegments(segments: string[]): string | null {
  if (segments.length < 2) return null
  const view = segments[0]
  if (view === undefined || ARXIV_VIEWS[view] !== true) return null
  const first = segments[1]
  if (first === undefined) return null
  const neu = first.match(ARXIV_NEW_ID)
  if (neu?.[1] !== undefined) return neu[1]
  const number = segments[2]
  if (number === undefined || !ARXIV_OLD_ARCHIVE.test(first)) return null
  const old = number.match(ARXIV_OLD_NUMBER)
  if (old?.[1] === undefined) return null
  return `${first}/${old[1]}`
}

function stripArxivNoise(title: string, id: string): string {
  let next = title.trim()
  next = next.replace(/\s*[-|·\u2013\u2014]\s*ar5iv$/i, '').trim()
  next = next.replace(/\s*[-|·\u2013\u2014]\s*arXiv(?:\.org)?$/i, '').trim()
  next = next.replace(/^arXiv\.org\s*[-:\u2013\u2014]\s*/i, '').trim()
  next = next.replace(/^ar5iv\s*[-:\u2013\u2014]\s*/i, '').trim()
  next = next.replace(/^arXiv:\s*[\w.\-/]+(?:v\d+)?\s*(?:\[[^\]]+\])?\s*/i, '').trim()
  next = next.replace(/^\[(?:\d{4}\.\d{4,5}|[a-z][\w.\-]*\/\d{7})(?:v\d+)?\]\s*/i, '').trim()
  next = next.replace(new RegExp(`^${escapeRegExp(id)}(?:v\\d+)?(?:\\.pdf)?(?:\\s+|$)`, 'i'), '').trim()
  return next
}

function isGenericArxivTitle(title: string, id: string): boolean {
  if (title === '' || /^\(?arXiv\)?$/i.test(title) || /^ar5iv$/i.test(title)) return true
  if (/^arxiv(?:\.org)?$/i.test(title)) return true
  const compact = title.replace(/\.pdf$/i, '')
  if (compact.toLowerCase() === id.toLowerCase()) return true
  return new RegExp(`^${escapeRegExp(id)}v\\d+$`, 'i').test(compact)
}

function arxivTitle(item: BookmarkItem): string | null {
  const segments = segmentsOf(item)
  if (segments === null) return null
  const id = arxivIdFromSegments(segments)
  if (id === null) return null
  const cleaned = stripArxivNoise(item.title, id)
  if (isGenericArxivTitle(cleaned, id)) return `${id} (arXiv)`
  return `[${id}] ${cleaned}`
}

export const arxivRule: TitleNormalizationRule = {
  id: 'arxiv',
  category: 'content',
  label: 'titleRuleArxiv',
  match(item) {
    const domain = domainOf(item)
    return domain !== null && isHostOrSubdomain(domain, 'arxiv.org')
  },
  propose(item) {
    return proposal({ id: 'arxiv', reason: 'titleRuleArxivReason' }, item, arxivTitle(item))
  },
}

function cleanupTitle(title: string, patterns: readonly RegExp[]): string | null {
  let next = title.trim()
  const original = next
  for (const pattern of patterns) next = next.replace(pattern, '').trim()
  if (next === '' || next === original) return null
  return next
}

function hostRule(
  id: string,
  category: 'code' | 'content',
  label: string,
  reason: string,
  hosts: (domain: string) => boolean,
  patterns: readonly RegExp[],
): TitleNormalizationRule {
  return {
    id,
    category,
    label,
    match(item) {
      const domain = domainOf(item)
      return domain !== null && hosts(domain)
    },
    propose(item) {
      return proposal({ id, reason }, item, cleanupTitle(item.title, patterns))
    },
  }
}

function isHostOrSubdomain(domain: string, root: string): boolean {
  return domain === root || domain.endsWith(`.${root}`)
}

export const youtubeRule = hostRule(
  'youtube',
  'content',
  'titleRuleYoutube',
  'titleRuleYoutubeReason',
  (d) => d === 'youtu.be' || isHostOrSubdomain(d, 'youtube.com'),
  [/^YouTube\s*[-:\u2013\u2014]\s*/i],
)

export const csdnRule = hostRule(
  'csdn',
  'content',
  'titleRuleCsdn',
  'titleRuleCsdnReason',
  (d) => isHostOrSubdomain(d, 'csdn.net'),
  [/^CSDN博客\s*[-:\u2013\u2014]\s*/, /^CSDN\s*[-:\u2013\u2014]\s*/i],
)

export const zhihuRule = hostRule(
  'zhihu',
  'content',
  'titleRuleZhihu',
  'titleRuleZhihuReason',
  (d) => isHostOrSubdomain(d, 'zhihu.com'),
  [/^知乎\s*[-:\u2013\u2014]\s*/, /^问题\s*[-:\u2013\u2014]\s*/],
)

export const juejinRule = hostRule(
  'juejin',
  'content',
  'titleRuleJuejin',
  'titleRuleJuejinReason',
  (d) => d === 'juejin.cn' || d === 'juejin.im',
  [/^掘金\s*[-:\u2013\u2014]\s*/],
)

export const bilibiliRule = hostRule(
  'bilibili',
  'content',
  'titleRuleBilibili',
  'titleRuleBilibiliReason',
  (d) => d === 'b23.tv' || isHostOrSubdomain(d, 'bilibili.com'),
  [/^哔哩哔哩\s*[-:\u2013\u2014]\s*/, /^bilibili\s*[-:\u2013\u2014]\s*/i],
)

export const mediumRule = hostRule(
  'medium',
  'content',
  'titleRuleMedium',
  'titleRuleMediumReason',
  (d) => isHostOrSubdomain(d, 'medium.com'),
  [/^Medium\s*[-:\u2013\u2014]\s*/i, /\s*[-|\u00B7]\s*Medium$/i],
)

export const devtoRule = hostRule(
  'devto',
  'content',
  'titleRuleDevto',
  'titleRuleDevtoReason',
  (d) => d === 'dev.to',
  [/^DEV Community\s*[-:\u2013\u2014]\s*/i, /\s*[-|\u00B7]\s*DEV Community$/i, /\s*[-|\u00B7]\s*DEV\.to$/i],
)

