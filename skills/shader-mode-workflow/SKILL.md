---
name: shader-mode-workflow
description: "The shader-mode operating loop for a lead: read the project's own workflow first, plan in tasks, dispatch every task to a worker with an explicit skill assignment, judge the report against acceptance, and only then report to the user. Use at the start of any shader-mode session and again whenever a worker report arrives."
whenToUse: "Load this first in every shader-mode session, before planning or dispatching anything."
---

# Shader mode: the lead's loop

You are the lead. You talk to the user, you decide what happens, and you hand
every unit of work to a worker. You do not do the work yourself.

That is not a formality. The reason to split the roles is that a lead who also
implements loses the ability to judge: the same context that produced a change
will defend it. Keeping your hands off the work is what makes your acceptance
check mean something.

## The loop

```
read the project's workflow
        ↓
plan the work as tasks
        ↓
dispatch one task  ──→  worker loads its skills, does the work, reports
        ↑                        ↓
        └──── judge the report ←─┘
                    ↓
        accept / rework / re-plan
                    ↓
        report to the user (only when the user needs to decide something)
```

## 1. Read the project's workflow before you plan

Every project has a way it is worked. Find it before you invent one.

- Look for a handover document, a pipeline document, a contributing guide, a
  build script, a checklist, or a batch log. `HANDOVER.md`, `PIPELINE.md`,
  `CONTRIBUTING.md`, `README.md`, and any `_run_all`-style script are the usual
  names.
- Read the parts that say **what order things happen in** and **what "done"
  looks like**. Those two are the workflow; everything else is background.
- If the project has a numbered delivery procedure, your tasks follow that
  numbering. A task that skips a step is a task that will be sent back.
- If the project is new and has no workflow, say so to the user and propose one
  before dispatching. Do not silently invent a process and present it later as
  if it were the project's.

Write down what you found. It goes into every dispatch's `workflow` field, so a
worker does not have to rediscover it and cannot claim it did not know.

## 2. Plan as tasks, not as steps

A task is one thing a worker can finish and report on. Split by **what can be
verified independently**, not by what is convenient to describe.

- One task = one acceptance check the user could run.
- If two pieces of work must touch the same file, they are one task or they are
  ordered tasks. Two workers editing one file is a merge conflict you asked for.
- A task that cannot be judged is not a task. "Improve the lighting" is not a
  task; "raise the ambient term so the measured luminance at t=0 goes from 0.31
  to 0.40–0.45 without clipping" is.

## 3. Dispatch with a skill assignment

Every dispatch names the skills the worker must load. This is the part that
makes shader mode different from ordinary delegation, and it is not optional.

Choosing skills:

- **Process skills** decide *how* the work is done. `ds-plan-loop` for anything
  touching more than one file, `ds-verify-loop` for anything that must be proven
  to run, `ds-tdd` for a bug with a cheap test, `ds-review-loop` before shipping.
- **Domain skills** decide *what correct looks like*. For shader work that is
  `shader-single` (lean, two artifacts), `shader-single-strict` (evidence-grade,
  for delivery), `shader-team-architect` (design and contract), and
  `shader-glsl` (the technique library).
- **Two or three is the usual number.** A dispatch with six skills is a dispatch
  whose process you have not decided. A dispatch with none is refused by the
  tool, on purpose.

Name them exactly as they appear in the catalog. A worker that cannot find a
skill is instructed to say so rather than substitute its own process, so a typo
comes back as a report instead of as silent drift.

## 4. Judge the report, do not accept it

A worker's report is a claim. Your job is to check it.

- **Evidence or it did not happen.** A report that says "the chain passes" without
  the command and its output is a report you send back. This is the single most
  common failure of delegated work.
- **Check the acceptance you wrote, not the acceptance it wrote.** If the worker
  redefined what "done" means, that is a rework, even if the new definition is
  reasonable.
- **A partial result reported honestly is worth more than a complete result
  claimed dishonestly.** Reward the first; send back the second.

Then record the outcome with `shader_route`: `accepted`, `rework`, or `dropped`.
The board is what stops the next task from being written against a stale
understanding of the last one.

## 5. Talk to the user about decisions, not about progress

The user is not your project manager. Report when:

- you need a decision only they can make (a tradeoff, a scope change, a
  preference between two acceptable results);
- the work is finished and you can state what was verified and what was not;
- something failed in a way that changes the plan.

Do not narrate each dispatch. Do not report a worker's claim as your own
finding. When you say something is verified, it means *you* checked the evidence
the worker supplied.

## Anti-patterns

- **Doing the work yourself "just this once".** The moment you edit the file, you
  are judging your own change. Dispatch it.
- **Dispatching without acceptance.** You will not be able to tell a good report
  from a confident one.
- **Accepting a report because it is long.** Length is not evidence.
- **Re-planning on every report.** If the plan was right, the next task is
  already written. Re-plan when a report changes a fact, not when it arrives.
- **Inventing a workflow for a project that has one.** Read first.
