import { Mesh, OrthographicCamera, Points, Scene, Vector2, WebGLRenderer, type BufferAttribute, type ShaderMaterial } from 'three'

import type { SceneComposition } from './compositions'
import { bodyPosition, orbitEllipse, starField, starMargin, type Point } from './geometry'
import { snapshotOf, STAR_DEPTH, type SceneSnapshot } from './interpolate'
import type { SceneFrame } from './layout'
import { createBodies, createOrbit, createStars, setLayerState, setOrbit } from './layers'
import { maxPixelRatio, type RenderTier } from './quality'
import { SnapshotTween, type SceneTransition } from './tween'

export interface SceneDirectorOptions {
  canvas: HTMLCanvasElement
  tier: RenderTier
  /** Freeze time and render single frames for visual tests. */
  deterministic: boolean
  onContextLost: () => void
  /** Places the DOM plate under the canvas; called on every rendered frame. */
  onPlate: (snapshot: SceneSnapshot) => void
}

export interface SceneLayout {
  frame: SceneFrame
  composition: SceneComposition
  /** Planet centre of the hero for this viewport: the star field is at rest there. */
  origin: Point
}

interface Layers {
  /** What the layers were built for; anything else is a uniform. */
  key: string
  stars: Points
  orbits: Mesh[]
  glows: Points
  moons: Points
}

/** Parallax travel at full pointer deflection, in design units. */
const PARALLAX = 10
/** Depth of the orbit plane relative to the pointer. */
const ORBIT_DEPTH = 1
/** Fraction of the viewport the shifting star field extends past each edge. */
const STAR_MARGIN = 0.35

function layersKey({ frame, composition }: SceneLayout): string {
  const bodies = composition.bodies.map((b) => `${b.kind}:${String(b.size)}`).join(',')
  return [frame.viewport.width, frame.viewport.height, frame.u, composition.starDensity, composition.orbits.radii.length, bodies].join('|')
}

/**
 * Owns the single WebGLRenderer and the single requestAnimationFrame loop of
 * the app (ARCHITECTURE_MVP_v2 §17.1). Framework-agnostic: Vue drives it from
 * CosmosCanvas. The canvas is transparent: the painted plate lives in the DOM
 * poster underneath and WebGL adds what moves — stars, orbits and bodies.
 * Camera moves (V1.2) interpolate snapshots of two compositions; the plate
 * is placed from the same snapshot in the same frame.
 */
export class SceneDirector {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(0, 1, 0, 1, -10, 10)
  private readonly options: SceneDirectorOptions
  private readonly tween = new SnapshotTween()
  private frame = 0
  private running = false
  private visible = true
  private motion = true
  private layout: SceneLayout | null = null
  private layers: Layers | null = null
  private pixelRatio = 1
  private time = 0
  private lastTick = 0
  private readonly pointerTarget = new Vector2()
  private readonly pointer = new Vector2()
  private readonly offset = new Vector2()

