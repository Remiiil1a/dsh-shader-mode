/**
 * Offline checks for `dsh-shader-mode`.
 *
 * These run without a Harness: they exercise the parts that can be wrong on
 * their own — frontmatter parsing, the board, prompt composition, and the tool
 * bodies against a mock context. They do not prove the plugin mounts; only an
 * installed bundle does that.
 *
 * Run with `node --test tests/`.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Board, BoardRegistry } from '../lib/board.js'
import {
	DEFAULT_LEAD_ONLY_SKILLS,
	checkSkillAssignment,
	describeViolations,
	resolveSkillPolicy,
} from '../lib/skill-policy.js'
import { ShaderModeError, clipLabel, listOr, optionalString, optionalStringArray, requireString, splitFrontmatter } from '../lib/tool.js'
import { createSkillProvider } from '../skills.js'
import { workerSectionText } from '../worker.js'
import { registerLeadTools } from '../tools.js'

/**
 * Build a context that records tool registrations and fakes a subagent start.
 *
 * @param {object} [options] - overrides.
 * @param {(spec: object) => object} [options.startActivation] - activation stub.
 * @returns {{ ctx: object, tools: Map<string, object>, starts: object[] }} the harness.
 */
function mockContext(options = {}) {
	const tools = new Map()
	const starts = []
	const ctx = {
		tools: {
			register(definition) {
				tools.set(definition.name, definition)
				return () => tools.delete(definition.name)
			},
		},
		subagents: {
			async startActivation(spec) {
				starts.push(spec)
				if (options.startActivation !== undefined) return options.startActivation(spec)
				return { childId: `child-${starts.length}`, messageId: 'm1', result: Promise.resolve({}), dispose: async () => {} }
			},
		},
	}
	return { ctx, tools, starts }
}

/** A calling-agent execution context. */
function exec(agentId = 'lead-1') {
	return { agent: { id: agentId }, signal: new AbortController().signal }
}

test('splitFrontmatter reads the flat header and keeps the body', () => {
	const { header, body } = splitFrontmatter('---\nname: demo\ndescription: "a quoted one"\n---\n\n# Title\n\ntext\n')
	assert.equal(header.name, 'demo')
	assert.equal(header.description, 'a quoted one')
	assert.equal(body, '# Title\n\ntext')
})

test('splitFrontmatter tolerates a document without frontmatter', () => {
	const { header, body } = splitFrontmatter('# Just a body\n')
	assert.deepEqual(header, {})
	assert.equal(body, '# Just a body')
})

test('argument readers reject the shapes they claim to reject', () => {
	assert.equal(requireString({ a: '  x  ' }, 'a'), 'x')
	assert.throws(() => requireString({ a: '   ' }, 'a'), ShaderModeError)
	assert.throws(() => requireString({}, 'a'), ShaderModeError)
	assert.equal(optionalString({ a: '  ' }, 'a'), undefined)
	assert.equal(optionalString({}, 'a'), undefined)
	assert.deepEqual(optionalStringArray({ a: ['x', ' x ', 'y'] }, 'a'), ['x', 'y'])
	assert.deepEqual(optionalStringArray({}, 'a'), [])
	assert.throws(() => optionalStringArray({ a: [1] }, 'a'), ShaderModeError)
})

test('listOr and clipLabel stay inside their contracts', () => {
	assert.equal(listOr([]), '(none)')
	assert.equal(listOr(['a', 'b']), 'a, b')
	assert.equal(clipLabel('  a   b  '), 'a b')
	assert.equal(clipLabel('x'.repeat(200)).length, 96)
})

test('the board mints ids, indexes by child, and tracks rework rounds', () => {
	const board = new Board()
	const first = board.add({ childId: 'c1', title: 'one', brief: 'b', skills: ['s'], acceptance: 'a' })
	const second = board.add({ childId: 'c2', title: 'two', brief: 'b', skills: ['s'], acceptance: 'a' })
	assert.equal(first.id, 'T1')
	assert.equal(second.id, 'T2')
	assert.equal(board.find('c2').id, 'T2')
	assert.equal(board.find('T2').id, 'T2')
	assert.equal(board.find('nope'), undefined)
	assert.equal(board.open().length, 2)
	board.recordReport(first, 'done')
	assert.equal(first.state, 'reported')
	board.setState(first, 'rework', 'missing evidence')
	assert.equal(first.reworkRounds, 1)
	assert.throws(() => board.setState(first, 'nonsense'), /unknown task state/)
	assert.equal(board.open().length, 1)
})

