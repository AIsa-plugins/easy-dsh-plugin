import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const tag = process.argv[2]

assert(tag, 'usage: node scripts/resolve-release.mjs plugin/<id>/v<version>')

const match = /^plugin\/([a-z0-9]+(?:-[a-z0-9]+)*)\/v([0-9A-Za-z][0-9A-Za-z.+-]*)$/.exec(tag)
assert(match, `invalid plugin release tag: ${tag}`)

const [, pluginId, version] = match
const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'))
const plugin = catalog.plugins.find(candidate => candidate.id === pluginId)

assert(plugin, `plugin is not in catalog: ${pluginId}`)
assert.equal(plugin.path, `plugins/${pluginId}`, `invalid catalog path: ${plugin.path}`)

const manifest = JSON.parse(
  await readFile(new URL(`${plugin.path}/package.json`, root), 'utf8'),
)

assert.equal(manifest.name, plugin.package, `package mismatch: ${pluginId}`)
assert.equal(manifest.version, version, `tag version does not match ${manifest.name}`)

const release = {
  plugin_id: pluginId,
  package_name: manifest.name,
  package_path: plugin.path,
  version,
}

if (process.env.GITHUB_OUTPUT) {
  const output = Object.entries(release)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  await appendFile(process.env.GITHUB_OUTPUT, `${output}\n`)
}

console.log(`Resolved ${tag} to ${manifest.name} at ${plugin.path}.`)
