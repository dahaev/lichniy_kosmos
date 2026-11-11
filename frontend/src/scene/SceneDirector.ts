import { Mesh, OrthographicCamera, Points, Scene, Vector2, WebGLRenderer, type BufferAttribute, type ShaderMaterial } from 'three'

import type { CompositionName, SceneComposition } from './compositions'
import { bodyPosition, orbitEllipse, starField } from './geometry'
import type { SceneFrame } from './layout'
import { createBodies, createOrbit, createStars, setLayerState } from './layers'
import { maxPixelRatio, type RenderTier } from './quality'

export interface SceneDirectorOptions {
  canvas: HTMLCanvasElement
  tier: RenderTier
  /** Freeze time and render single frames for visual tests. */
  deterministic: boolean
  onContextLost: () => void
}

export interface SceneLayout {
  frame: SceneFrame
  composition: SceneComposition
}

interface Layers {
  stars: Points
  orbits: Mesh[]
  glows: Points
  moons: Points
}

/** Parallax travel at full pointer deflection, in design units. */
const PARALLAX = 10
/** Depth of each layer relative to the orbit plane. */
const DEPTH = { stars: 0.3, orbits: 1 } as const

/**
 * Owns the single WebGLRenderer and the single requestAnimationFrame loop of
 * the app (ARCHITECTURE_MVP_v2 §17.1). Framework-agnostic: Vue drives it from
 * CosmosCanvas. The canvas is transparent: the painted plate lives in the DOM
 * poster underneath and WebGL adds what moves — stars, orbits and bodies.
 */
export class SceneDirector {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(0, 1, 0, 1, -10, 10)
  private readonly options: SceneDirectorOptions
  private frame = 0
  private running = false
  private visible = true
  private motion = true
  private current: CompositionName = 'hero'
  private layout: SceneLayout | null = null
  private layers: Layers | null = null
  private pixelRatio = 1
  private time = 0
  private lastTick = 0
  private intensity = 1
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

  get composition(): CompositionName {
    return this.current
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

  /** Rebuilds the layers for a new viewport frame or composition. */
  setLayout(layout: SceneLayout): void {
    const first = this.layout === null
    this.layout = layout
    if (first || !this.running) this.intensity = layout.composition.intensity
    this.disposeLayers()

    const { frame, composition } = layout
    const orbits = composition.orbits.radii.map((_, i) =>
      createOrbit(orbitEllipse(frame.planet, composition.orbits, i), composition.orbits, frame.planet, frame.u),
    )
    const sizeOf = (kind: 'glow' | 'moon'): number[] =>
      composition.bodies.filter((b) => b.kind === kind).map((b) => b.size * frame.u)
    this.layers = {
      stars: createStars(starField(frame.viewport, composition.starDensity)),
      orbits,
      glows: createBodies(sizeOf('glow'), 'glow'),
      moons: createBodies(sizeOf('moon'), 'moon'),
    }
    this.scene.add(this.layers.stars, ...orbits, this.layers.glows, this.layers.moons)
    this.applyPixelRatio()
    this.render()
  }

  compose(name: CompositionName): void {
    this.current = name
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

  private sync(): void {
    const animate = this.visible && this.motion && !this.options.deterministic
    if (animate && !this.running) {
      this.running = true
      this.lastTick = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    } else if (!animate) {
      this.stop()
      this.pointer.copy(this.pointerTarget)
      this.render()
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return
    const dt = Math.min((now - this.lastTick) / 1000, 0.1)
    this.lastTick = now
    this.time += dt
    // Critically damped follow: no overshoot, settles in about a second.
    this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-dt * 3.5))
    if (this.layout) {
      const target = this.layout.composition.intensity
      this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * 2.5))
    }
    this.render()
    this.frame = requestAnimationFrame(this.tick)
  }

  private render(): void {
    if (this.layout && this.layers) this.update(this.layout, this.layers)
    this.renderer.render(this.scene, this.camera)
  }

  private update({ frame, composition }: SceneLayout, layers: Layers): void {
    const travel = PARALLAX * frame.u
    this.offset.set(this.pointer.x * travel * DEPTH.stars, this.pointer.y * travel * DEPTH.stars)
    setLayerState(layers.stars, this.intensity, this.offset)
    const starUniforms = (layers.stars.material as ShaderMaterial).uniforms
    if (starUniforms.uTime) starUniforms.uTime.value = this.time

    this.offset.set(this.pointer.x * travel * DEPTH.orbits, this.pointer.y * travel * DEPTH.orbits)
    for (const orbit of layers.orbits) setLayerState(orbit, this.intensity, this.offset)
    for (const [kind, points] of [['glow', layers.glows], ['moon', layers.moons]] as const) {
      setLayerState(points, this.intensity, this.offset)
      const position = points.geometry.getAttribute('position') as BufferAttribute
      composition.bodies
        .filter((body) => body.kind === kind)
        .forEach((body, i) => {
          const p = bodyPosition(frame.planet, composition.orbits, body, this.time)
          position.setXY(i, p.x, p.y)
        })
      position.needsUpdate = true
    }
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
