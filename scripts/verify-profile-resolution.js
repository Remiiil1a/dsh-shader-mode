/**
 * Verify the preset rows resolve from the profile's own module scope.
 *
 * A preset's plugin list is resolved with `prepareProfileEntries(ctx, plugins,
 * ctx.baseUrl)`, where `baseUrl` is the profile directory. A bare specifier such
 * as `dsh-shader-mode` therefore has to resolve from the profile's
 * `node_modules`, not from this package. This script reproduces that resolution
 * from the profile directory so a missing link fails here instead of at
 * activation.
 *
 * Run with `node scripts/verify-profile-resolution.js <profileDir>`.
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const profileDir = process.argv[2]
assert.ok(profileDir, 'usage: node scripts/verify-profile-resolution.js <profileDir>')

const require = createRequire(pathToFileURL(join(profileDir, 'package.json')))

/** Resolve one specifier the way the Loader's profile resolver does. */
function resolveFromProfile(specifier) {
	return require.resolve(specifier)
}

const rows = [
	{ row: 'shader-mode', specifier: 'dsh-shader-mode', export: 'apply' },
	{ row: 'shader-mode-lead', specifier: 'dsh-shader-mode/lead', export: 'apply' },
	{ row: 'shader-mode-worker', specifier: 'dsh-shader-mode/worker', export: 'apply' },
	{ row: 'shader-mode-skills', specifier: 'dsh-shader-mode/skills', export: 'apply' },
]

for (const { row, specifier, export: exportName } of rows) {
	const resolved = resolveFromProfile(specifier)
	const module = await import(pathToFileURL(resolved).href)
	assert.equal(
		typeof module[exportName],
		'function',
		`row "${row}" resolves ${specifier} but it does not export ${exportName}`,
	)
	console.log(`ok  ${row.padEnd(20)} ${specifier} → ${resolved}`)
}

console.log('\nevery preset row resolves from the profile scope')
