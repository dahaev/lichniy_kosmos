// Home regression: compares fresh snapshots with a saved set taken before a
// change. Usage: node visual/regress.mjs <baseline-dir> [snapshot-dir]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const [baselineDir, snapshotDir = 'visual/output/snapshots'] = process.argv.slice(2)
if (!baselineDir) {
  console.error('usage: node visual/regress.mjs <baseline-dir> [snapshot-dir]')
  process.exit(2)
}

const diffDir = join(snapshotDir, '..', 'regress')
mkdirSync(diffDir, { recursive: true })

let failed = false
for (const file of readdirSync(baselineDir).filter((f) => f.endsWith('.png')).sort()) {
  const name = file.replace(/\.png$/, '')
  const current = join(snapshotDir, file)
  if (!existsSync(current)) {
    console.log(`${name}: missing snapshot`)
    failed = true
    continue
  }
  const a = PNG.sync.read(readFileSync(join(baselineDir, file)))
  const b = PNG.sync.read(readFileSync(current))
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${name}: size ${a.width}×${a.height} → ${b.width}×${b.height}`)
    failed = true
    continue
  }
  const diff = new PNG({ width: a.width, height: a.height })
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
  writeFileSync(join(diffDir, `${name}.diff.png`), PNG.sync.write(diff))

  const anchorsA = JSON.parse(readFileSync(join(baselineDir, `${name}.anchors.json`), 'utf8'))
  const anchorsB = JSON.parse(readFileSync(join(snapshotDir, `${name}.anchors.json`), 'utf8'))
  const moved = Object.keys(anchorsA).filter((key) => Math.abs(anchorsA[key] - anchorsB[key]) > 0.5)

  const share = (changed / (a.width * a.height)) * 100
  console.log(`${name}: ${changed} px differ (${share.toFixed(3)}%), anchors moved: ${moved.length ? moved.join(', ') : 'none'}`)
  if (changed > 0 || moved.length) failed = true
}
process.exit(failed ? 1 : 0)
