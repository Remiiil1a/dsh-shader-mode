---
name: shader-mode-report
description: "How a shader-mode worker reports back: what the lead sees, what counts as evidence, how to state partial results honestly, and what to do when the task cannot be done as written. Use at the end of every dispatched task, before writing the final message."
whenToUse: "Load when you are about to write the final message of a dispatched task."
---

# Reporting to the lead

Your final message is the whole of what the lead sees. There is no follow-up
question, no clarifying chat, no "let me know if you want more detail". If the
report does not carry a fact, that fact is lost.

## The shape

```
T3 — <what the task was, in one line>

Did:
  - <action>, <file or artifact>
  - <action>, <file or artifact>

Evidence:
  - `<command>` → exit 0, <the numbers that matter>
  - `<command>` → exit 1, <what failed and why>

Acceptance:
  - <AC-1>: met — <the reading that shows it>
  - <AC-2>: not met — <what is missing>

Needs a decision:
  - <the thing the lead must choose, and the options>
```

Drop a section when it is genuinely empty. Do not drop `Evidence` or
`Acceptance`; those are the two the lead reads.

## Evidence

Evidence is a command you ran and its result. Not a description of what the
command would do, not a recollection of what it did last time, not a conclusion
you drew from reading the code.

- **Quote the command.** The lead may want to run it.
- **Quote the exit status.** "It passed" is not a status.
- **Quote the number that decides the question.** A test suite that prints
  `0 failed` is evidence; a test suite that prints nothing and exits 0 is weaker
  evidence; a test suite you did not run is not evidence.
- **If you read the code instead of running it, say so.** "Verified by reading
  `translucent.glsl:412`; not executed" is honest and useful. Presenting a read
  as a run is the failure this whole protocol exists to prevent.

## Partial results

A task that is 70% done and reported honestly is worth more than a task claimed
complete. Say which acceptance points are met, which are not, and what would be
needed for the rest.

Never do these:

- **Report an intention as a result.** "I would then run the chain" is not a
  result.
- **Report a plan as a finding.** "The fix should resolve the band" is a
  prediction, not a measurement.
- **Round a partial pass up.** "Mostly passing" is not a state. It is either
  passing or it is not, and if it is not, say which part.
- **Bury the failure.** Put the thing that did not work at the top of the
  evidence, not in a footnote.

## When the task cannot be done as written

Stop and report. Do not substitute a different task that you can do.

Say:

1. What you tried.
2. The specific thing that blocks it — a missing file, a contradiction in the
   brief, an acceptance check that cannot be measured, a dependency that is not
   there.
3. The options you can see, with their costs.

The lead re-plans. That is the lead's job, and taking it is how a worker turns
one blocked task into two wrong ones.

## When you disagree with the brief

Say so in the report, once, with the reason. Then do the task as written unless
it is actually impossible.

A worker that silently does something else because it thought of a better way
has broken the lead's ability to judge the result: the acceptance check no
longer matches the work. A worker that does the task and notes the concern gives
the lead both the result and the information.

## Length

As long as the evidence needs, and no longer. A three-line report with a command
and its output beats a page of prose. The lead is reading several of these; the
one that is scannable gets acted on.
