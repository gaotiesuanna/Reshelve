import { describe, it, expect } from 'vitest'
import { githubTitle, planTitleRewrites } from '@/core/titles'
import type { BookmarkItem } from '@/core/types'

function item(url: string, title = '原标题', id = '1'): BookmarkItem {
  return { id, title, url, parentId: '0', index: 0, currentPath: [] }
}

describe('githubTitle', () => {
  it('仓库首页压成 repo (owner)', () => {
    expect(githubTitle(item('https://github.com/op7418/Claude-to-IM-skill')))
      .toBe('Claude-to-IM-skill (op7418)')
    expect(githubTitle(item('https://github.com/sst/opencode'))).toBe('opencode (sst)')
  })

  it('www 前缀与结尾斜杠不影响结果', () => {
    expect(githubTitle(item('https://www.github.com/sst/opencode/'))).toBe('opencode (sst)')
  })

  it('query 与 fragment 被丢弃', () => {
    expect(githubTitle(item('https://github.com/sst/opencode?tab=readme#install')))
      .toBe('opencode (sst)')
  })

  it('blob 子页面保留文件名', () => {
    expect(githubTitle(item('https://github.com/jnMetaCode/superpowers-zh/blob/main/docs/README.codex.md')))
      .toBe('superpowers-zh › README.codex.md (jnMetaCode)')
  })

  it('tree 子目录保留目录名', () => {
    expect(githubTitle(item('https://github.com/opendatalab/MinerU/tree/main/docs')))
      .toBe('MinerU › docs (opendatalab)')
  })

  it('tree 指向分支根等同于仓库首页', () => {
    expect(githubTitle(item('https://github.com/sst/opencode/tree/main'))).toBe('opencode (sst)')
  })

  it('issue 与 PR 保留编号', () => {
    expect(githubTitle(item('https://github.com/langchain-ai/langchain/issues/12345')))
      .toBe('langchain › issues/12345 (langchain-ai)')
    expect(githubTitle(item('https://github.com/langchain-ai/langchain/pull/99')))
      .toBe('langchain › pull/99 (langchain-ai)')
  })

  it('GitHub 自己的保留路径不当成仓库', () => {
    expect(githubTitle(item('https://github.com/settings/profile'))).toBeNull()
    expect(githubTitle(item('https://github.com/topics/rag'))).toBeNull()
    expect(githubTitle(item('https://github.com/orgs/anthropics/repositories'))).toBeNull()
  })

  it('路径不足两段时返回 null', () => {
    expect(githubTitle(item('https://github.com/sst'))).toBeNull()
    expect(githubTitle(item('https://github.com'))).toBeNull()
  })

  it('非 GitHub 域名返回 null', () => {
    expect(githubTitle(item('https://gitlab.com/a/b'))).toBeNull()
    expect(githubTitle(item('https://evil.com/github.com/a/b'))).toBeNull()
  })

  it('子域不算 GitHub', () => {
    expect(githubTitle(item('https://gist.github.com/a/b'))).toBeNull()
  })

  it('非法 URL 返回 null', () => {
    expect(githubTitle(item('chrome://bookmarks'))).toBeNull()
    expect(githubTitle(item('not a url'))).toBeNull()
  })
})

describe('planTitleRewrites', () => {
  it('只为标题确实会变的书签生成改名，并带上 github 的 provider/reason', () => {
    const rewrites = planTitleRewrites([
      item('https://github.com/sst/opencode', 'sst/opencode', 'a'),
      item('https://github.com/sst/opencode', 'opencode (sst)', 'b'),
    ])
    expect(rewrites).toEqual([
      {
        bookmarkId: 'a',
        oldTitle: 'sst/opencode',
        newTitle: 'opencode (sst)',
        providerId: 'github',
        reason: 'titleRuleGithubReason',
      },
    ])
  })

  it('非 GitHub 书签不参与', () => {
    expect(planTitleRewrites([item('https://example.com/x', '随便')])).toEqual([])
  })

  it('ruleIds 为空时不产生改名', () => {
    expect(planTitleRewrites([
      item('https://github.com/sst/opencode', 'sst/opencode', 'a'),
    ], [])).toEqual([])
  })

  it('未点名的规则不跑', () => {
    expect(planTitleRewrites([
      item('https://github.com/sst/opencode', 'sst/opencode', 'a'),
    ], ['youtube'])).toEqual([])
  })

  it('同一书签最多一条，按注册表顺序', () => {
    const rewrites = planTitleRewrites([
      item('https://github.com/sst/opencode', 'sst/opencode', 'a'),
      item('https://github.com/sst/opencode', 'sst/opencode', 'a'),
    ])
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0]?.bookmarkId).toBe('a')
  })

  it('非法 URL 与空标题不抛', () => {
    expect(() => planTitleRewrites([
      item('not a url', 'x', 'bad'),
      item('chrome://bookmarks', '', 'chrome'),
      item('https://github.com/sst/opencode', '旧', 'ok'),
    ])).not.toThrow()
    expect(planTitleRewrites([
      item('https://github.com/sst/opencode', '旧', 'ok'),
    ]).map((r) => r.bookmarkId)).toEqual(['ok'])
  })
})
