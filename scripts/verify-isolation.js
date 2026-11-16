/**
 * Prove the shader-mode rows cannot leak into a session that did not choose them.
 *
 * This is the regression test for the bug that produced a standard-mode session
 * dispatching a worker for a chrysanthemum-classification task. The cause was
 * structural, not behavioural: the lead's tools, prompt section, and guard were
 * mounted on the **global** Host row, and a global row reaches every session in
 * the profile.
 *
 * The test mounts each row against a recording context and asserts what it
 * registers. A global row must register nothing; a preset row must register
 * only its own half.
 *
 * Run with `node scripts/verify-isolation.js`.
 */

import assert from 'node:assert/strict'

const PACKAGE = 'dsh-shader-mode'

/**
 * A context that records every registration instead of performing it.
 *
 * @returns {{ ctx: object, log: string[] }} the recorder.
 */
function recorder() {
	const log = []
	const ctx = {
		tools: { register: (definition) => (log.push(`tool:${definition.name}`), () => {}) },
		systemPrompt: { section: (section) => (log.push(`section:${section.name}`), () => {}) },
		subagents: { startActivation: async () => ({ childId: 'c', messageId: 'm', result: Promise.resolve({}), dispose: async () => {} }) },
		skills: { registerProvider: () => (log.push('skill-provider'), () => {}) },
		on: (event) => (log.push(`on:${event}`), () => {}),
		effect: () => (log.push('effect'), () => {}),
		logger: () => ({ info: () => {} }),
	}
	return { ctx, log }
}

// ── The global Host row must register nothing ────────────────────────────────
{
	const { ctx, log } = recorder()
	const host = await import(PACKAGE)
	host.apply(ctx, {})
	assert.deepEqual(
		log,
		[],
		`the global host row registered ${log.join(', ')}; anything it registers reaches every session in every mode`,
	)
	console.log('ok  host row (global)      registers nothing')
}

// ── The lead row registers only the lead's half ──────────────────────────────
{
	const { ctx, log } = recorder()
	const lead = await import(`${PACKAGE}/lead`)
	lead.apply(ctx, {})
	const tools = log.filter((entry) => entry.startsWith('tool:'))
	const sections = log.filter((entry) => entry.startsWith('section:'))
	assert.deepEqual(tools.sort(), ['tool:shader_board', 'tool:shader_dispatch', 'tool:shader_route'])
	assert.deepEqual(sections, ['section:shader-mode:lead'])
	assert.ok(!log.includes('skill-provider'), 'the lead must not register the worker skill provider')
	assert.ok(!log.includes('section:shader-mode:worker'), 'the lead must not register the worker section')
	console.log(`ok  lead row (preset)      ${tools.length} tools, ${sections.length} section, no worker half`)
}

// ── The worker row registers only the worker's half ──────────────────────────
{
	const { ctx, log } = recorder()
	const worker = await import(`${PACKAGE}/worker`)
	worker.apply(ctx, {})
	assert.deepEqual(log.filter((entry) => entry.startsWith('tool:')), [], 'the worker must not register tools')
	assert.deepEqual(log.filter((entry) => entry.startsWith('section:')), ['section:shader-mode:worker'])
	console.log('ok  worker row (preset)    section only, no tools')
}

// ── The skills row registers only the provider ───────────────────────────────
{
	const { ctx, log } = recorder()
	const skills = await import(`${PACKAGE}/skills`)
	skills.apply(ctx, {})
	assert.deepEqual(log, ['skill-provider'])
	console.log('ok  skills row (preset)    skill provider only')
}

// ── The two preset halves share no registration ──────────────────────────────
{
	const leadLog = []
	const workerLog = []
	const make = (sink) => ({
		tools: { register: (definition) => (sink.push(`tool:${definition.name}`), () => {}) },
		systemPrompt: { section: (section) => (sink.push(`section:${section.name}`), () => {}) },
		subagents: { startActivation: async () => ({ childId: 'c', messageId: 'm', result: Promise.resolve({}), dispose: async () => {} }) },
		skills: { registerProvider: () => (sink.push('skill-provider'), () => {}) },
		on: (event) => (sink.push(`on:${event}`), () => {}),
		effect: () => (sink.push('effect'), () => {}),
	})
	const lead = await import(`${PACKAGE}/lead`)
	const worker = await import(`${PACKAGE}/worker`)
	const skills = await import(`${PACKAGE}/skills`)
	lead.apply(make(leadLog), {})
	worker.apply(make(workerLog), {})
	skills.apply(make(workerLog), {})
	const overlap = leadLog.filter((entry) => workerLog.includes(entry))
	assert.deepEqual(overlap, [], `the two halves share registrations: ${overlap.join(', ')}`)
	console.log('ok  lead ∩ worker          no shared registration')
}

console.log('\nshader-mode rows cannot leak outside the presets that mount them')
