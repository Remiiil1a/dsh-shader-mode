/**
 * The lead's tools: `shader_dispatch`, `shader_board`, and `shader_route`.
 *
 * These exist because the shader-mode workflow has one rule the generic
 * delegation tools cannot express: **every task goes to a worker, and the lead
 * names the skills that worker must load.** `subagent` starts a child but says
 * nothing about skills; `shader_dispatch` starts the same child and writes the
 * skill assignment into the prompt, then records the task on the board so the
 * lead can restate it later without re-reading a transcript.
 *
 * Nothing here replaces the Harness's own delegation machinery: the child is a
 * normal `spawn` activation, the lead still talks to it with `send_message`,
 * and completion still arrives as a normal completion notice.
 */

import { BoardRegistry } from './lib/board.js'
import { checkSkillAssignment, describeViolations, resolveSkillPolicy } from './lib/skill-policy.js'
import {
	ShaderModeError,
	clipLabel,
	defineShaderTool,
	listOr,
	optionalString,
	optionalStringArray,
	requireString,
} from './lib/tool.js'

/** The delegation provider this plugin starts children on. */
const PROVIDER = 'spawn'

/**
 * Compose the prompt a worker receives.
 *
 * The skill assignment is written as an explicit instruction rather than a
 * hint, because a worker that skips its skills is the failure mode this whole
 * plugin exists to prevent. The brief is quoted verbatim so the worker can tell
 * the lead's words apart from the framing.
 *
 * @param {object} input - the dispatch.
 * @param {string} input.title - short task title.
 * @param {string} input.brief - the task text.
 * @param {string[]} input.skills - skills to load before starting.
 * @param {string} input.acceptance - how the lead will judge the result.
 * @param {string | undefined} input.workflow - the project workflow to follow.
 * @param {string | undefined} input.context - extra context for the worker.
 * @param {string} input.taskId - the board id, so the worker can quote it back.
 * @returns {string} the prompt.
 */
function composeWorkerPrompt(input) {
	const lines = [
		`You are a shader-mode worker. Task ${input.taskId}: ${input.title}`,
		'',
		'## Skills to load first',
		'',
		'Load these skills with the `skill` tool before you start, and follow their instructions for the whole task:',
		...input.skills.map((name) => `- \`${name}\``),
		'',
		'If a skill above is not in your catalog, say so in your report instead of substituting your own process.',
		'',
		'## Task',
		'',
		input.brief,
		'',
	]
	if (input.workflow !== undefined) {
		lines.push('## Workflow to follow', '', input.workflow, '')
	}
	if (input.context !== undefined) {
		lines.push('## Context', '', input.context, '')
	}
	lines.push(
		'## Acceptance',
		'',
		input.acceptance,
		'',
		'## How to report',
		'',
		'You do not talk to the user. Your final message is your report to the lead, and it is the only thing the lead sees. Make it carry:',
		'',
		'1. What you did, in the order you did it, naming the files you touched.',
		'2. The evidence you actually ran — commands, their exit status, and the numbers or output that matter. If you did not run something, say so; do not describe an intention as a result.',
		'3. Which acceptance points you believe are met, and which are not.',
		'4. Anything the lead must decide before the next task can start.',
		'',
		`Quote the task id (${input.taskId}) in your first line so the lead can match the report to the board.`,
	)
	return lines.join('\n')
}

/**
 * Find assigned skills the model is not allowed to invoke.
 *
 * `ctx.skills.list()` returns every skill the session can see, including ones
 * whose frontmatter sets `disable-model-invocation: true`. The `skill` tool
 * refuses those, so a worker told to load one fails at its first step. The
 * skill manager writes that flag into every skill it has not explicitly
 * enabled, which makes this a live hazard rather than a theoretical one.
 *
 * @param {object} ctx - the plugin context.
 * @param {readonly string[]} skills - the assigned names.
 * @param {object} agent - the calling agent, used as the skill scope.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<Array<{ name: string, reason: 'missing' | 'not-invocable' }>>} the problems.
 */
async function findUnloadableSkills(ctx, skills, agent, signal) {
	// Optional access: a composition without the skill registry should degrade to
	// "cannot check", not fail the whole lead row.
	const registry = ctx.get?.('skills') ?? ctx.skills
	if (registry === undefined) return []
	let available
	try {
		available = await registry.list({ scope: agent, signal })
	} catch {
		// A registry that cannot answer is not evidence of a bad assignment.
		return []
	}
	const byName = new Map(available.map((skill) => [skill.name, skill]))
	const problems = []
	for (const name of skills) {
		const skill = byName.get(name)
		if (skill === undefined) {
			problems.push({ name, reason: 'missing' })
			continue
		}
		if (skill.invocation?.modelInvocable === false) {
			problems.push({ name, reason: 'not-invocable' })
		}
	}
	return problems
}

