// Fails the build if mock infrastructure leaked into production output.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const dist = path.resolve(import.meta.dirname, '..', 'dist')
const forbidden = [/mockServiceWorker/, /\bmsw\b/, /setupWorker/]

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* files(full)
    else yield full
  }
}

const problems = []
for await (const file of files(dist)) {
  const rel = path.relative(dist, file)
  if (rel === 'mockServiceWorker.js') problems.push(`${rel}: MSW worker shipped`)
  if (!/\.(js|html)$/.test(file)) continue
  const text = await readFile(file, 'utf8')
  for (const re of forbidden) {
    if (re.test(text)) problems.push(`${rel}: matches ${re}`)
  }
}

if (problems.length > 0) {
  console.error('Production bundle contains mock code:\n' + problems.join('\n'))
  process.exit(1)
}
console.log('bundle check: no mock code in dist/')
