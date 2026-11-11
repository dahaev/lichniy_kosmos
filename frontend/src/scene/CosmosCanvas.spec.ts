import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CosmosCanvas from './CosmosCanvas.vue'
import * as quality from './quality'
import { useSceneStore } from './sceneStore'

const director = vi.hoisted(() => ({
  constructed: vi.fn(),
  compose: vi.fn(),
  setVisible: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('./SceneDirector', () => ({
  SceneDirector: class {
    constructor() {
      director.constructed()
    }
    compose = director.compose
    setVisible = director.setVisible
    resize = director.resize
    dispose = director.dispose
  },
}))

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}

describe('CosmosCanvas', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    for (const fn of Object.values(director)) fn.mockClear()
  })

  it('stays on the poster without WebGL and never loads Three.js', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({
      webgl: false,
      hardwareConcurrency: 8,
      saveData: false,
      coarsePointer: false,
    })

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    expect(wrapper.attributes('data-scene-state')).toBe('poster')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(director.constructed).not.toHaveBeenCalled()
  })

  it('starts the director on capable devices and forwards compositions', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({
      webgl: true,
      hardwareConcurrency: 8,
      saveData: false,
      coarsePointer: false,
    })

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    expect(director.constructed).toHaveBeenCalledOnce()
    expect(wrapper.attributes('data-scene-state')).toBe('webgl')
    expect(wrapper.attributes('data-scene-tier')).toBe('high')

    useSceneStore().compose('intake')
    await flushPromises()
    expect(director.compose).toHaveBeenLastCalledWith('intake')

    wrapper.unmount()
    expect(director.dispose).toHaveBeenCalledOnce()
  })

  it('falls back to the poster when the renderer cannot start', async () => {
    vi.spyOn(quality, 'readDeviceSignals').mockReturnValue({
      webgl: true,
      hardwareConcurrency: 8,
      saveData: false,
      coarsePointer: false,
    })
    director.constructed.mockImplementationOnce(() => {
      throw new Error('WebGL context creation failed')
    })

    const wrapper = mount(CosmosCanvas)
    await flushPromises()

    expect(wrapper.attributes('data-scene-state')).toBe('fallback')
    expect(wrapper.find('canvas').classes()).not.toContain('is-active')
  })
})