/**
 * Render the rejection a lead reads when an assigned skill cannot be loaded.
 *
 * @param {readonly { name: string, reason: 'missing' | 'not-invocable' }[]} problems - the problems.
 * @returns {string} the model-facing message.
 */
function describeUnloadable(problems) {
	const lines = ['This dispatch assigns skills the worker cannot load:', '']
	for (const problem of problems) {
		if (problem.reason === 'missing') {
			lines.push(`- \`${problem.name}\`: not in this session's skill catalog. Check the spelling.`)
		} else {
			lines.push(
				`- \`${problem.name}\`: present but marked \`disable-model-invocation: true\`, so the \`skill\` tool refuses it.`,
			)
		}
	}
	const blocked = problems.filter((problem) => problem.reason === 'not-invocable')
	if (blocked.length > 0) {
		lines.push(
			'',
			'That flag is written by the skill manager, which disables every skill it has not explicitly enabled. Enable the skill in the skill manager, or remove the line from its `SKILL.md` frontmatter, then dispatch again.',
			'',
			`To unblock every skill this package recommends: \`node scripts/enable-skills.js\` from the package directory.`,
		)
	}
	return lines.join('\n')
}

/**
 * Register the lead-side tools.
 *
 * @param {object} ctx - the plugin context.
 * @param {object} options - resolved plugin configuration.
 * @param {string} options.workerPreset - preset id every worker is started with.
 * @param {number} options.maxDepth - delegation depth handed to each child.
 * @param {unknown} options.leadOnlySkills - configured skill policy, or undefined for the default.
 * @param {BoardRegistry} options.boards - the shared board registry.
 * @returns {void}
 */
