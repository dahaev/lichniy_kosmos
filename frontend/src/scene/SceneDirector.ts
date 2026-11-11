import { Color, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three'

import type { CompositionName } from './compositions'
import { maxPixelRatio, type RenderTier } from './quality'

export interface SceneDirectorOptions {
  canvas: HTMLCanvasElement
  tier: RenderTier
  /** CSS colour of the empty sky, read from --cosmos-bg. */
  background: string
  /** Freeze time and render single frames for visual tests. */
  deterministic: boolean
  onContextLost: () => void
}

/**
 * Owns the single WebGLRenderer and the single requestAnimationFrame loop of
 * the app (ARCHITECTURE_MVP_v2 §17.1). Framework-agnostic: Vue drives it from
 * CosmosCanvas. S0 renders an empty sky; layers arrive in V1.
 */
export class SceneDirector {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(35, 1, 0.1, 1000)
  private readonly options: SceneDirectorOptions
  private frame = 0
  private running = false
  private current: CompositionName = 'hero'

  constructor(options: SceneDirectorOptions) {
    this.options = options
    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: options.tier === 'high',
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(new Color(options.background))
    this.camera.position.set(0, 0, 10)
    options.canvas.addEventListener('webglcontextlost', this.handleContextLost)
  }

  get composition(): CompositionName {
    return this.current
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio[this.options.tier]))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    this.render()
  }

  start(): void {
    if (this.options.deterministic) {
      this.render()
      return
    }
    if (this.running) return
    this.running = true
    this.frame = requestAnimationFrame(this.tick)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.frame)
  }

  /** Paused in hidden tabs; server work is unaffected (MOTION_SPEC §5). */
  setVisible(visible: boolean): void {
    if (visible) this.start()
    else this.stop()
  }

  compose(name: CompositionName): void {
    this.current = name
    this.render()
  }

  dispose(): void {
    this.stop()
    this.options.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      }
    })
    this.renderer.dispose()
  }

  private readonly tick = (): void => {
    if (!this.running) return
    this.render()
    this.frame = requestAnimationFrame(this.tick)
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault()
    this.stop()
    this.options.onContextLost()
  }
}
