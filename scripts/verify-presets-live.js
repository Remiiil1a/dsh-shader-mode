/**
 * Mount both presets in a real Cordis application and report what each one
 * publishes.
 *
 * This is the check that matters: `verify-presets-mount.js` proves the
 * declarations are internally consistent and that every row resolves, but only
 * an actual mount proves the rows activate — that `apply` runs, that the
 * services each row injects are present, and that the lead's tools land in the
 * tool registry while the worker's do not.
 *
 * It boots a minimal application from the DSH installation, registers the two
 * declarations exactly as the patch declares them, mounts each, and inspects the
 * resulting tool and skill registries.
 *
 * Run with `node scripts/verify-presets-live.js`.
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const DSH_ROOT = 'C:/Users/Administrator/AppData/Roaming/DSH/data/versions/0.2.2-rc.1/node_modules/'
const PACKAGE_DIR = 'C:/Users/Administrator/Documents/Plugin_Create/dsh-shader-mode'

const require = createRequire(DSH_ROOT)
const YAML = require('js-yaml')
const { Context } = require('@deepseek-ai/cordis')

/** Parse the patch with the Loader's `!!js` dialect. */
function readPatch() {
	const jsType = new YAML.Type('tag:yaml.org,2002:js', {
		kind: 'scalar',
		construct: (value) => ({ __jsExpr: value }),
	})
	const schema = YAML.DEFAULT_SCHEMA.extend([jsType])
	const text = readFileSync(`${PACKAGE_DIR}/cordis.patch.yml`, 'utf8')
	return YAML.load(text, { schema })
}

const patch = readPatch()
const inserted = patch.flatMap((entry) => entry.insert ?? [])
const leadRow = inserted.find((row) => row.id === 'preset-shader-lead')
const workerRow = inserted.find((row) => row.id === 'preset-shader-worker')
assert.ok(leadRow && workerRow, 'both preset rows are declared')

/**
 * Boot a minimal application with the services the two rows inject.
 *
 * The real Host supplies these from its own composition; here they are the
 * smallest implementations that let `apply` run, so a row that reaches for a
 * service it did not declare fails loudly.
 */
async function boot() {
	const ctx = new Context()

	// A tool registry that records what lands in it.
	const tools = new Map()
	ctx.provide('tools', {
		register(definition) {
			tools.set(definition.name, definition)
			return () => tools.delete(definition.name)
		},
	})

	// A subagent service that records starts.
	const starts = []
	ctx.provide('subagents', {
		async startActivation(spec) {
			starts.push(spec)
			return { childId: `child-${starts.length}`, messageId: 'm1', result: Promise.resolve({}), dispose: async () => {} }
		},
	})

	// A system-prompt registry that records sections.
	const sections = []
	ctx.provide('systemPrompt', {
		section(section) {
			sections.push(section)
			return () => {}
		},
	})

	// A skill registry that records providers.
	const providers = []
	ctx.provide('skills', {
		registerProvider(create) {
			providers.push(create({ signal: new AbortController().signal, invalidate: () => {} }))
			return () => {}
		},
	})

	return { ctx, tools, starts, sections, providers }
}

/** Mount one preset's plugin list on a child context, as the registry does. */
async function mountPreset(ctx, row) {
	const mounted = ctx.extend({ baseUrl: `file:///${PACKAGE_DIR.replaceAll('\\', '/')}/` })
	for (const plugin of row.config.plugins) {
		if (plugin.name === 'cordis:group') continue
		if (plugin.disabled !== undefined) continue
		// Only the rows this package owns are mounted here; the Harness rows are
		// covered by the resolution check and would need the full Host to activate.
		if (!plugin.name.startsWith('dsh-shader-mode')) continue
		// The bare package name is the global host row. Mounting it inside a
		// preset would register nothing and leave the preset without tools.
		assert.notEqual(
			plugin.name,
			'dsh-shader-mode',
			`preset "${row.config.id}" mounts the global host row; it must mount a scoped subpath`,
		)
		const module = await import(plugin.name)
		assert.equal(typeof module.apply, 'function', `${plugin.name} must export apply`)
		for (const service of module.inject ?? []) {
			assert.ok(ctx.get(service) !== undefined, `${plugin.name} injects "${service}", which is not provided`)
		}
		module.apply(mounted, plugin.config ?? {})
	}
	return mounted
}

const lead = await boot()
await mountPreset(lead.ctx, leadRow)
assert.deepEqual([...lead.tools.keys()].sort(), ['shader_board', 'shader_dispatch', 'shader_route'])
// The lead section is the rule that must survive a session that never loads a
// skill, so its presence is part of "the preset mounted correctly".
assert.equal(lead.sections.length, 1, 'the lead mounts exactly one prompt section')
assert.equal(lead.sections[0].name, 'shader-mode:lead')
assert.match(lead.sections[0].text, /Every unit of work goes to a worker/)
assert.equal(lead.providers.length, 0, 'the lead must not mount the worker skill provider')
console.log(`lead   tools: ${[...lead.tools.keys()].join(', ')}`)
console.log(`lead   section: ${lead.sections[0].name}`)

const worker = await boot()
await mountPreset(worker.ctx, workerRow)
assert.equal(worker.tools.size, 0, 'the worker must not mount the dispatch tools')
assert.equal(worker.sections.length, 1, 'the worker mounts exactly one prompt section')
assert.equal(worker.providers.length, 1, 'the worker mounts exactly one skill provider')
const listed = await worker.providers[0].list()
assert.equal(listed.candidates.length, 3)
console.log(`worker section: ${worker.sections[0].name}`)
console.log(`worker skills : ${listed.candidates.map((c) => c.name).join(', ')}`)

// The lead's dispatch must start a child on the worker preset with the skills
// written into the prompt — the whole point of the plugin, end to end.
const dispatch = lead.tools.get('shader_dispatch')
const value = await dispatch.execute(
	{
		title: 'Probe',
		brief: 'Do the probe.',
		skills: ['shader-mode-workflow', 'ds-verify-loop'],
		acceptance: 'the probe reports its evidence',
	},
	{ agent: { id: 'lead-session' }, signal: new AbortController().signal },
)
assert.equal(value.taskId, 'T1')
assert.equal(lead.starts.length, 1)
const spec = lead.starts[0]
assert.equal(spec.request.agentPreset, 'shader-worker')
assert.match(spec.request.prompt[0].text, /`shader-mode-workflow`/)
assert.match(spec.request.prompt[0].text, /`ds-verify-loop`/)
console.log(`dispatch: ${value.taskId} → ${value.childId} on preset "${spec.request.agentPreset}"`)

console.log('\nboth presets mount and behave as declared')
