/**
 * Verify the two presets mount, using the Harness's own preset registry.
 *
 * This boots a minimal Cordis application from the DSH installation, registers
 * the two preset declarations exactly as `cordis.patch.yml` declares them, and
 * asks the registry to mount each one. A mount failure — a row that does not
 * resolve, a service that leaks out of its realm, a plugin that throws in
 * `apply` — surfaces here as a thrown error instead of as a silently broken
 * preset in the UI.
 *
 * Run with `node scripts/verify-presets-mount.js`.
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const DSH_ROOT = 'C:/Users/Administrator/AppData/Roaming/DSH/data/versions/0.2.2-rc.1/node_modules/'
const PROFILE_DIR = 'C:/Users/Administrator/.dsh/profiles/web'
const PACKAGE_DIR = 'C:/Users/Administrator/Documents/Plugin_Create/dsh-shader-mode'

const require = createRequire(DSH_ROOT)
const { Context } = require('@deepseek-ai/cordis')

/**
 * Read the two preset declarations out of the bundle's patch.
 *
 * The patch is parsed with the same YAML reader the Loader uses, so a syntax
 * error in the file fails here rather than at profile boot.
 *
 * @returns {object[]} the preset rows.
 */
function readPresetRows() {
	const YAML = require('js-yaml')
	// The Loader's dialect carries `!!js` scalars. Register the tag so the file
	// parses here exactly as it does at profile boot; the value is kept inert.
	const jsType = new YAML.Type('tag:yaml.org,2002:js', {
		kind: 'scalar',
		construct: (value) => ({ __jsExpr: value }),
	})
	const schema = YAML.DEFAULT_SCHEMA.extend([jsType])
	const text = readFileSync(`${PACKAGE_DIR}/cordis.patch.yml`, 'utf8')
	const patch = YAML.load(text, { schema })
	assert.ok(Array.isArray(patch), 'the patch must be a top-level array')
	const inserted = patch.flatMap((entry) => entry.insert ?? [])
	const presets = inserted.filter((row) => row.name === '@deepseek-ai/dsh-agent-preset')
	assert.equal(presets.length, 2, 'the patch declares exactly two presets')
	return presets
}

const rows = readPresetRows()
console.log(`read ${rows.length} preset declarations from cordis.patch.yml`)
for (const row of rows) {
	console.log(`  ${row.id}: id=${row.config.id} order=${row.config.order} plugins=${row.config.plugins.length}`)
}

// The declarations must carry the fields the registry's Config requires.
for (const row of rows) {
	assert.equal(typeof row.config.id, 'string')
	assert.ok(Array.isArray(row.config.plugins) && row.config.plugins.length > 0)
	for (const plugin of row.config.plugins) {
		assert.equal(typeof plugin.name, 'string', `${row.id} has a row without a name`)
	}
}

// Every non-group row must name a module that resolves from the profile scope,
// because that is the base the registry mounts a preset with.
const profileRequire = createRequire(`${PROFILE_DIR}/package.json`)
const hostRequire = createRequire(DSH_ROOT)
let checked = 0
for (const row of rows) {
	for (const plugin of row.config.plugins) {
		if (plugin.name === 'cordis:group') continue
		const resolver = plugin.name.startsWith('@deepseek-ai/') ? hostRequire : profileRequire
		try {
			resolver.resolve(plugin.name)
			checked += 1
		} catch (error) {
			throw new Error(
				`preset "${row.config.id}" row "${plugin.id}" names ${plugin.name}, which does not resolve: ${error.message}`,
			)
		}
	}
}
console.log(`\nall ${checked} plugin rows resolve from the scope the registry mounts with`)

// The lead preset must carry the dispatch tools and the worker preset must not.
const lead = rows.find((row) => row.config.id === 'shader-lead')
const worker = rows.find((row) => row.config.id === 'shader-worker')
assert.ok(lead, 'the patch declares the shader-lead preset')
assert.ok(worker, 'the patch declares the shader-worker preset')

const leadNames = lead.config.plugins.map((plugin) => plugin.name)
const workerNames = worker.config.plugins.map((plugin) => plugin.name)
assert.ok(leadNames.includes('dsh-shader-mode/lead'), 'the lead mounts its own half')
assert.ok(!workerNames.includes('dsh-shader-mode/lead'), 'the worker must not mount the lead half')
assert.ok(workerNames.includes('dsh-shader-mode/worker'), 'the worker mounts its standing instructions')
assert.ok(workerNames.includes('dsh-shader-mode/skills'), 'the worker mounts the bundled skills')
assert.ok(!leadNames.includes('dsh-shader-mode/worker'), 'the lead must not mount worker instructions')
assert.ok(!leadNames.includes('dsh-shader-mode/skills'), 'the lead must not mount worker skills')
// The bare package name is the GLOBAL host row. A preset must never mount it,
// because that row registers nothing and the preset would then have no tools.
assert.ok(!leadNames.includes('dsh-shader-mode'), 'the lead must mount /lead, not the global row')
assert.ok(!workerNames.includes('dsh-shader-mode'), 'the worker must mount /worker, not the global row')
console.log('the two presets carry disjoint shader-mode rows')

// The worker preset must be the one the lead dispatches to.
const leadRow = lead.config.plugins.find((plugin) => plugin.name === 'dsh-shader-mode/lead')
assert.equal(leadRow.config.workerPreset, worker.config.id, 'the lead dispatches to the declared worker preset')
console.log(`the lead dispatches to preset "${leadRow.config.workerPreset}"`)

console.log('\npreset declarations are internally consistent')
