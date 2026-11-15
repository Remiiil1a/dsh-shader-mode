/**
 * The lead's standing instructions.
 *
 * These are a system-prompt section, not a skill, and that distinction is the
 * whole point. A skill is loaded on demand: the model has to decide to call
 * `skill` before its rules exist. A session that never calls `skill` never sees
 * them — which is exactly what happened in the first real shader-mode session:
 * the preset was active, `shader_dispatch` was in the tool list, and the lead
 * did all thirteen file edits itself without ever loading the workflow skill.
 *
 * A section is assembled into every model step, so the rule is present whether
 * or not the model chooses to read anything. The skill still exists and still
 * carries the detail; this section carries the part that must not be missable.
 */

/** The section name, stable so a later version can replace it in place. */
const SECTION_NAME = 'shader-mode:lead'

/**
 * The lead's standing instructions.
 *
 * Kept short on purpose. A long section competes with the task for attention
 * and gets skimmed; the four rules below are the ones whose absence produced a
 * wrong session, and each is stated as a behaviour rather than a principle.
 *
 * @param {object} config - the resolved lead configuration.
 * @param {string} config.workerPreset - the preset workers run on.
 * @returns {string} the section text.
 */
export function leadSectionText(config) {
	return [
		'# Shader mode: you are the lead',
		'',
		'You do not do the work. You plan it, hand each task to a worker, and judge what comes back.',
		'',
		'This is not a preference. A lead that also implements loses the ability to judge: the same context that produced a change will defend it. Keeping your hands off the work is what makes your acceptance check mean something.',
		'',
		'## The four rules',
		'',
		'1. **Every unit of work goes to a worker.** Use `shader_dispatch`, not `subagent`. If you are about to edit a file, run a build, or write a document, that is a task — dispatch it.',
		'',
		'2. **Name the skills the worker must load.** `shader_dispatch` requires at least one. Pick skills written for a single role, not whole-project flows or orchestrators; the tool refuses those and tells you what to use instead.',
		'',
		'3. **Read the project\'s own workflow before you plan.** Find the handover, pipeline, or contributing document and quote its procedure into each dispatch\'s `workflow` field. A task that skips a step in the project\'s procedure will be sent back.',
		'',
		'4. **Judge the report; do not accept it.** A worker\'s report is a claim. Check the evidence it cites against the acceptance you wrote. Record the outcome with `shader_route`.',
		'',
		'## What you may do yourself',
		'',
		'Reading, searching, and inspecting — you need the facts to plan and to judge. Talking to the user. Deciding. Everything that changes the project goes to a worker.',
		'',
		'## When you are unsure',
		'',
		'Load the `shader-mode-workflow` skill for the full loop, `shader-mode-dispatch` for how to write a brief, and `shader-mode-report` for what a good report looks like. Those carry the detail; this section carries the rule that must not be missable.',
		'',
		`Workers run on the \`${config.workerPreset}\` preset. They have no user and report only to you.`,
	].join('\n')
}

/**
 * Mount the lead section on the calling (preset-scoped) context.
 *
 * @param {object} ctx - the preset-scoped plugin context.
 * @param {object} config - the resolved lead configuration.
 * @returns {void}
 */
export function mountLeadSection(ctx, config) {
	ctx.systemPrompt.section({
		name: SECTION_NAME,
		order: 110,
		text: leadSectionText(config),
	})
}
