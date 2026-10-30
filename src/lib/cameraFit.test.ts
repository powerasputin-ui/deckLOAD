import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fitCamera, type CameraFitOptions } from './cameraFit'

// The demo deck as 3D lays it out — 20 m across the screen, 8 m into it —
// with a 20ft container (2.6 m tall) standing at its back left corner.
const deck = [-10, 10].flatMap((x) => [-4, 4].map((z) => ({ x, y: 0, z })))
const container = [-10, -3.9].flatMap((x) => [0, 2.6].flatMap((y) => [-4, -1.56].map((z) => ({ x, y, z }))))
const scene = [...deck, ...container]

// Where each point lands on the canvas, −1…1 each way.
function onCanvas(points: { x: number; y: number; z: number }[], options: CameraFitOptions) {
  const fit = fitCamera(points, options)
  const camera = new THREE.PerspectiveCamera(options.fov, options.aspect, 0.1, 1000)
  camera.position.set(...fit.position)
  camera.lookAt(...fit.target)
  camera.updateMatrixWorld()
  return { fit, seen: points.map((p) => new THREE.Vector3(p.x, p.y, p.z).project(camera)) }
}

const wide: CameraFitOptions = { fov: 30, aspect: 1080 / 808, elevation: (60 * Math.PI) / 180, fill: 0.92 }

describe('3D «Вписать»', () => {
  it('fits every point within the margin, and the binding one right at it', () => {
    const { seen } = onCanvas(scene, wide)
    const furthest = Math.max(...seen.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]))
    expect(furthest).toBeCloseTo(0.92, 4)
    for (const p of seen) expect(p.z).toBeLessThan(1)
  })

  it('centres the picture up and down', () => {
    const { seen } = onCanvas(scene, wide)
    const top = Math.max(...seen.map((p) => p.y))
    const bottom = Math.min(...seen.map((p) => p.y))
    expect(top + bottom).toBeCloseTo(0, 4)
  })

  it('a narrow canvas is filled across, a flat one top to bottom', () => {
    const narrow = onCanvas(scene, { ...wide, aspect: 0.5 }).seen
    expect(Math.max(...narrow.map((p) => Math.abs(p.x)))).toBeCloseTo(0.92, 4)
    const flat = onCanvas(scene, { ...wide, aspect: 6 }).seen
    expect(Math.max(...flat.map((p) => Math.abs(p.y)))).toBeCloseTo(0.92, 4)
    expect(Math.max(...flat.map((p) => Math.abs(p.x)))).toBeLessThan(0.92)
  })

  it('looks down at the given elevation from the bottom edge of the screen', () => {
    const fit = fitCamera(scene, wide)
    const look = new THREE.Vector3(...fit.position).sub(new THREE.Vector3(...fit.target)).normalize()
    expect(look.x).toBeCloseTo(0, 6)
    expect(look.y).toBeCloseTo(Math.sin(wide.elevation), 6)
    expect(look.z).toBeCloseTo(Math.cos(wide.elevation), 6)
  })

  it('with nothing to show, still gives a camera looking at the origin', () => {
    const fit = fitCamera([], wide)
    for (const v of fit.target) expect(v).toBeCloseTo(0, 9)
    expect(fit.position[1]).toBeGreaterThan(0)
  })
})
