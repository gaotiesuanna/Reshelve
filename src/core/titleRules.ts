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
