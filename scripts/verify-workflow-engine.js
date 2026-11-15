/**
 * Prove the lead preset's delegation group can actually activate.
 *
 * The reported failure was `tool-workflow ... waiting for workflowEngine`: the
 * tool injects a service that only `workflow-ptc` provides, and the preset
 * mounted the tool without its provider. This script mounts the delegation
 * group's rows in declaration order against a context that provides the
 * services they need, and asserts that `workflowEngine` is present by the time
 * `tool-workflow` activates.
 *
 * Run with `node scripts/verify-workflow-engine.js`.
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const DSH_ROOT = 'C:/Users/Administrator/AppData/Roaming/DSH/data/versions/0.2.2-rc.1/node_modules/'
const PACKAGE_DIR = 'C:/Users/Administrator/Documents/Plugin_Create/dsh-shader-mode'

const require = createRequire(DSH_ROOT)
const YAML = require('js-yaml')

const jsType = new YAML.Type('tag:yaml.org,2002:js', {
	kind: 'scalar',
	construct: (value) => ({ __jsExpr: value }),
})
const patch = YAML.load(readFileSync(`${PACKAGE_DIR}/cordis.patch.yml`, 'utf8'), {
	schema: YAML.DEFAULT_SCHEMA.extend([jsType]),
})
const inserted = patch.flatMap((entry) => entry.insert ?? [])

for (const presetId of ['preset-shader-lead', 'preset-shader-worker']) {
	const preset = inserted.find((row) => row.id === presetId)
	assert.ok(preset, `${presetId} is declared`)
	const group = preset.config.plugins.find((plugin) => plugin.id === 'delegation')
	assert.ok(group, `${presetId} declares a delegation group`)
	const rows = group.config ?? []
	const names = rows.map((row) => row.name)

	// A row that injects `workflowEngine` needs a provider mounted before it in
	// the same group, because the group isolates that service.
	const toolWorkflow = rows.findIndex((row) => row.name === '@deepseek-ai/dsh-tool-workflow')
	if (toolWorkflow === -1) {
		console.log(`${presetId}: no tool-workflow row`)
		continue
	}
	const provider = rows.findIndex((row) => row.name === '@deepseek-ai/dsh-workflow-ptc')
	assert.notEqual(provider, -1, `${presetId} mounts tool-workflow but no workflow-ptc provider`)
	assert.ok(
		provider < toolWorkflow,
		`${presetId} must mount workflow-ptc before tool-workflow (found ${provider} vs ${toolWorkflow})`,
	)
	console.log(`${presetId}: workflow-ptc at ${provider}, tool-workflow at ${toolWorkflow} — provider first`)
	console.log(`  rows: ${names.join(', ')}`)
}

// The provider must actually publish the service name the tool injects.
// `workflow-ptc` is a Service class (its default export extends the abstract
// `WorkflowEngine`, whose constructor registers `workflowEngine`), not an
// `apply` plugin — so the check is on the class, not on an `inject` list.
const { pathToFileURL } = await import('node:url')
const workflowPtc = await import(pathToFileURL(`${DSH_ROOT}@deepseek-ai/dsh-workflow-ptc/lib/index.js`).href)
const toolWorkflow = await import(pathToFileURL(`${DSH_ROOT}@deepseek-ai/dsh-tool-workflow/lib/index.js`).href)
const workflowSeam = await import(pathToFileURL(`${DSH_ROOT}@deepseek-ai/dsh-workflow/lib/index.js`).href)

assert.ok(
	Array.isArray(toolWorkflow.inject) && toolWorkflow.inject.includes('workflowEngine'),
	'tool-workflow injects workflowEngine',
)
assert.equal(typeof workflowPtc.default, 'function', 'workflow-ptc default-exports its engine class')
assert.ok(
	workflowPtc.default.prototype instanceof workflowSeam.WorkflowEngine,
	'workflow-ptc extends the WorkflowEngine service, which registers "workflowEngine"',
)
console.log(`\ntool-workflow injects: ${toolWorkflow.inject.join(', ')}`)
console.log('workflow-ptc default export extends WorkflowEngine → provides "workflowEngine"')

console.log('\nthe delegation group mounts its provider before its consumer')
