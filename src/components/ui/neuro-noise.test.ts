import { describe, expect, it } from 'vitest'
import { isSoftwareRenderer } from './neuro-noise'

// The start screen's water stands still where WebGL is drawn on the CPU
// (repository analysis of 2026-11-02: it starved the page in CI).
describe('isSoftwareRenderer', () => {
  it('knows WebGL drawn on the CPU', () => {
    for (const renderer of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ]) {
      expect(isSoftwareRenderer(renderer), renderer).toBe(true)
    }
  })

  it('lets a real GPU animate', () => {
    for (const renderer of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple M1',
      'Mali-G78',
      '',
    ]) {
      expect(isSoftwareRenderer(renderer), renderer).toBe(false)
    }
  })
})
