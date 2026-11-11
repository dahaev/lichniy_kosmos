import { describe, expect, it } from 'vitest'

import { chooseQuality, type DeviceSignals } from './quality'

const desktop: DeviceSignals = { webgl: true, hardwareConcurrency: 8, saveData: false, coarsePointer: false }

describe('chooseQuality', () => {
  it.each<[string, Partial<DeviceSignals>, ReturnType<typeof chooseQuality>]>([
    ['capable desktop', {}, 'high'],
    ['no WebGL2', { webgl: false }, 'static'],
    ['data saver', { saveData: true }, 'static'],
    ['two cores', { hardwareConcurrency: 2 }, 'low'],
    ['four cores', { hardwareConcurrency: 4 }, 'medium'],
    ['touch device', { coarsePointer: true }, 'medium'],
  ])('%s → %s', (_name, override, want) => {
    expect(chooseQuality({ ...desktop, ...override })).toBe(want)
  })
})
