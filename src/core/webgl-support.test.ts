import { describe, expect, it } from 'vitest'
import { isSoftwareRenderer } from './webgl-support'

describe('isSoftwareRenderer', () => {
  it('flags CPU rasterisers', () => {
    expect(
      isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)')
    ).toBe(true)
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true)
  })
  it('accepts real GPUs', () => {
    expect(
      isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')
    ).toBe(false)
  })
})
