import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CosmosCanvas from './CosmosCanvas.vue'
import * as quality from './quality'
import { useSceneStore } from './sceneStore'

const director = vi.hoisted(() => ({
  constructed: vi.fn(),
  setVisible: vi.fn(),
  setLayout: vi.fn(),
  setMotion: vi.fn(),
  setPointer: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('./SceneDirector', () => ({
  SceneDirector: class {
    constructor() {
      director.constructed()
    }
    setVisible = director.setVisible
    setLayout = director.setLayout
    setMotion = director.setMotion
    setPointer = director.setPointer
    resize = director.resize
    dispose = director.dispose
  },
}))

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}

function stubMatchMedia(matches: Record<string, boolean> = {}) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

const capable = { webgl: true, hardwareConcurrency: 8, saveData: false, coarsePointer: false }

describe('CosmosCanvas', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    stubMatchMedia()
    setActivePinia(createPinia())
    for (const fn of Object.values(director)) fn.mockClear()
  })

  it('stays on the poster without WebGL and never loads Three.js', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({ ...capable, webgl: false })

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    expect(wrapper.attributes('data-scene-state')).toBe('poster')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.scene-poster img').exists()).toBe(true)
    expect(director.constructed).not.toHaveBeenCalled()
  })

  it('publishes the planet geometry for screens to align with', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({ ...capable, webgl: false })

    mount(CosmosCanvas)
    await flushPromises()

    const style = document.documentElement.style
    expect(style.getPropertyValue('--scene-u')).toMatch(/px$/)
    expect(Number.parseFloat(style.getPropertyValue('--planet-r'))).toBeGreaterThan(0)
  })

  it('hands the ground to the page in portrait and fades the plate out above it', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({ ...capable, webgl: false })
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    expect(wrapper.attributes('data-scene-orientation')).toBe('portrait')
    expect(wrapper.attributes('data-scene-ground')).toBe('page')
    expect(wrapper.find('.scene-poster__ground-veil').attributes('style')).toMatch(/opacity: 1/)
    vi.unstubAllGlobals()
  })

  it('moves the poster plate on the static tier and keeps the hero captions in place', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({ ...capable, webgl: false })

    const wrapper = mount(CosmosCanvas)
    await flushPromises()
    const plate = wrapper.find<HTMLElement>('.scene-poster__plate').element
    const heroTransform = plate.style.transform
    const heroPlanetX = document.documentElement.style.getPropertyValue('--planet-x')

    useSceneStore().compose('intake.name')
    await flushPromises()
    await vi.waitFor(() => {
      expect(plate.style.transform).not.toBe(heroTransform)
    }, { timeout: 3000 })
    expect(document.documentElement.style.getPropertyValue('--planet-x')).toBe(heroPlanetX)
    expect(wrapper.attributes('data-scene-composition')).toBe('intake.name')
  })

  it('keeps flying when the viewport changes mid-flight instead of cutting', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({ ...capable, webgl: false })

    const wrapper = mount(CosmosCanvas)
    await flushPromises()
    const scene = useSceneStore()
    scene.compose('intake.name')
    await vi.waitFor(() => {
      expect(wrapper.attributes('data-scene-moving')).toBe('true')
    })

    const viewport = scene.viewport
    if (!viewport) throw new Error('no viewport')
    scene.viewport = { width: viewport.width + 15, height: viewport.height }
    await flushPromises()
    expect(wrapper.attributes('data-scene-moving')).toBe('true')
  })

  it('starts the director on capable devices and forwards compositions', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue(capable)

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    expect(director.constructed).toHaveBeenCalledOnce()
    expect(director.setLayout).toHaveBeenCalled()
    expect(director.setMotion).toHaveBeenLastCalledWith(true)
    expect(wrapper.attributes('data-scene-state')).toBe('webgl')
    expect(wrapper.attributes('data-scene-tier')).toBe('high')

    useSceneStore().compose('intake.name')
    await flushPromises()
    expect(director.setLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({ composition: expect.objectContaining({ coverage: 'free' }) }),
      expect.objectContaining({ duration: 1400 }),
    )

    wrapper.unmount()
    expect(director.dispose).toHaveBeenCalledOnce()
  })

  it('starts paused when the visitor prefers reduced motion', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue(capable)
    stubMatchMedia({ '(prefers-reduced-motion: reduce)': true })
    setActivePinia(createPinia())

    const wrapper = mount(CosmosCanvas)
    await flushPromises()
    expect(director.setMotion).toHaveBeenLastCalledWith(false)
    expect(wrapper.attributes('data-scene-motion')).toBe('paused')
  })

  it('remembers the pause choice for the session', async () => {
    useSceneStore().toggleMotion()
    await flushPromises()
    expect(sessionStorage.getItem('cosmos.scene.paused')).toBe('1')

    setActivePinia(createPinia())
    expect(useSceneStore().motionPaused).toBe(true)
  })

  it('forwards the pause control to the director', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue(capable)

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    useSceneStore().toggleMotion()
    await flushPromises()
    expect(director.setMotion).toHaveBeenLastCalledWith(false)
    expect(wrapper.attributes('data-scene-motion')).toBe('paused')
  })

  it('falls back to the poster when the renderer cannot start', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue(capable)
    director.constructed.mockImplementationOnce(() => {
      throw new Error('WebGL context creation failed')
    })

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    expect(wrapper.attributes('data-scene-state')).toBe('fallback')
    expect(wrapper.find('canvas').classes()).not.toContain('is-active')
    expect(wrapper.find('.scene-poster svg').exists()).toBe(true)
  })
})
