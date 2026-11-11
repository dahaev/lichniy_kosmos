import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { durations, easings } from './tokens'

// Vitest stubs CSS imports (even ?raw) with an empty string, so read the file.
const css = readFileSync(path.resolve(process.cwd(), 'src/ui/tokens.css'), 'utf8')
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media'))

function cssVar(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(rootBlock)
  if (!match?.[1]) throw new Error(`--${name} not found in tokens.css`)
  return match[1].trim()
}

describe('motion tokens', () => {
  it.each(Object.entries(durations))('duration %s matches tokens.css', (name, ms) => {
    expect(cssVar(`cosmos-dur-${name}`)).toBe(`${String(ms)}ms`)
  })

  it.each([
    ['cosmos-ease-out', easings.out],
    ['cosmos-ease-in-out', easings.inOut],
  ] as const)('%s matches tokens.css', (name, curve) => {
    expect(cssVar(name)).toBe(`cubic-bezier(${curve.join(', ')})`)
  })

  it('keeps DESIGN_SYSTEM §4 colours verbatim', () => {
    expect(cssVar('cosmos-bg')).toBe('#07111d')
    expect(cssVar('cosmos-text')).toBe('#eee9df')
    expect(cssVar('cosmos-gold')).toBe('#c8aa77')
    expect(cssVar('cosmos-line')).toBe('rgba(225, 218, 207, .15)')
  })
})
