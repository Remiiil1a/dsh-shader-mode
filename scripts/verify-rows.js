/**
 * Verify the three plugin rows the composition declares actually resolve.
 *
 * The patch names three modules — `dsh-shader-mode`, `dsh-shader-mode/worker`,
 * and `dsh-shader-mode/skills`. A typo in any of them fails at activation, not
 * at install, so this check imports each one through the package's own export
 * map and asserts the shape the Loader needs.
 *
 * Run with `node scripts/verify-rows.js`.
 */

import assert from 'node:assert/strict'

/** Import one subpath through the package's export map, as the Loader does. */
async function load(specifier) {
	return import(specifier)
}

const lead = await load('dsh-shader-mode')
assert.equal(typeof lead.apply, 'function', 'lead row must export apply')
assert.ok(Array.isArray(lead.inject), 'lead row must declare inject')
assert.deepEqual(lead.inject, ['tools', 'subagents'])
assert.deepEqual(lead.resolveConfig({}), {
	workerPreset: 'shader-worker',
	maxDepth: 0,
	leadOnlySkills: undefined,
})
assert.deepEqual(lead.resolveConfig({ workerPreset: 'custom', maxDepth: 2 }), {
	workerPreset: 'custom',
	maxDepth: 2,
	leadOnlySkills: undefined,
})
assert.deepEqual(lead.resolveConfig({ workerPreset: '', maxDepth: -1 }), {
	workerPreset: 'shader-worker',
	maxDepth: 0,
	leadOnlySkills: undefined,
})
// A configured policy replaces the built-in one; a non-array is ignored.
assert.deepEqual(lead.resolveConfig({ leadOnlySkills: ['a'] }).leadOnlySkills, ['a'])
assert.equal(lead.resolveConfig({ leadOnlySkills: 'nope' }).leadOnlySkills, undefined)
console.log('ok  dsh-shader-mode          apply + inject + resolveConfig')

const worker = await load('dsh-shader-mode/worker')
assert.equal(typeof worker.apply, 'function', 'worker row must export apply')
assert.equal(typeof worker.mountWorkerSection, 'function', 'worker row must export mountWorkerSection')
assert.equal(typeof worker.workerSectionText, 'function')
assert.deepEqual(worker.inject, ['systemPrompt'], 'worker row must declare the service it uses')
assert.deepEqual(worker.resolveConfig({}), { leadName: 'the lead' })
assert.deepEqual(worker.resolveConfig({ leadName: 'the dispatcher' }), { leadName: 'the dispatcher' })
const text = worker.workerSectionText({ leadName: 'the lead' })
assert.ok(text.includes('no user'), 'worker section must say the worker has no user')
assert.ok(text.includes('final message is a report'), 'worker section must say the final message is a report')
console.log('ok  dsh-shader-mode/worker   apply + inject + section text')

const skills = await load('dsh-shader-mode/skills')
assert.equal(typeof skills.apply, 'function', 'skills row must export apply')
assert.equal(typeof skills.mountSkillProvider, 'function', 'skills row must export mountSkillProvider')
assert.equal(typeof skills.createSkillProvider, 'function')
assert.deepEqual(skills.inject, ['skills'], 'skills row must declare the service it uses')
const provider = skills.createSkillProvider()
const listed = await provider.list()
assert.equal(listed.complete, true)
assert.equal(listed.candidates.length, 3, 'the package ships three skills')
for (const candidate of listed.candidates) {
	const full = await provider.get(candidate)
	assert.ok(full.content.length > 500, `${candidate.name} body is too short to be a real skill`)
}
console.log(`ok  dsh-shader-mode/skills   ${listed.candidates.length} skills: ${listed.candidates.map((c) => c.name).join(', ')}`)

console.log('\nall three composition rows resolve')
