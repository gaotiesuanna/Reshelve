import { describe, it, expect } from 'vitest'
import { planTitleRewrites } from '@/core/titles'
import type { BookmarkItem } from '@/core/types'

function item(url: string, title = '原标题', id = '1'): BookmarkItem {
  return { id, title, url, parentId: '0', index: 0, currentPath: [] }
}

describe('GitLab', () => {
  it('项目页生成 project · group', () => {
    expect(planTitleRewrites(
      [item('https://gitlab.com/gitlab-org/gitlab', 'GitLab')],
      ['gitlab'],
    )[0]?.newTitle).toBe('gitlab · gitlab-org')
  })

  it('嵌套 group 用最后两段', () => {
    expect(planTitleRewrites(
      [item('https://gitlab.com/a/b/c', 'x')],
      ['gitlab'],
    )[0]?.newTitle).toBe('c · b')
  })

  it('/-/ 之后的文件路径不参与最后两段', () => {
    expect(planTitleRewrites(
      [item('https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md', 'x')],
      ['gitlab'],
    )[0]?.newTitle).toBe('gitlab · gitlab-org')
  })

  it('保留路径与单段用户页不处理', () => {
    expect(planTitleRewrites([item('https://gitlab.com/explore')], ['gitlab'])).toEqual([])
    expect(planTitleRewrites([item('https://gitlab.com/gitlab-org')], ['gitlab'])).toEqual([])
  })

  it('已是目标标题则跳过', () => {
    expect(planTitleRewrites(
      [item('https://gitlab.com/gitlab-org/gitlab', 'gitlab · gitlab-org')],
      ['gitlab'],
    )).toEqual([])
  })
})

describe('npm / PyPI / Docker Hub', () => {
  it('npm 包名带 (npm)，scoped 保留 scope', () => {
    expect(planTitleRewrites(
      [item('https://www.npmjs.com/package/vitest', 'vitest')],
      ['npm'],
    )[0]?.newTitle).toBe('vitest (npm)')
    expect(planTitleRewrites(
      [item('https://www.npmjs.com/package/@vue/compiler-sfc', 'sfc')],
      ['npm'],
    )[0]?.newTitle).toBe('@vue/compiler-sfc (npm)')
  })

  it('npm 版本段忽略', () => {
    expect(planTitleRewrites(
      [item('https://www.npmjs.com/package/vitest/v/2.0.0', 'x')],
      ['npm'],
    )[0]?.newTitle).toBe('vitest (npm)')
  })

  it('PyPI 项目名带 (PyPI)', () => {
    expect(planTitleRewrites(
      [item('https://pypi.org/project/requests/', 'requests')],
      ['pypi'],
    )[0]?.newTitle).toBe('requests (PyPI)')
  })

  it('Docker 保留 namespace；官方镜像不写 library', () => {
    expect(planTitleRewrites(
      [item('https://hub.docker.com/r/bitnami/nginx', 'nginx')],
      ['docker'],
    )[0]?.newTitle).toBe('bitnami/nginx (Docker)')
    expect(planTitleRewrites(
      [item('https://hub.docker.com/_/nginx', 'nginx')],
      ['docker'],
    )[0]?.newTitle).toBe('nginx (Docker)')
    expect(planTitleRewrites(
      [item('https://hub.docker.com/repository/docker/bitnami/redis', 'redis')],
      ['docker'],
    )[0]?.newTitle).toBe('bitnami/redis (Docker)')
  })

  it('非目标 URL 不处理', () => {
    expect(planTitleRewrites([item('https://example.com/package/vitest')], ['npm'])).toEqual([])
    expect(planTitleRewrites([item('https://pypi.org/')], ['pypi'])).toEqual([])
  })
})