test('the registry keeps one board per session', () => {
	const registry = new BoardRegistry()
	assert.equal(registry.peek('a'), undefined)
	const board = registry.for('a')
	assert.equal(registry.for('a'), board)
	assert.notEqual(registry.for('b'), board)
	registry.clear()
	assert.equal(registry.peek('a'), undefined)
})

test('the worker section says the two things a worker cannot infer', () => {
	const text = workerSectionText({ leadName: 'the lead' })
	assert.match(text, /no user/i)
	assert.match(text, /final message is a report/i)
	assert.match(text, /skill/i)
})

test('shader_dispatch refuses a dispatch with no skills', async () => {
	const { ctx, tools } = mockContext()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const dispatch = tools.get('shader_dispatch')
	await assert.rejects(
		() => dispatch.execute({ title: 't', brief: 'b', acceptance: 'a', skills: [] }, exec()),
		(error) => error instanceof ShaderModeError && error.code === 'NO_SKILLS',
	)
})

test('shader_dispatch starts a worker on the configured preset and records the task', async () => {
	const { ctx, tools, starts } = mockContext()
	const boards = new BoardRegistry()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, boards)
	const dispatch = tools.get('shader_dispatch')

	const value = await dispatch.execute(
		{
			title: 'Fix the band',
			brief: 'Edit translucent.glsl.',
			skills: ['shader-team-programmer', 'ds-verify-loop'],
			acceptance: 'chain exits 0',
			workflow: 'run the chain, then pack',
			context: 'build 738 is current',
		},
		exec(),
	)

	assert.equal(value.taskId, 'T1')
	assert.equal(value.childId, 'child-1')
	assert.deepEqual(value.skills, ['shader-team-programmer', 'ds-verify-loop'])

	const spec = starts[0]
	assert.equal(spec.provider, 'spawn')
	assert.equal(spec.delivery, 'parent')
	assert.equal(spec.request.agentPreset, 'shader-worker')
	assert.equal(spec.request.maxDepth, 0)
	assert.equal(spec.request.parent.id, 'lead-1')
	assert.equal(spec.label, 'T1 Fix the band')

	const prompt = spec.request.prompt[0].text
	assert.match(prompt, /Task T1: Fix the band/)
	assert.match(prompt, /`shader-team-programmer`/)
	assert.match(prompt, /`ds-verify-loop`/)
	assert.match(prompt, /Edit translucent\.glsl\./)
	assert.match(prompt, /run the chain, then pack/)
	assert.match(prompt, /build 738 is current/)
	assert.match(prompt, /chain exits 0/)
	assert.match(prompt, /You do not talk to the user/)

	const board = boards.peek('lead-1')
	assert.equal(board.find('child-1').id, 'T1')
	assert.equal(board.find('T1').title, 'Fix the band')
})

test('shader_dispatch keeps board ids aligned with the ids quoted in prompts', async () => {
	const { ctx, tools, starts } = mockContext()
	const boards = new BoardRegistry()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, boards)
	const dispatch = tools.get('shader_dispatch')
	const args = { title: 't', brief: 'b', acceptance: 'a', skills: ['s'] }

	const first = await dispatch.execute(args, exec())
	const second = await dispatch.execute(args, exec())

	assert.equal(first.taskId, 'T1')
	assert.equal(second.taskId, 'T2')
	assert.match(starts[0].request.prompt[0].text, /Task T1:/)
	assert.match(starts[1].request.prompt[0].text, /Task T2:/)
	assert.equal(boards.peek('lead-1').find('child-2').id, 'T2')
})

