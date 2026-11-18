/**
 * The lead half: the tools, the standing instructions, and the guard.
 *
 * Everything here is mounted on the `shader-lead` preset and nowhere else. That
 * scoping is load-bearing: a preset-scoped row is mounted once per preset
 * revision and shared by the agents that select it, so a standard-mode session
 * never sees `shader_dispatch` and never gets "you are the lead of a
 * shader-mode session" in its system prompt.
 *
 * An earlier version mounted this on the global Host row instead, and the
 * result was a standard-mode session that dispatched a worker for a
 * chrysanthemum-classification task. A global row reaches every session in the
 * profile; a preset row reaches only the sessions that chose it.
 */

import { createBoards, registerLeadTools } from './tools.js'
import { mountLeadGuard } from './guard.js'

/** Services this row needs before it can activate. */
export const inject = ['tools', 'subagents', 'systemPrompt']
/** The section name, stable so a later version can replace it in place. */
const SECTION_NAME = 'shader-mode:lead'

/**
 * Resolve the row's configuration.
 *
 * @param {unknown} config - the Loader row config.
 * @returns {{ workerPreset: string, maxDepth: number, leadOnlySkills: unknown, remindOnDirectEdit: boolean }} the resolved values.
 */
export function resolveConfig(config) {
	const raw = config !== null && typeof config === 'object' ? config : {}
	return {
		workerPreset:
			typeof raw.workerPreset === 'string' && raw.workerPreset !== '' ? raw.workerPreset : 'shader-worker',
		maxDepth: Number.isSafeInteger(raw.maxDepth) && raw.maxDepth >= 1 ? raw.maxDepth : 1,
		// Undefined keeps the built-in policy; an array replaces it, so a profile
		// can add a skill this package has not heard of.
		leadOnlySkills: Array.isArray(raw.leadOnlySkills) ? raw.leadOnlySkills : undefined,
		// The guard is on by default: the first real session showed that a rule
		// in a prompt loses to momentum, so the reminder is a mechanism.
		remindOnDirectEdit: raw.remindOnDirectEdit !== false,
	}
}

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
		'## The five rules',
		'',
		'1. **Every unit of work goes to a worker.** Use `shader_dispatch`, not `subagent`. If you are about to edit a file, run a build, or write a document, that is a task — dispatch it.',
		'',
		'2. **Name the skills the worker must load.** `shader_dispatch` requires at least one. Pick skills written for a single role, not whole-project flows or orchestrators; the tool refuses those and tells you what to use instead.',
		'',
		'3. **Say the assignment out loud.** Before or right after each dispatch, write one line in your reply naming the task and the skills you assigned — `T1 派给 shader-team-programmer + ds-verify-loop`. The assignment otherwise lives only inside a tool call, and the user cannot see which skills are doing the work.',
		'',
		'4. **Read the project\'s own workflow before you plan.** Find the handover, pipeline, or contributing document and quote its procedure into each dispatch\'s `workflow` field. A task that skips a step in the project\'s procedure will be sent back.',
		'',
		'5. **Judge the report; do not accept it.** A worker\'s report is a claim. Check the evidence it cites against the acceptance you wrote. Record the outcome with `shader_route`.',
		'',
		'## Stop investigating and act',
		'',
		'This is the rule that keeps a session from stalling, and it is as binding as the five above.',
		'',
		'**Two checks per question, then decide.** When you want to verify something, run the check that would change your decision. If it comes back the same way twice, you have your answer — act on it. A third confirmation is not diligence, it is a loop.',
		'',
		'**Never re-derive a fact you already established.** If you wrote it down, it is settled. Re-reading the same file to "make sure" is the most common way a session burns an hour.',
		'',
		'**A wrong hypothesis is a result.** Say it was wrong, say what the evidence showed, and move to the next one. Do not re-examine a refuted idea from a new angle.',
		'',
		'**Dispatch before you are certain.** A worker can investigate in parallel with you. Waiting until you have the whole mechanism worked out is how a lead becomes the bottleneck — and the worker is the one who should be doing that investigation anyway.',
		'',
		'**When the user says you are looping, you are.** Stop the current line of reasoning immediately. State what you know, what you do not, and what you are doing next. Do not explain why you were looping.',
		'',
		'**Report a blocked state instead of grinding.** If two attempts at the same problem have failed, or you cannot get the reading you need, say so and ask the user for it. A session that ends with "I need this one fact from you" is a success; a session that ends after an hour of silent verification is not.',
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

/**
 * Activate the lead half.
 *
 * @param {object} ctx - the preset-scoped plugin context.
 * @param {unknown} config - the Loader row config.
 * @returns {void}
 */
export function apply(ctx, config) {
	const resolved = resolveConfig(config)
	const boards = createBoards()
	ctx.effect(() => () => boards.clear(), 'shader-mode: dispatch board')
	mountLeadSection(ctx, resolved)
	registerLeadTools(ctx, resolved, boards)
	mountLeadGuard(ctx, boards, resolved)
}
