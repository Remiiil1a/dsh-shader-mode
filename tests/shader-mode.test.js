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
import { isMutatingTool, mountLeadGuard, reminderText } from '../guard.js'
import { leadSectionText } from '../lead.js'
import { compareSkills, describeSkills, readLoadedSkills } from '../lib/skill-audit.js'
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

test('the lead section states the four rules without needing a skill load', () => {
	const text = leadSectionText({ workerPreset: 'shader-worker' })
	// The rule that was missing in the first real session.
	assert.match(text, /Every unit of work goes to a worker/)
	assert.match(text, /shader_dispatch/)
	assert.match(text, /Name the skills the worker must load/)
	assert.match(text, /Read the project's own workflow/)
	assert.match(text, /Judge the report/)
	// It must say what the lead may still do, or it reads as "do nothing".
	assert.match(text, /Reading, searching, and inspecting/)
	// And it must name the worker preset it dispatches to.
	assert.match(text, /shader-worker/)
})

test('the guard recognises the tools that change the project', () => {
	for (const name of ['edit', 'write', 'apply_patch', 'pwsh', 'bash']) {
		assert.equal(isMutatingTool(name), true, `${name} changes the project`)
	}
	for (const name of ['read', 'grep', 'glob', 'shader_dispatch', 'shader_board', 'skill', 'ask_user_question']) {
		assert.equal(isMutatingTool(name), false, `${name} does not change the project`)
	}
})

test('the reminder names the tool and the next step', () => {
	const idle = reminderText('edit', 0)
	assert.match(idle, /`edit`/)
	assert.match(idle, /No task is open/)
	assert.match(idle, /shader_dispatch/)
	assert.match(idle, /Reading, searching, and inspecting are yours/)

	const busy = reminderText('pwsh', 2)
	assert.match(busy, /2 open task/)
	assert.match(busy, /send the worker a message/)
})

test('the guard attaches a note to a successful mutating call', async () => {
	const handlers = []
	const ctx = {
		on(event, handler) {
			if (event === 'tools/post-execute') handlers.push(handler)
			return () => {}
		},
	}
	const boards = new BoardRegistry()
	mountLeadGuard(ctx, boards, { remindOnDirectEdit: true })
	assert.equal(handlers.length, 1)

	const handler = handlers[0]
	const result = { isError: false, content: [{ type: 'text', text: 'file written' }] }
	const decision = await handler(
		{ name: 'edit', agent: { id: 'lead-1' } },
		result,
		async () => ({ kind: 'accept' }),
	)
	assert.equal(decision.kind, 'accept')
	assert.equal(decision.content.length, 2)
	assert.match(decision.content[1].text, /you just used `edit` yourself/)
})

test('the guard stays quiet for reads, failures, and non-lead calls', async () => {
	const handlers = []
	const ctx = {
		on(_event, handler) {
			handlers.push(handler)
			return () => {}
		},
	}
	mountLeadGuard(ctx, new BoardRegistry(), { remindOnDirectEdit: true })
	const handler = handlers[0]
	const accept = async () => ({ kind: 'accept' })

	// A read is not work.
	assert.deepEqual(await handler({ name: 'read', agent: { id: 'a' } }, { isError: false }, accept), { kind: 'accept' })
	// A failed edit is not work done.
	assert.deepEqual(await handler({ name: 'edit', agent: { id: 'a' } }, { isError: true }, accept), { kind: 'accept' })
	// A call with no agent is not a lead call.
	assert.deepEqual(await handler({ name: 'edit' }, { isError: false }, accept), { kind: 'accept' })
	// A blocked decision is left alone.
	assert.deepEqual(
		await handler({ name: 'edit', agent: { id: 'a' } }, { isError: false }, async () => ({ kind: 'block', feedback: [] })),
		{ kind: 'block', feedback: [] },
	)
})

test('the guard can be turned off', () => {
	const handlers = []
	const ctx = { on(_event, handler) { handlers.push(handler); return () => {} } }
	mountLeadGuard(ctx, new BoardRegistry(), { remindOnDirectEdit: false })
	assert.equal(handlers.length, 0)
})

test('shader_dispatch refuses a skill the model cannot invoke', async () => {
	const { ctx, tools, starts } = mockContext()
	// A registry that reports the skill as present but not model-invocable, which
	// is what the skill manager produces for every skill it has not enabled.
	ctx.skills = {
		async list() {
			return [
				{ name: 'shader-team-programmer', invocation: { modelInvocable: true } },
				{ name: 'shader-team-architect', invocation: { modelInvocable: false } },
			]
		},
	}
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const dispatch = tools.get('shader_dispatch')

	await assert.rejects(
		() =>
			dispatch.execute(
				{ title: 't', brief: 'b', acceptance: 'a', skills: ['shader-team-architect'] },
				exec(),
			),
		(error) => error instanceof ShaderModeError && error.code === 'SKILL_NOT_INVOCABLE',
	)
	assert.equal(starts.length, 0, 'a refused dispatch must not start a worker')
})

test('shader_dispatch refuses a skill that is not in the catalog', async () => {
	const { ctx, tools } = mockContext()
	ctx.skills = { async list() { return [{ name: 'shader-glsl', invocation: { modelInvocable: true } }] } }
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	await assert.rejects(
		() =>
			tools.get('shader_dispatch').execute(
				{ title: 't', brief: 'b', acceptance: 'a', skills: ['shader-glsl', 'no-such-skill'] },
				exec(),
			),
		(error) => error instanceof ShaderModeError && error.code === 'SKILL_NOT_INVOCABLE',
	)
})

test('shader_dispatch proceeds when every assigned skill is invocable', async () => {
	const { ctx, tools, starts } = mockContext()
	ctx.skills = {
		async list() {
			return [
				{ name: 'shader-team-programmer', invocation: { modelInvocable: true } },
				{ name: 'ds-verify-loop', invocation: { modelInvocable: true } },
			]
		},
	}
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const value = await tools.get('shader_dispatch').execute(
		{ title: 't', brief: 'b', acceptance: 'a', skills: ['shader-team-programmer', 'ds-verify-loop'] },
		exec(),
	)
	assert.equal(value.taskId, 'T1')
	assert.equal(starts.length, 1)
})

test('a missing skill registry does not block a dispatch', async () => {
	const { ctx, tools, starts } = mockContext()
	// No ctx.skills at all: the check degrades to "cannot verify", not "refuse".
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const value = await tools.get('shader_dispatch').execute(
		{ title: 't', brief: 'b', acceptance: 'a', skills: ['shader-team-programmer'] },
		exec(),
	)
	assert.equal(value.taskId, 'T1')
	assert.equal(starts.length, 1)
})

test('the lead section tells the lead to say the assignment out loud', () => {
	const text = leadSectionText({ workerPreset: 'shader-worker' })
	assert.match(text, /Say the assignment out loud/)
	assert.match(text, /the user cannot see which skills are doing the work/)
	// And it must mention that the board reports what was actually loaded.
	assert.match(text, /actually loaded/)
})

test('readLoadedSkills reads skill-invocation records from the session log', async () => {
	const ctx = {
		sessionQuery: {
			async open() {
				return {
					async read() {
						return {
							events: [
								{ type: 'user/message', data: { message: { source: { kind: 'user' } } } },
								{ type: 'user/message', data: { message: { source: { kind: 'skill-invocation', name: 'shader-team-programmer' } } } },
								{ type: 'user/message', data: { message: { source: { kind: 'skill-invocation', name: 'ds-verify-loop' } } } },
								// A repeat load is not a second skill.
								{ type: 'user/message', data: { message: { source: { kind: 'skill-invocation', name: 'ds-verify-loop' } } } },
							],
						}
					},
				}
			},
		},
	}
	const actual = await readLoadedSkills(ctx, 'child-1')
	assert.equal(actual.available, true)
	assert.deepEqual(actual.loaded, ['shader-team-programmer', 'ds-verify-loop'])
})

test('readLoadedSkills reports unreadable rather than empty', async () => {
	// No query service at all.
	assert.deepEqual(await readLoadedSkills({}, 'child-1'), { loaded: [], failed: [], available: false })
	// A service that throws.
	const throwing = { sessionQuery: { async open() { throw new Error('gone') } } }
	assert.deepEqual(await readLoadedSkills(throwing, 'child-1'), { loaded: [], failed: [], available: false })
	// A service with no usable read face.
	assert.deepEqual(await readLoadedSkills({ sessionQuery: {} }, 'child-1'), { loaded: [], failed: [], available: false })
})

test('compareSkills separates skipped from extra', () => {
	assert.deepEqual(compareSkills(['a', 'b'], ['a', 'b']), { missing: [], extra: [] })
	assert.deepEqual(compareSkills(['a', 'b'], ['a']), { missing: ['b'], extra: [] })
	assert.deepEqual(compareSkills(['a'], ['a', 'c']), { missing: [], extra: ['c'] })
})

test('describeSkills distinguishes assigned from loaded', () => {
	assert.match(describeSkills(['a'], { loaded: [], available: false }), /could not read/)
	assert.match(describeSkills(['a'], { loaded: [], available: true }), /has not loaded any yet/)
	const mixed = describeSkills(['a', 'b'], { loaded: ['a', 'c'], available: true })
	assert.match(mixed, /skills loaded: a, c/)
	assert.match(mixed, /assigned but not loaded: b/)
	assert.match(mixed, /loaded but not assigned: c/)
})

test('shader_board reports what each worker actually loaded', async () => {
	const { ctx, tools } = mockContext()
	ctx.sessionQuery = {
		async open(sessionId) {
			return {
				async read() {
					return {
						events:
							sessionId === 'child-1'
								? [{ type: 'user/message', data: { message: { source: { kind: 'skill-invocation', name: 'shader-team-programmer' } } } }]
								: [],
					}
				},
			}
		},
	}
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	await tools.get('shader_dispatch').execute(
		{ title: 'one', brief: 'b', acceptance: 'a', skills: ['shader-team-programmer'] },
		exec(),
	)
	const board = await tools.get('shader_board').execute({}, exec())
	assert.equal(board.tasks.length, 1)
	assert.deepEqual(board.tasks[0].loadedSkills, ['shader-team-programmer'])
	assert.equal(board.tasks[0].skillsReadable, true)
})

test('shader_route records the loaded set with the decision', async () => {
	const { ctx, tools } = mockContext()
	ctx.sessionQuery = {
		async open() {
			return {
				async read() {
					return { events: [{ type: 'user/message', data: { message: { source: { kind: 'skill-invocation', name: 'ds-verify-loop' } } } }] }
				},
			}
		},
	}
	const boards = new BoardRegistry()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, boards)
	await tools.get('shader_dispatch').execute(
		{ title: 'one', brief: 'b', acceptance: 'a', skills: ['shader-team-programmer'] },
		exec(),
	)
	const routed = await tools.get('shader_route').execute({ task: 'T1', state: 'reported', report: 'done' }, exec())
	assert.deepEqual(routed.loadedSkills, ['ds-verify-loop'])
	assert.equal(routed.skillsReadable, true)
	// The board keeps it, so a later read does not need the session again.
	assert.deepEqual(boards.peek('lead-1').find('T1').loadedSkills, ['ds-verify-loop'])
})

test('shader_dispatch puts the skill assignment on the card', () => {
	const { ctx, tools } = mockContext()
	registerLeadTools(ctx, { workerPreset: 'shader-worker', maxDepth: 0 }, new BoardRegistry())
	const dispatch = tools.get('shader_dispatch')
	const args = { title: 'Fix the band', brief: 'b', acceptance: 'a', skills: ['shader-team-programmer', 'ds-verify-loop'] }

	const pending = dispatch.presentCall(args)
	assert.equal(pending.card, 'generic')
	assert.match(pending.title, /Fix the band/)
	assert.match(pending.content[0].text, /`shader-team-programmer`/)
	assert.match(pending.content[0].text, /`ds-verify-loop`/)

	const done = dispatch.presentResult(args, { isError: false })
	assert.match(done.content[0].text, /`shader-team-programmer`/)
	assert.match(done.content[0].text, /the worker is running/)
})
