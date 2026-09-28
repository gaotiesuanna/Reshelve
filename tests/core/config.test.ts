import { describe, it, expect } from 'vitest'
import {
  SWEET_LEAF,
  MAX_LEAF,
  STRETCH_LEAF,
  SHAPE_MAX_SIBLINGS,
  MAX_SIBLINGS,
  FALLBACK_SHARE_LIMIT,
} from '@/core/config'

describe('folder-shape config', () => {
  it('MAX_SIBLINGS is greater than SHAPE_MAX_SIBLINGS', () => {
    expect(MAX_SIBLINGS).toBeGreaterThan(SHAPE_MAX_SIBLINGS)
  })

  it('STRETCH_LEAF is greater than MAX_LEAF', () => {
    expect(STRETCH_LEAF).toBeGreaterThan(MAX_LEAF)
  })

  it('MAX_LEAF equals SWEET_LEAF', () => {
    expect(MAX_LEAF).toBe(SWEET_LEAF)
  })

  it('pins current literals', () => {
    expect(SWEET_LEAF).toBe(12)
    expect(STRETCH_LEAF).toBe(20)
    expect(SHAPE_MAX_SIBLINGS).toBe(15)
    expect(MAX_SIBLINGS).toBe(17)
    expect(FALLBACK_SHARE_LIMIT).toBe(0.1)
  })
})
