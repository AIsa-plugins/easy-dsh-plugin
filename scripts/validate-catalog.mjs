import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, root), 'utf8'))
}

const catalog = await json('catalog.json')
assert.equal(catalog.schemaVersion, 1, 'unsupported catalog schema')

const categoryIds = catalog.categories.map(category => category.id)
const pluginIds = catalog.plugins.map(plugin => plugin.id)

assert.equal(new Set(categoryIds).size, categoryIds.length, 'duplicate category id')
assert.equal(new Set(pluginIds).size, pluginIds.length, 'duplicate plugin id')

const pluginDirectories = (await readdir(new URL('plugins/', root), {
  withFileTypes: true,
}))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

assert.deepEqual([...pluginIds].sort(), pluginDirectories, 'catalog and plugins differ')

const categories = new Set(categoryIds)
for (const plugin of catalog.plugins) {
  assert.match(plugin.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert(categories.has(plugin.category), `unknown category: ${plugin.category}`)
  assert.equal(plugin.path, `plugins/${plugin.id}`)

  const manifest = await json(`${plugin.path}/package.json`)
  assert.equal(manifest.name, plugin.package, `package mismatch: ${plugin.id}`)
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
}

console.log(`Validated ${pluginIds.length} plugin(s) in ${categoryIds.length} category(s).`)
