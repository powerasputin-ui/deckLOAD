// The 3D view's «Вписать» (spec 6.10): the camera looks down at the scene at
// a fixed elevation from the side of the screen's bottom edge (+z), and
// stands back just far enough for every given point to fall within `fill`
// of the canvas each way, the picture centred on the screen.
//
// With `back` the unit vector from the target to the camera and `up` the
// screen's up, a camera `d` back from a target `s` up the screen shows a
// point p at x / ((d − p·back)·tanH) across and (p·up − s) / ((d − p·back)·tanV)
// up. Each bound is linear in d, so the least distance for a given s is a
// maximum over the points, convex in s.

export interface CameraFit {
  position: [number, number, number]
  target: [number, number, number]
}

export interface CameraFitOptions {
  // The vertical field of view, degrees.
  fov: number
  // Canvas width over height.
  aspect: number
  // Above the horizon, radians.
  elevation: number
  // The share of the canvas, each way, the points may take.
  fill: number
}

export function fitCamera(points: readonly { x: number; y: number; z: number }[], options: CameraFitOptions): CameraFit {
  const { fov, aspect, elevation, fill } = options
  const sin = Math.sin(elevation)
  const cos = Math.cos(elevation)
  const place = (distance: number, shift: number): CameraFit => ({
    position: [0, shift * cos + distance * sin, -shift * sin + distance * cos],
    target: [0, shift * cos, -shift * sin],
  })
  if (points.length === 0) return place(10, 0)
  const tanV = Math.tan((fov * Math.PI) / 360)
  const tanH = tanV * aspect
  // Each point across the screen, up it, and towards the camera.
  const seen = points.map((p) => ({ across: p.x, up: p.y * cos - p.z * sin, near: p.y * sin + p.z * cos }))
  const distanceFor = (shift: number) => {
    let distance = -Infinity
    for (const p of seen) {
      distance = Math.max(distance, p.near + Math.max(Math.abs(p.across) / tanH, Math.abs(p.up - shift) / tanV) / fill)
    }
    return distance
  }
  let lowest = Infinity
  let highest = -Infinity
  for (const p of seen) {
    lowest = Math.min(lowest, p.up)
    highest = Math.max(highest, p.up)
  }

  // The least distance: convex in the shift, so narrowed down by thirds.
  let low = lowest
  let high = highest
  for (let i = 0; i < 60; i++) {
    const a = low + (high - low) / 3
    const b = high - (high - low) / 3
    if (distanceFor(a) <= distanceFor(b)) high = b
    else low = a
  }
  const distance = distanceFor((low + high) / 2)

  // At that distance, the shift that leaves as much room above the picture
  // as below it — no further from fitting than the one found above.
  low = lowest
  high = highest
  for (let i = 0; i < 60; i++) {
    const shift = (low + high) / 2
    let top = -Infinity
    let bottom = Infinity
    for (const p of seen) {
      const height = (p.up - shift) / (distance - p.near)
      top = Math.max(top, height)
      bottom = Math.min(bottom, height)
    }
    if (top + bottom > 0) low = shift
    else high = shift
  }
  return place(distance, (low + high) / 2)
}