test('shader_board lists, filters, and looks up by either id', async () => {
	const { ctx, tools } = mockContext()
	const boards = new BoardRegistry()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, boards)
	const dispatch = tools.get('shader_dispatch')
	const board = tools.get('shader_board')

	assert.deepEqual(await board.execute({}, exec()), { tasks: [] })

	await dispatch.execute({ title: 'one', brief: 'b', acceptance: 'a', skills: ['s'] }, exec())
	await dispatch.execute({ title: 'two', brief: 'b', acceptance: 'a', skills: ['s'] }, exec())

	const all = await board.execute({}, exec())
	assert.equal(all.tasks.length, 2)
	assert.equal(all.tasks[0].title, 'one')

	const byTask = await board.execute({ task: 'T2' }, exec())
	assert.equal(byTask.tasks.length, 1)
	assert.equal(byTask.tasks[0].title, 'two')

	const byChild = await board.execute({ task: 'child-1' }, exec())
	assert.equal(byChild.tasks[0].id, 'T1')

	const none = await board.execute({ state: 'accepted' }, exec())
	assert.deepEqual(none.tasks, [])
})

test('shader_route records a report and moves state', async () => {
	const { ctx, tools } = mockContext()
	const boards = new BoardRegistry()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, boards)
	await tools.get('shader_dispatch').execute(
		{ title: 'one', brief: 'b', acceptance: 'a', skills: ['s'] },
		exec(),
	)
	const route = tools.get('shader_route')

	const reported = await route.execute({ task: 'T1', state: 'reported', report: 'chain exits 0' }, exec())
	assert.equal(reported.state, 'reported')
	assert.equal(boards.peek('lead-1').find('T1').report, 'chain exits 0')

	const rework = await route.execute({ task: 'T1', state: 'rework', note: 'no evidence' }, exec())
	assert.equal(rework.state, 'rework')
	assert.equal(rework.reworkRounds, 1)

	await assert.rejects(
		() => route.execute({ task: 'T9', state: 'accepted' }, exec()),
		(error) => error instanceof ShaderModeError && error.code === 'UNKNOWN_TASK',
	)
	await assert.rejects(
		() => route.execute({ task: 'T1', state: 'reported' }, exec()),
		(error) => error instanceof ShaderModeError && error.code === 'INVALID_ARGUMENT',
	)
})

test('the bundled skills are discoverable and loadable', async () => {
	const provider = createSkillProvider()
	const listed = await provider.list()
	assert.equal(listed.complete, true)
	const names = listed.candidates.map((candidate) => candidate.name)
	assert.deepEqual(names, ['shader-mode-dispatch', 'shader-mode-report', 'shader-mode-workflow'])
	for (const candidate of listed.candidates) {
		assert.ok(candidate.description.length > 20, `${candidate.name} needs a real description`)
		const full = await provider.get(candidate)
		assert.ok(full.content.length > 500, `${candidate.name} needs a real body`)
		assert.equal(full.provider, 'shader-mode')
		assert.equal(full.resourceBase.kind, 'directory')
	}
})

test('every tool declares the schema shape the registry requires', () => {
	const { ctx, tools } = mockContext()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	assert.deepEqual([...tools.keys()], ['shader_dispatch', 'shader_board', 'shader_route'])
	for (const [name, definition] of tools) {
		assert.equal(definition.name, name)
		assert.ok(definition.description.length > 50, `${name} needs a real description`)
		assert.equal(definition.parameters.type, 'object')
		assert.equal(definition.parameters.additionalProperties, false)
		assert.ok(definition.output.schema !== undefined, `${name} needs an output schema`)
		assert.equal(typeof definition.output.render, 'function')
		assert.equal(typeof definition.execute, 'function')
	}
})

test('the default policy blocks whole-project and orchestrator skills', () => {
	const policy = resolveSkillPolicy(undefined)
	for (const name of ['shader-single', 'shader-single-strict', 'shader-team-lead']) {
		assert.ok(policy.has(name), `${name} must be lead-only by default`)
	}
	// The role skills are the replacements, so they must stay assignable.
	for (const name of ['shader-team-architect', 'shader-team-programmer', 'shader-team-reviewer', 'shader-team-scribe', 'shader-glsl']) {
		assert.equal(policy.has(name), false, `${name} must stay assignable to a worker`)
	}
})

