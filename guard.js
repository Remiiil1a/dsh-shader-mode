/**
 * The lead's guard: a reminder when the lead starts doing the work itself.
 *
 * The system-prompt section states the rule, but a rule in a prompt is advice.
 * In the first real shader-mode session the lead had `shader_dispatch` in its
 * tool list, had the section available, and still made fifty `edit` calls and
 * seventy-three `pwsh` calls without dispatching once. Advice lost to momentum.
 *
 * So this is a mechanism: when the lead calls a mutating tool while its board
 * has no open task, the call is allowed but a corrective note is attached to
 * the result. The note is cheap, it arrives at the moment of the decision, and
 * it names the tool to use instead.
 *
 * It deliberately does not block. A lead sometimes has a real reason to touch a
 * file — fixing a typo in a dispatch it just wrote, or reading back what a
 * worker produced. Blocking would turn a nudge into an obstacle and teach the
 * lead to route around the plugin. The note is enough to break the momentum,
 * and `shader_route` plus the board keep the record honest.
 */

/** Tools that change the project, and so belong to a worker. */
const MUTATING_TOOLS = new Set(['edit', 'write', 'apply_patch', 'str_replace_editor'])

/** Tools that run commands, which is also work when it changes something. */
const COMMAND_TOOLS = new Set(['pwsh', 'bash', 'terminal_open', 'terminal_signal'])

/**
 * Whether a tool call counts as the lead doing work itself.
 *
 * @param {string} name - the tool name.
 * @returns {boolean} true for a tool that changes the project.
 */
export function isMutatingTool(name) {
	return MUTATING_TOOLS.has(name) || COMMAND_TOOLS.has(name)
}

/**
 * Build the corrective note.
 *
 * @param {string} toolName - the tool the lead just used.
 * @param {number} openTasks - how many dispatched tasks are still open.
 * @returns {string} the note.
 */
export function reminderText(toolName, openTasks) {
	const lines = [
		'<system-reminder>',
		`You are the lead of a shader-mode session, and you just used \`${toolName}\` yourself.`,
		'',
	]
	if (openTasks === 0) {
		lines.push(
			'No task is open on your board, so this change is not covered by any dispatch. If it is real work on the project, it belongs to a worker:',
			'',
			'1. Write the task down — what to change, which files, what not to touch.',
			'2. Call `shader_dispatch` with the skills that define how the work is done.',
			'3. Judge the report against the acceptance you wrote.',
			'',
			'Reading, searching, and inspecting are yours to do. Changing the project is not.',
		)
	} else {
		lines.push(
			`You have ${openTasks} open task(s) on the board. If this change is part of one of them, the worker should be making it — send the worker a message instead of editing the file yourself. If it is a separate piece of work, dispatch it.`,
		)
	}
	lines.push(
		'',
		'If this call was genuinely yours to make — reading back a worker\'s output, fixing your own dispatch text, or a one-line correction you will record — continue, and say so in your next message so the record is honest.',
		'</system-reminder>',
	)
	return lines.join('\n')
}

/**
 * Mount the guard on the calling (preset-scoped) context.
 *
 * @param {object} ctx - the preset-scoped plugin context.
 * @param {object} boards - the board registry.
 * @param {object} options - resolved configuration.
 * @param {boolean} options.remindOnDirectEdit - whether the guard is active.
 * @returns {void}
 */
export function mountLeadGuard(ctx, boards, options) {
	if (options.remindOnDirectEdit !== true) return
	ctx.on('tools/post-execute', async (exec, result, next) => {
		const decision = await next()
		if (decision.kind !== 'accept') return decision
		if (exec.agent === undefined) return decision
		if (!isMutatingTool(exec.name)) return decision
		// A failed call is not work done; do not nag about it.
		if (result.isError === true) return decision

		const board = boards.peek(exec.agent.id)
		const openTasks = board === undefined ? 0 : board.open().length
		const note = reminderText(exec.name, openTasks)

		return {
			...decision,
			content: [...(decision.content ?? result.content ?? []), { type: 'text', text: note }],
		}
	})
}
