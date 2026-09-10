import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkedIdsFromLocation,
  isTabView,
  modeFromLocation,
  stepFromLocation,
} from '@/sidepanel/lib/openInTab'

beforeEach(() => {
  window.history.pushState({}, '', '/')
})

describe('完整标签页 URL 上的落点', () => {
  it('view=tab 才是完整标签页形态', () => {
    expect(isTabView()).toBe(false)
    window.history.pushState({}, '', '/?view=tab')
    expect(isTabView()).toBe(true)
  })

  it('读 mode，乱写的退回 null', () => {
    window.history.pushState({}, '', '/?view=tab&mode=dashboard')
    expect(modeFromLocation()).toBe('dashboard')
    window.history.pushState({}, '', '/?view=tab&mode=nope')
    expect(modeFromLocation()).toBeNull()
  })

  it('读 step，乱写的退回 null——扩展后要停在偏好页，不能 silently 掉回范围页', () => {
    window.history.pushState({}, '', '/?view=tab&mode=organize&step=preferences')
    expect(stepFromLocation()).toBe('preferences')
    window.history.pushState({}, '', '/?view=tab&step=nope')
    expect(stepFromLocation()).toBeNull()
  })

  it('读勾选的目录 id；参数缺席是 null，好跟「没带」区分', () => {
    window.history.pushState({}, '', '/?ids=1,10,11')
    expect(checkedIdsFromLocation()).toEqual(new Set(['1', '10', '11']))
    window.history.pushState({}, '', '/')
    expect(checkedIdsFromLocation()).toBeNull()
  })
})
