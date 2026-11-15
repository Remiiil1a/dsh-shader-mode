/**
 * `dsh-shader-mode` — a lead/worker preset pair for shader work.
 *
 * This file is the **lead** half: the tools a lead uses to hand work to
 * workers. It is mounted only on the `shader-lead` preset, so a worker never
 * sees `shader_dispatch` and cannot fan out on its own.
 *
 * The bundle's other two entries are `./worker.js` (the standing instructions a
 * worker runs under) and `./skills.js` (the shader-mode skills shipped in this
 * package), both mounted only on the `shader-worker` preset.
 *
 * The split is the point. A preset-scoped row is mounted once per preset
 * revision and shared by every agent that selects it, so the two halves cannot
 * leak into each other's tool catalog or system prompt.
 */

import { createBoards, registerLeadTools } from './tools.js'
import { mountLeadGuard } from './guard.js'
import { mountLeadSection } from './lead.js'

/** Services this row needs before it can activate. */
export const inject = ['tools', 'subagents', 'systemPrompt']

/**
 * Resolve the row's configuration.
 *
 * @param {unknown} config - the Loader row config.
 * @returns {{ workerPreset: string, maxDepth: number, leadOnlySkills: unknown }} the resolved values.
 */
export function resolveConfig(config) {
	const raw = config !== null && typeof config === 'object' ? config : {}
	return {
		workerPreset:
			typeof raw.workerPreset === 'string' && raw.workerPreset !== '' ? raw.workerPreset : 'shader-worker',
		maxDepth: Number.isSafeInteger(raw.maxDepth) && raw.maxDepth >= 0 ? raw.maxDepth : 0,
		// Undefined keeps the built-in policy; an array replaces it, so a profile
		// can add a skill this package has not heard of.
		leadOnlySkills: Array.isArray(raw.leadOnlySkills) ? raw.leadOnlySkills : undefined,
		// The guard is on by default: the first real session showed that a rule
		// in a prompt loses to momentum, so the reminder is a mechanism.
		remindOnDirectEdit: raw.remindOnDirectEdit !== false,
	}
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
