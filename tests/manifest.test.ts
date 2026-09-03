import { describe, it, expect } from 'vitest'

import manifestConfig from '../manifest.config'
import { REPO_URL } from '@/sidepanel/lib/about'

// defineManifest 是恒等函数，传进去的是对象字面量——这里拿到的就是那个对象。
const manifest = manifestConfig as { homepage_url?: string; version: string }

describe('manifest.config', () => {
  // 仓库地址此刻散落在三处：manifest 的 homepage_url、设置页「关于」区、docs/publishing.md
  // 的审核文案。改名时若漏掉一处，chrome://extensions 的「访问网站」会指向 404。
  it('homepage_url 与设置页「关于」区用的是同一个仓库地址', () => {
    expect(manifest.homepage_url).toBe(REPO_URL)
  })
})