describe('Hugging Face', () => {
  it('model 生成 name (owner)', () => {
    expect(planTitleRewrites(
      [item('https://huggingface.co/google/gemma-2b', 'gemma')],
      ['huggingface'],
    )[0]?.newTitle).toBe('gemma-2b (google)')
  })

  it('dataset 带类型标记', () => {
    expect(planTitleRewrites(
      [item('https://huggingface.co/datasets/glue/sst2', 'sst2')],
      ['huggingface'],
    )[0]?.newTitle).toBe('sst2 (glue) · dataset')
  })

  it('spaces / docs / 缺段不处理', () => {
    expect(planTitleRewrites(
      [item('https://huggingface.co/spaces/foo/bar', 'app')],
      ['huggingface'],
    )).toEqual([])
    expect(planTitleRewrites(
      [item('https://huggingface.co/docs/transformers', 'docs')],
      ['huggingface'],
    )).toEqual([])
    expect(planTitleRewrites(
      [item('https://huggingface.co/google', 'google')],
      ['huggingface'],
    )).toEqual([])
  })
})

describe('规则筛选', () => {
  it('只跑点名的规则', () => {
    const items = [
      item('https://github.com/sst/opencode', 'gh', 'g'),
      item('https://gitlab.com/gitlab-org/gitlab', 'gl', 'l'),
    ]
    expect(planTitleRewrites(items, ['gitlab']).map((r) => r.bookmarkId)).toEqual(['l'])
  })
})

describe('内容平台噪音清理', () => {
  it('YouTube 去掉平台前缀，保留视频标题', () => {
    expect(planTitleRewrites(
      [item('https://www.youtube.com/watch?v=abc', 'YouTube - 某个视频', 'y')],
      ['youtube'],
    )[0]?.newTitle).toBe('某个视频')
    expect(planTitleRewrites(
      [item('https://youtu.be/abc', 'YouTube: 某个视频', 'y2')],
      ['youtube'],
    )[0]?.newTitle).toBe('某个视频')
  })

  it('YouTube 无前缀或清完为空则不处理', () => {
    expect(planTitleRewrites(
      [item('https://www.youtube.com/watch?v=abc', '某个视频')],
      ['youtube'],
    )).toEqual([])
    expect(planTitleRewrites(
      [item('https://www.youtube.com/watch?v=abc', 'YouTube - ')],
      ['youtube'],
    )).toEqual([])
  })

  it('CSDN / 知乎 / 掘金 / Bilibili 去前缀', () => {
    expect(planTitleRewrites(
      [item('https://blog.csdn.net/u/p', 'CSDN博客 - 一篇文章')],
      ['csdn'],
    )[0]?.newTitle).toBe('一篇文章')
    expect(planTitleRewrites(
      [item('https://zhuanlan.zhihu.com/p/1', '知乎 - 一个问题')],
      ['zhihu'],
    )[0]?.newTitle).toBe('一个问题')
    expect(planTitleRewrites(
      [item('https://juejin.cn/post/1', '掘金 - 一篇')],
      ['juejin'],
    )[0]?.newTitle).toBe('一篇')
    expect(planTitleRewrites(
      [item('https://www.bilibili.com/video/BV1', '哔哩哔哩 - 一个视频')],
      ['bilibili'],
    )[0]?.newTitle).toBe('一个视频')
  })

  it('Medium / Dev.to 去站点前缀和重复后缀', () => {
    expect(planTitleRewrites(
      [item('https://medium.com/@a/p', 'Hello - Medium')],
      ['medium'],
    )[0]?.newTitle).toBe('Hello')
    expect(planTitleRewrites(
      [item('https://dev.to/a/p', 'Hello - DEV Community')],
      ['devto'],
    )[0]?.newTitle).toBe('Hello')
  })

  it('匹配看 host 不看标题：CSDN 标题里的「知乎 -」不算知乎', () => {
    expect(planTitleRewrites(
      [item('https://blog.csdn.net/u/p', '知乎 - 其实是 CSDN')],
      ['zhihu'],
    )).toEqual([])
  })

  it('标题已干净或非目标 host 不处理', () => {
    expect(planTitleRewrites(
      [item('https://example.com/x', 'YouTube - 假的')],
      ['youtube'],
    )).toEqual([])
  })
})