  constructor(options: SceneDirectorOptions) {
    this.options = options
    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x000000, 0)
    options.canvas.addEventListener('webglcontextlost', this.handleContextLost)
  }

  /** The scene as it is on screen now, mid-flight included. */
  get snapshot(): SceneSnapshot | null {
    return this.tween.current
  }

  get moving(): boolean {
    return this.tween.active
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.pixelRatio = Math.min(devicePixelRatio, maxPixelRatio[this.options.tier])
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.setSize(width, height, false)
    this.camera.right = width
    this.camera.bottom = height
    this.camera.updateProjectionMatrix()
    this.applyPixelRatio()
    this.render()
  }

  /**
   * Sets the composition to show. Without a transition (first frame, resize,
   * reduced motion, deterministic mode) the scene snaps; with one the camera
   * flies there from wherever it is now.
   */
  setLayout(layout: SceneLayout, transition?: SceneTransition): void {
    this.layout = layout
    this.ensureLayers(layout)
    const target = snapshotOf(layout.frame, layout.composition, layout.origin)
    if (!transition || this.options.deterministic) this.tween.snap(target)
    else this.tween.retarget(target, transition, performance.now())
    this.sync()
    this.render()
  }

  /** Dev and visual tests: renders `progress` of the flight between two layouts. */
  preview(from: SceneLayout, to: SceneLayout, progress: number, transition: SceneTransition): void {
    this.layout = to
    this.ensureLayers(to)
    this.tween.snap(snapshotOf(from.frame, from.composition, from.origin))
    const start = performance.now()
    this.tween.retarget(snapshotOf(to.frame, to.composition, to.origin), transition, start)
    this.tween.step(start + progress * transition.duration)
    const frozen = this.tween.current
    if (frozen) this.tween.snap(frozen)
    this.render()
  }

  /** Ambient motion on/off: the pause control and prefers-reduced-motion. */
  setMotion(enabled: boolean): void {
    this.motion = enabled
    if (!enabled) this.pointerTarget.set(0, 0)
    this.sync()
  }

  /** Pointer in −1…1 from the viewport centre; only used for fine pointers. */
  setPointer(x: number, y: number): void {
    if (!this.motion || this.options.deterministic) return
    this.pointerTarget.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)))
  }

  start(): void {
    this.visible = true
    this.sync()
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.frame)
  }

  /** Paused in hidden tabs; server work is unaffected (MOTION_SPEC §5). */
  setVisible(visible: boolean): void {
    this.visible = visible
    this.sync()
  }

  dispose(): void {
    this.stop()
    this.options.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.disposeLayers()
    this.renderer.dispose()
  }

  private get ambient(): boolean {
    return this.motion && !this.options.deterministic
  }

  /** The loop runs while ambient motion is on or the camera is flying, and only in a visible tab. */
  private sync(): void {
    const animate = this.visible && (this.ambient || this.tween.active)
    if (animate && !this.running) {
      this.running = true
      this.lastTick = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    } else if (!animate && this.running) {
      this.stop()
      this.pointer.copy(this.pointerTarget)
      this.render()
    }
    if (!this.visible && this.tween.active) {
      // A hidden tab does not fly: on return the scene is already there.
      this.tween.step(Number.POSITIVE_INFINITY)
      this.render()
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return
    const dt = Math.min((now - this.lastTick) / 1000, 0.1)
    this.lastTick = now
    if (this.ambient) {
      this.time += dt
      // Critically damped follow: no overshoot, settles in about a second.
      this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-dt * 3.5))
    }
    this.tween.step(now)
    this.render()
    if (this.ambient || this.tween.active) {
      this.frame = requestAnimationFrame(this.tick)
    } else {
      this.running = false
    }
  }

  private render(): void {
    const snapshot = this.tween.current
    if (this.layout && this.layers && snapshot) {
      this.update(this.layout, this.layers, snapshot)
      this.options.onPlate(snapshot)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private update({ composition }: SceneLayout, layers: Layers, s: SceneSnapshot): void {
    const travel = PARALLAX * s.u
    this.offset.set(s.stars.x + this.pointer.x * travel * STAR_DEPTH, s.stars.y + this.pointer.y * travel * STAR_DEPTH)
    setLayerState(layers.stars, s.intensity, this.offset)
    const starUniforms = (layers.stars.material as ShaderMaterial).uniforms
    if (starUniforms.uTime) starUniforms.uTime.value = this.time

    this.offset.set(this.pointer.x * travel * ORBIT_DEPTH, this.pointer.y * travel * ORBIT_DEPTH)
    layers.orbits.forEach((orbit, i) => {
      setOrbit(orbit, orbitEllipse(s.planet, s.orbits, i), s.orbits, s.planet, s.u)
      setLayerState(orbit, s.intensity, this.offset)
    })
    for (const [kind, points] of [['glow', layers.glows], ['moon', layers.moons]] as const) {
      setLayerState(points, s.intensity, this.offset)
      const uniforms = (points.material as ShaderMaterial).uniforms
      if (uniforms.uScale) uniforms.uScale.value = s.bodyScale
      const position = points.geometry.getAttribute('position') as BufferAttribute
      composition.bodies
        .filter((body) => body.kind === kind)
        .forEach((body, i) => {
          const p = bodyPosition(s.planet, s.orbits, body, this.time, s.bodyPhase)
          position.setXY(i, p.x, p.y)
        })
      position.needsUpdate = true
    }
  }

  /** Geometry depends only on the viewport and the body set; camera moves reuse it. */
  private ensureLayers(layout: SceneLayout): void {
    const key = layersKey(layout)
    if (this.layers?.key === key) return
    this.disposeLayers()
    const { frame, composition } = layout
    const sizeOf = (kind: 'glow' | 'moon'): number[] =>
      composition.bodies.filter((b) => b.kind === kind).map((b) => b.size * frame.u)
    const margin = Math.max(frame.viewport.width, frame.viewport.height) * STAR_MARGIN
    const stars = [...starField(frame.viewport, composition.starDensity), ...starMargin(frame.viewport, composition.starDensity, margin)]
    const orbits = composition.orbits.radii.map(() => createOrbit())
    this.layers = {
      key,
      stars: createStars(stars),
      orbits,
      glows: createBodies(sizeOf('glow'), 'glow'),
      moons: createBodies(sizeOf('moon'), 'moon'),
    }
    this.scene.add(this.layers.stars, ...orbits, this.layers.glows, this.layers.moons)
    this.applyPixelRatio()
  }

  private applyPixelRatio(): void {
    if (!this.layers) return
    for (const points of [this.layers.stars, this.layers.glows, this.layers.moons]) {
      const uniforms = (points.material as ShaderMaterial).uniforms
      if (uniforms.uPixelRatio) uniforms.uPixelRatio.value = this.pixelRatio
    }
  }

  private disposeLayers(): void {
    if (!this.layers) return
    const { stars, orbits, glows, moons } = this.layers
    for (const object of [stars, ...orbits, glows, moons]) {
      this.scene.remove(object)
      object.geometry.dispose()
      ;(object.material as ShaderMaterial).dispose()
    }
    this.layers = null
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault()
    this.stop()
    this.options.onContextLost()
  }
}