test('every default policy entry explains itself and names a replacement', () => {
	for (const entry of DEFAULT_LEAD_ONLY_SKILLS) {
		assert.ok(entry.reason.length > 40, `${entry.skill} needs a real reason`)
		assert.ok(entry.alternative.length > 5, `${entry.skill} needs an alternative`)
	}
})

test('the policy accepts a plain name list and a custom table', () => {
	const fromNames = resolveSkillPolicy(['shader-single'])
	assert.ok(fromNames.has('shader-single'))
	assert.equal(fromNames.size, 1)
	assert.match(fromNames.get('shader-single').reason, /requirement freezing/)

	const custom = resolveSkillPolicy([{ skill: 'my-solo-flow', reason: 'runs alone', alternative: 'my-role-skill' }])
	assert.ok(custom.has('my-solo-flow'))
	assert.equal(custom.has('shader-single'), false, 'a custom table replaces the default')
})

test('checkSkillAssignment reports only the conflicting names', () => {
	const policy = resolveSkillPolicy(undefined)
	assert.deepEqual(checkSkillAssignment(['ds-plan-loop', 'shader-glsl'], policy), [])
	const violations = checkSkillAssignment(['shader-team-programmer', 'shader-single'], policy)
	assert.equal(violations.length, 1)
	assert.equal(violations[0].skill, 'shader-single')
})

test('the rejection names the skill, the reason, and the replacement', () => {
	const policy = resolveSkillPolicy(undefined)
	const text = describeViolations(checkSkillAssignment(['shader-single-strict'], policy))
	assert.match(text, /shader-single-strict/)
	assert.match(text, /five hats|self-review/i)
	assert.match(text, /shader-team-reviewer/)
	assert.match(text, /allowLeadOnly/)
})

test('shader_dispatch refuses a lead-only skill', async () => {
	const { ctx, tools, starts } = mockContext()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const dispatch = tools.get('shader_dispatch')
	await assert.rejects(
		() =>
			dispatch.execute(
				{ title: 't', brief: 'b', acceptance: 'a', skills: ['shader-single'] },
				exec(),
			),
		(error) => error instanceof ShaderModeError && error.code === 'SKILL_ROLE_CONFLICT',
	)
	assert.equal(starts.length, 0, 'a refused dispatch must not start a worker')
})

test('shader_dispatch allows the role skills', async () => {
	const { ctx, tools, starts } = mockContext()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const dispatch = tools.get('shader_dispatch')
	const value = await dispatch.execute(
		{
			title: 't',
			brief: 'b',
			acceptance: 'a',
			skills: ['shader-team-programmer', 'ds-verify-loop'],
		},
		exec(),
	)
	assert.equal(value.taskId, 'T1')
	assert.equal(starts.length, 1)
})

test('allowLeadOnly overrides the policy for one dispatch', async () => {
	const { ctx, tools, starts } = mockContext()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const dispatch = tools.get('shader_dispatch')
	const value = await dispatch.execute(
		{
			title: 't',
			brief: 'b',
			acceptance: 'a',
			skills: ['shader-single-strict'],
			allowLeadOnly: true,
			context: 'Requirements are frozen in BRIEF.md §1; do not re-freeze them.',
		},
		exec(),
	)
	assert.equal(value.taskId, 'T1')
	assert.equal(starts.length, 1)
})

test('a configured policy replaces the default', async () => {
	const { ctx, tools } = mockContext()
	registerLeadTools(
		ctx,
		{ workerPreset: 'shader-worker', maxDepth: 0, leadOnlySkills: ['my-solo-flow'] },
		new BoardRegistry(),
	)
	const dispatch = tools.get('shader_dispatch')
	// The default entry is gone, so it is now allowed.
	await dispatch.execute({ title: 't', brief: 'b', acceptance: 'a', skills: ['shader-single'] }, exec())
	await assert.rejects(
		() => dispatch.execute({ title: 't', brief: 'b', acceptance: 'a', skills: ['my-solo-flow'] }, exec()),
		(error) => error instanceof ShaderModeError && error.code === 'SKILL_ROLE_CONFLICT',
	)
})