export function registerLeadTools(ctx, options, boards) {
	const skillPolicy = resolveSkillPolicy(options.leadOnlySkills)

	ctx.tools.register(
		defineShaderTool({
			name: 'shader_dispatch',
			description: [
				'Dispatch one task to a fresh worker and return its id immediately.',
				'',
				'Use this instead of `subagent` for every task in shader mode. It starts the worker on the shader-mode worker preset, writes your skill assignment into the worker prompt as an instruction, and records the task on the board so `shader_board` can restate it later.',
				'',
				'The worker does not see this conversation and does not talk to the user. Everything it needs must be in `brief`, `context`, and `acceptance`. Its final message is its report to you.',
				'',
				'You are notified when the worker finishes. Do not poll for it.',
			].join('\n'),
			parameters: {
				type: 'object',
				additionalProperties: false,
				required: ['title', 'brief', 'skills', 'acceptance'],
				properties: {
					title: {
						type: 'string',
						description: 'Short task title, shown on the board and in the worker prompt. One line.',
					},
					brief: {
						type: 'string',
						description:
							'The complete task, written for someone who cannot see this conversation. Name the files, the effect, and the constraint. Do not write "as discussed".',
					},
					skills: {
						type: 'array',
						items: { type: 'string' },
						description:
							'Skill names the worker must load before starting, in the order it should load them. Use exact catalog names such as `ds-plan-loop` or `shader-team-programmer`. At least one is required: a task with no skill assignment is a task whose process you have not decided.',
					},
					acceptance: {
						type: 'string',
						description:
							'How you will judge the result, as checkable statements. "Looks good" is not acceptance; "the chain exits 0 and the package has 304 entries" is.',
					},
					allowLeadOnly: {
						type: 'boolean',
						description:
							'Override the skill-role policy for this dispatch. Only set it when you have already done the part of the skill that needs a user — typically requirement freezing — and wrote the result down in `context`. Without it, a dispatch naming a whole-project or orchestrator skill is refused.',
					},
					workflow: {
						type: 'string',
						description:
							'The project workflow this task must follow, quoted from the project (for example the numbered delivery steps in its handover document). Omit only for a project that has no workflow yet.',
					},
					context: {
						type: 'string',
						description: 'Extra facts the worker needs: paths, prior decisions, what earlier tasks established.',
					},
					cwd: {
						type: 'string',
						description: 'Working directory for the worker. Defaults to the current one.',
					},
				},
			},
			outputSchema: {
				type: 'object',
				additionalProperties: false,
				required: ['taskId', 'childId'],
				properties: {
					taskId: { type: 'string' },
					childId: { type: 'string' },
					skills: { type: 'array', items: { type: 'string' } },
				},
			},
			render: (args, value) => [
				{
					type: 'text',
					text: [
						`dispatched ${value.taskId} → worker ${value.childId}`,
						`skills: ${listOr(value.skills)}`,
						'You will be notified when it reports. Continue with other work, or wait.',
					].join('\n'),
				},
			],
			presentCall: (args) => ({
				card: 'generic',
				title: `Dispatch ${typeof args?.title === 'string' ? args.title : 'task'}`,
				kind: 'run',
				rawInput: args,
			}),
			async execute(args, exec) {
				const parent = exec.agent
				if (parent === undefined) {
					throw new ShaderModeError('shader_dispatch needs a calling agent.', 'NO_AGENT')
				}
				const title = requireString(args, 'title')
				const brief = requireString(args, 'brief')
				const acceptance = requireString(args, 'acceptance')
				const skills = optionalStringArray(args, 'skills')
				if (skills.length === 0) {
					throw new ShaderModeError(
						'A dispatch must name at least one skill for the worker to load. Pick the skills that define how this task is done.',
						'NO_SKILLS',
					)
				}
				const workflow = optionalString(args, 'workflow')
				const context = optionalString(args, 'context')
				const cwd = optionalString(args, 'cwd')

				// A skill written for a whole project, for a user-facing role, or for
				// orchestrating its own team does not become a worker skill by being
				// assigned to one. Refuse it and say what to use instead.
				if (args?.allowLeadOnly !== true) {
					const violations = checkSkillAssignment(skills, skillPolicy)
					if (violations.length > 0) {
						throw new ShaderModeError(describeViolations(violations), 'SKILL_ROLE_CONFLICT')
					}
				}

				// A skill the model cannot invoke is a skill the worker cannot load.
				// The skill manager writes `disable-model-invocation: true` into
				// every skill it has not explicitly enabled, so a name that looks
				// right in the catalog can still be unloadable. Check before
				// starting a worker, not after it fails.
				const unloadable = await findUnloadableSkills(ctx, skills, parent, exec.signal)
				if (unloadable.length > 0) {
					throw new ShaderModeError(describeUnloadable(unloadable), 'SKILL_NOT_INVOCABLE')
				}

				const board = boards.for(parent.id)
				// Reserve the board id before starting the child so the prompt can
				// quote it; the record is completed once the child id is known.
				const taskId = `T${board.counter + 1}`
				const prompt = composeWorkerPrompt({ title, brief, skills, acceptance, workflow, context, taskId })

				const activation = await ctx.subagents.startActivation({
					provider: PROVIDER,
					label: clipLabel(`${taskId} ${title}`),
					request: {
						prompt: [{ type: 'text', text: prompt }],
						parent,
						agentPreset: options.workerPreset,
						maxDepth: options.maxDepth,
						...(cwd === undefined ? {} : { cwd }),
					},
					signal: exec.signal,
					delivery: 'parent',
				})

				board.add({
					childId: activation.childId,
					title,
					brief,
					skills,
					acceptance,
					workflow,
				})
				// `add` minted its own id from the same counter; keep the prompt's id.
				const stored = board.find(activation.childId)
				if (stored !== undefined && stored.id !== taskId) stored.id = taskId

				return { taskId, childId: activation.childId, skills }
			},
		}),
	)

	ctx.tools.register(
		defineShaderTool({
			name: 'shader_board',
			description: [
				'Read the dispatch board for this session: every task you handed to a worker, its skills, its acceptance, and what came back.',
				'',
				'Use it before dispatching a follow-up so you restate the task instead of re-deriving it, and before reporting to the user so you do not claim work that is still open.',
				'',
				'The board is a cache. If it is empty but workers exist, the Host restarted: read the child sessions instead of assuming nothing was dispatched.',
			].join('\n'),
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					task: {
						type: 'string',
						description: 'One task id (T1) or worker session id. Omit to list every task.',
					},
					state: {
						type: 'string',
						enum: ['dispatched', 'reported', 'accepted', 'rework', 'dropped'],
						description: 'Only list tasks in this state.',
					},
				},
			},
			outputSchema: {
				type: 'object',
				additionalProperties: false,
				required: ['tasks'],
				properties: {
					tasks: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								id: { type: 'string' },
								childId: { type: 'string' },
								title: { type: 'string' },
								state: { type: 'string' },
								skills: { type: 'array', items: { type: 'string' } },
								acceptance: { type: 'string' },
								workflow: { type: 'string' },
								report: { type: 'string' },
								reworkRounds: { type: 'number' },
							},
						},
					},
				},
			},
			render: (args, value) => {
				if (value.tasks.length === 0) {
					return [{ type: 'text', text: 'The board is empty: no task has been dispatched from this session.' }]
				}
				const blocks = value.tasks.map((task) => {
					const lines = [
						`${task.id} [${task.state}] ${task.title}`,
						`  worker: ${task.childId}`,
						`  skills: ${listOr(task.skills)}`,
						`  acceptance: ${task.acceptance}`,
					]
					if (task.workflow !== undefined) lines.push(`  workflow: ${task.workflow}`)
					if (task.reworkRounds > 0) lines.push(`  rework rounds: ${task.reworkRounds}`)
					if (task.report !== undefined) lines.push(`  report: ${task.report}`)
					return lines.join('\n')
				})
				return [{ type: 'text', text: blocks.join('\n\n') }]
			},
			async execute(args, exec) {
				const parent = exec.agent
				if (parent === undefined) {
					throw new ShaderModeError('shader_board needs a calling agent.', 'NO_AGENT')
				}
				const board = boards.peek(parent.id)
				if (board === undefined) return { tasks: [] }
				const key = optionalString(args, 'task')
				const state = optionalString(args, 'state')
				let tasks = key === undefined ? board.list() : [board.find(key)].filter((task) => task !== undefined)
				if (state !== undefined) tasks = tasks.filter((task) => task.state === state)
				return {
					tasks: tasks.map((task) => ({
						id: task.id,
						childId: task.childId,
						title: task.title,
						state: task.state,
						skills: task.skills,
						acceptance: task.acceptance,
						...(task.workflow === null ? {} : { workflow: task.workflow }),
						...(task.report === null ? {} : { report: task.report }),
						reworkRounds: task.reworkRounds,
					})),
				}
			},
		}),
	)

	ctx.tools.register(
		defineShaderTool({
			name: 'shader_route',
			description: [
				'Record what happened to a dispatched task: the worker reported, you accepted it, you sent it back for rework, or you dropped it.',
				'',
				'Call this when a worker report arrives and again when you decide on it. The board is what stops the next task from being written against a stale understanding of the last one.',
			].join('\n'),
			parameters: {
				type: 'object',
				additionalProperties: false,
				required: ['task', 'state'],
				properties: {
					task: { type: 'string', description: 'Task id (T1) or worker session id.' },
					state: {
						type: 'string',
						enum: ['reported', 'accepted', 'rework', 'dropped'],
						description: 'The state the task moves to.',
					},
					report: {
						type: 'string',
						description: 'The worker report, condensed to what the next task needs. Required when state is `reported`.',
					},
					note: {
						type: 'string',
						description: 'Why the task moved to this state. Required when state is `rework` or `dropped`.',
					},
				},
			},
			outputSchema: {
				type: 'object',
				additionalProperties: false,
				required: ['taskId', 'state'],
				properties: {
					taskId: { type: 'string' },
					state: { type: 'string' },
					reworkRounds: { type: 'number' },
				},
			},
			render: (_args, value) => [
				{ type: 'text', text: `${value.taskId} → ${value.state}${value.reworkRounds > 0 ? ` (rework round ${value.reworkRounds})` : ''}` },
			],
			async execute(args, exec) {
				const parent = exec.agent
				if (parent === undefined) {
					throw new ShaderModeError('shader_route needs a calling agent.', 'NO_AGENT')
				}
				const key = requireString(args, 'task')
				const state = requireString(args, 'state')
				const board = boards.peek(parent.id)
				const task = board?.find(key)
				if (task === undefined) {
					throw new ShaderModeError(
						`No task "${key}" on this session's board. Call shader_board to see the ids you dispatched.`,
						'UNKNOWN_TASK',
					)
				}
				if (state === 'reported') {
					board.recordReport(task, requireString(args, 'report'))
				} else {
					if (state === 'rework' || state === 'dropped') requireString(args, 'note')
					board.setState(task, state, optionalString(args, 'note'))
				}
				return { taskId: task.id, state: task.state, reworkRounds: task.reworkRounds }
			},
		}),
	)
}

/**
 * Create the board registry a plugin instance owns.
 *
 * @returns {BoardRegistry} the registry.
 */
export function createBoards() {
	return new BoardRegistry()
}
