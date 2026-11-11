/**
 * Quality tiers from ARCHITECTURE_MVP_v2 §17.3. S0 decides from static device
 * signals; first-frame timing is added when the real scene exists (V1).
 */
export type QualityTier = 'high' | 'medium' | 'low' | 'static'

export type RenderTier = Exclude<QualityTier, 'static'>

export interface DeviceSignals {
  webgl: boolean
  hardwareConcurrency: number
  saveData: boolean
  coarsePointer: boolean
}

export const maxPixelRatio: Record<RenderTier, number> = {
  high: 2,
  medium: 1.5,
  low: 1,
}

export function chooseQuality(signals: DeviceSignals): QualityTier {
  if (!signals.webgl || signals.saveData) return 'static'
  if (signals.hardwareConcurrency <= 2) return 'low'
  if (signals.coarsePointer || signals.hardwareConcurrency <= 4) return 'medium'
  return 'high'
}

interface NetworkInformationLike {
  saveData?: boolean
}

export function readDeviceSignals(win: Window): DeviceSignals {
  const connection = (win.navigator as Navigator & { connection?: NetworkInformationLike }).connection
  return {
    webgl: supportsWebGL2(win.document),
    hardwareConcurrency: win.navigator.hardwareConcurrency || 1,
    saveData: connection?.saveData === true,
    coarsePointer: win.matchMedia('(pointer: coarse)').matches,
  }
}

function supportsWebGL2(doc: Document): boolean {
  try {
    const canvas = doc.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return gl !== null
  } catch {
    return false
  }
}
