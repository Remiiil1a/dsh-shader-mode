/**
 * Skill role policy: which skills a worker may be assigned.
 *
 * Shader mode's premise is that the lead names the skills a worker must load.
 * That only works if the named skills are written for *one role inside a
 * dispatch*. Several otherwise-excellent shader skills are not: they run a
 * whole project end-to-end for a single agent, assume a user to freeze
 * requirements with, or orchestrate their own team. Handing one of those to a
 * worker does not make the worker better — it makes the worker try to be the
 * lead, and the failure is quiet: the report comes back looking complete.
 *
 * So the policy is a small, configurable table of skills that must not be
 * dispatched, each with the reason and the role skill that replaces it. The
 * reason is the teaching content: a lead that hits this error learns which
 * skill to use instead, which is the whole point.
 *
 * The table is a guard, not a proof. A skill installed later that also runs a
 * solo flow will not be caught until someone adds it here — so the guidance in
 * `shader-mode-workflow` carries the general rule, and this table carries the
 * specific cases that are known today.
 */

/**
 * Skills that must not be assigned to a worker, with why and what to use
 * instead.
 *
 * `alternative` is a suggestion, not a requirement: some entries have no
 * replacement because the lead already does that job.
 */
export const DEFAULT_LEAD_ONLY_SKILLS = [
	{
		skill: 'shader-single',
		reason:
			'It runs the whole shader flow for one agent, starting with requirement freezing — which needs a user to answer. A worker has no user, so it would invent the requirements and report them as settled.',
		alternative: 'shader-team-programmer for implementation, shader-team-architect for design',
	},
	{
		skill: 'shader-single-strict',
		reason:
			'It is explicitly one agent wearing all five hats, including S0 (requirement freezing, which needs the user) and S3 (self-review, which is the same agent checking its own work). In shader mode that check is a separate worker, and that separation is the reason the mode exists.',
		alternative: 'shader-team-programmer for implementation, shader-team-reviewer for verification',
	},
	{
		skill: 'shader-team-lead',
		reason:
			'It is an orchestrator: it creates its own teammates with the Agent Teams tools and drives its own task board. A worker that loads it starts a second team underneath the lead, and the lead loses the shape of the work.',
		alternative: 'nothing — the lead is already the orchestrator; dispatch the role skills instead',
	},
]

/**
 * Normalize a configured policy into a lookup.
 *
 * Accepts either the default shape (objects with `skill`) or a plain array of
 * names, so a user can shorten the config to just the names.
 *
 * @param {unknown} configured - the row's `leadOnlySkills`, or undefined.
 * @returns {Map<string, { reason: string, alternative: string }>} the policy.
 */
export function resolveSkillPolicy(configured) {
	const policy = new Map()
	const entries = Array.isArray(configured) ? configured : DEFAULT_LEAD_ONLY_SKILLS
	for (const entry of entries) {
		if (typeof entry === 'string') {
			const known = DEFAULT_LEAD_ONLY_SKILLS.find((item) => item.skill === entry)
			policy.set(entry, {
				reason: known?.reason ?? 'This skill is configured as lead-only for this profile.',
				alternative: known?.alternative ?? 'pick a skill written for a single role',
			})
			continue
		}
		if (entry === null || typeof entry !== 'object') continue
		const skill = entry.skill
		if (typeof skill !== 'string' || skill === '') continue
		policy.set(skill, {
			reason: typeof entry.reason === 'string' && entry.reason !== '' ? entry.reason : 'This skill is lead-only.',
			alternative:
				typeof entry.alternative === 'string' && entry.alternative !== ''
					? entry.alternative
					: 'pick a skill written for a single role',
		})
	}
	return policy
}

/**
 * Check one skill assignment against the policy.
 *
 * @param {readonly string[]} skills - the skills the lead wants to assign.
 * @param {Map<string, { reason: string, alternative: string }>} policy - the resolved policy.
 * @returns {Array<{ skill: string, reason: string, alternative: string }>} the violations, empty when the assignment is allowed.
 */
export function checkSkillAssignment(skills, policy) {
	const violations = []
	for (const skill of skills) {
		const entry = policy.get(skill)
		if (entry === undefined) continue
		violations.push({ skill, reason: entry.reason, alternative: entry.alternative })
	}
	return violations
}

/**
 * Render the rejection a lead reads when it assigns a lead-only skill.
 *
 * @param {readonly { skill: string, reason: string, alternative: string }[]} violations - the violations.
 * @returns {string} the model-facing message.
 */
export function describeViolations(violations) {
	const lines = [
		'This dispatch assigns skills that are not written for a worker:',
		'',
	]
	for (const violation of violations) {
		lines.push(`- \`${violation.skill}\`: ${violation.reason}`)
		lines.push(`  Use instead: ${violation.alternative}`)
	}
	lines.push(
		'',
		'A worker executes one task and reports to you. A skill that runs a whole project, freezes requirements with a user, or orchestrates its own team is doing your job, and a worker that loads it will produce a report that looks complete and is not.',
		'',
		'If you genuinely need this skill on a worker — for example a self-contained effect where you have already frozen the requirements yourself — set `allowLeadOnly: true` and say in `context` what you froze and where it is written down.',
	)
	return lines.join('\n')
}
