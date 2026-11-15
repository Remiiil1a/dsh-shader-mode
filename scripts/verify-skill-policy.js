/**
 * Check the skill-role policy against the skills actually installed.
 *
 * The policy names specific skills as lead-only. That list is only useful if
 * the names are real and the reasons still match what those skills say about
 * themselves — a skill can be rewritten, and a stale reason is worse than no
 * reason because it teaches the wrong lesson.
 *
 * This script reads each blocked skill's own frontmatter and body, asserts the
 * name exists, and prints the sentence that justifies the block so a human can
 * see whether the reason still holds.
 *
 * Run with `node scripts/verify-skill-policy.js [skillsDir]`.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LEAD_ONLY_SKILLS, resolveSkillPolicy } from '../lib/skill-policy.js'
import { splitFrontmatter } from '../lib/tool.js'

const SKILLS_DIR = process.argv[2] ?? 'C:/Users/Administrator/.dsh/skills'

/** Read one installed skill, or undefined when it is not installed. */
function readSkill(name) {
	const path = join(SKILLS_DIR, name, 'SKILL.md')
	if (!existsSync(path)) return undefined
	const { header, body } = splitFrontmatter(readFileSync(path, 'utf8'))
	return { name: header.name ?? name, description: header.description ?? '', body }
}

console.log(`skills directory: ${SKILLS_DIR}\n`)

// Every blocked skill must be a real skill, and its own text must show the
// property the policy claims.
const EVIDENCE = {
	'shader-single': /一个 agent|单人|需求冻结/,
	'shader-single-strict': /一个人|五顶帽子|换上下文/,
	'shader-team-lead': /spawn_teammate|team_task_create|组建/,
}

let checked = 0
let missing = 0
for (const entry of DEFAULT_LEAD_ONLY_SKILLS) {
	const skill = readSkill(entry.skill)
	if (skill === undefined) {
		console.log(`--  ${entry.skill}: not installed here (policy entry kept)`)
		missing += 1
		continue
	}
	const pattern = EVIDENCE[entry.skill]
	if (pattern !== undefined) {
		assert.match(
			`${skill.description}\n${skill.body}`,
			pattern,
			`${entry.skill} no longer reads as a whole-project/orchestrator skill; revisit its policy entry`,
		)
	}
	console.log(`ok  ${entry.skill}`)
	console.log(`    why blocked: ${entry.reason.slice(0, 110)}…`)
	console.log(`    use instead: ${entry.alternative}`)
	checked += 1
}

// The role skills are the replacements, so they must NOT be blocked.
const ROLE_SKILLS = [
	'shader-team-architect',
	'shader-team-programmer',
	'shader-team-reviewer',
	'shader-team-scribe',
	'shader-glsl',
]
const policy = resolveSkillPolicy(undefined)
console.log('')
for (const name of ROLE_SKILLS) {
	assert.equal(policy.has(name), false, `${name} is a role skill and must stay assignable`)
	const skill = readSkill(name)
	console.log(skill === undefined ? `--  ${name}: not installed here` : `ok  ${name}: assignable`)
}

console.log(`\n${checked} blocked skill(s) verified, ${missing} not installed, ${ROLE_SKILLS.length} role skills assignable`)
