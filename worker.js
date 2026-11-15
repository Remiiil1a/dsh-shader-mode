/**
 * The worker half: the standing instructions a shader-mode worker runs under.
 *
 * A worker is an ordinary child agent on the `shader-worker` preset. What makes
 * it a *worker* is this section: it is mounted only on that preset, so it
 * reaches every worker and nothing else. It states the two facts a child agent
 * cannot infer on its own — that it has no user, and that its final message is
 * a report rather than a reply.
 *
 * The section is deliberately short. The task-specific process belongs to the
 * skills the lead assigns, and repeating it here would give the worker two
 * sources of truth that can disagree.
 */

/** The section name, stable so a later version can replace it in place. */
const SECTION_NAME = 'shader-mode:worker'

/** Services this row needs before it can activate. */
export const inject = ['systemPrompt']

/**
 * The worker's standing instructions.
 *
 * @param {object} config - the resolved worker configuration.
 * @param {string} config.leadName - how the worker should refer to its lead.
 * @returns {string} the section text.
 */
export function workerSectionText(config) {
	return [
		'# Shader mode: you are a worker',
		'',
		`You were started by ${config.leadName}, the lead of this session. You are one task in a larger job.`,
		'',
		'## You have no user',
		'',
		'There is no human on the other end of this conversation. The lead is your only reader. Do not address a user, do not ask a user a question, and do not write a summary for one. If something is genuinely undecidable, say what you need decided and stop — the lead decides, not you.',
		'',
		'## Your final message is a report',
		'',
		'The lead sees your final message and nothing else. It must stand on its own: what you did, the evidence you ran, which acceptance points you met, and what the lead must decide next. A report that says "done" without evidence is worse than a report that says "not done, here is what blocked it".',
		'',
		'## Load the skills you were assigned',
		'',
		'Your task names the skills to load. Load them with the `skill` tool before you start and follow them for the whole task. They define how the work is done here; your own default process does not override them. If an assigned skill is missing from your catalog, report that instead of substituting a process of your own.',
		'',
		'## Stay inside your task',
		'',
		'Do the task you were given. Do not start the next task, do not widen the scope to fix something you noticed, and do not report on work you did not do. If the task cannot be done as written, report why and stop — the lead re-plans.',
	].join('\n')
}

/**
 * Mount the worker section on the calling (preset-scoped) context.
 *
 * @param {object} ctx - the preset-scoped plugin context.
 * @param {object} config - the resolved worker configuration.
 * @returns {void}
 */
export function mountWorkerSection(ctx, config) {
	ctx.systemPrompt.section({
		name: SECTION_NAME,
		order: 120,
		text: workerSectionText(config),
	})
}

/**
 * Resolve the row's configuration.
 *
 * @param {unknown} config - the Loader row config.
 * @returns {{ leadName: string }} the resolved values.
 */
export function resolveConfig(config) {
	const raw = config !== null && typeof config === 'object' ? config : {}
	return {
		leadName: typeof raw.leadName === 'string' && raw.leadName !== '' ? raw.leadName : 'the lead',
	}
}

/**
 * Activate the worker row.
 *
 * @param {object} ctx - the preset-scoped plugin context.
 * @param {unknown} config - the Loader row config.
 * @returns {void}
 */
export function apply(ctx, config) {
	mountWorkerSection(ctx, resolveConfig(config))
}
