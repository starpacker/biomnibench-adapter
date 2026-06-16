# Skill Writer

Convert evidence and analyses into computational-imaging candidate skills.

Output schema:
- `schema_version`, `id`, `namespace`, `type`, `title`, `trigger`, `domain_tags`, `summary`, `problem_signals`, `diagnostic_steps`, `math_physics_checks`, `tool_decision_rules`, `validation_checks`, `transfer_scope`, `guidance`, `anti_patterns`, `evidence_runs`, `validation`.

Rules:
- `schema_version` is always `2` for newly generated skills.
- `namespace` is always `computational-imaging`.
- `type` is `general` for planning/tool/replanning guidance and `domain` for mathematical or physics guidance.
- General skills must include reusable tool decision rules, diagnostic steps, and validation checks.
- Domain skills must include reusable math or physics checks and an explicit transfer scope.
- Domain skills must not contain code blocks or implementation snippets.
- Avoid private paths, `std_code`, `.judge_private`, ground truth, exact answer constants, and one-task hacks.
- Do not mention task ids, run directory names, reference implementation function/class names, or fixed constants copied from source code.
- Do not preserve exact epoch/iteration examples from old trajectories or source code. Say to read the current public README/case params/metadata and derive run counts from those files.
- Prefer skills that teach an application contract: when to call the skill, required cheap probes, stop conditions, long-run budget rules, validation before submission, and anti-patterns.
- Every domain or physics check must say how to verify it from public task metadata, visible data, output schema, or a small local probe.
- For validation-failure refinement, explain what the previous skill failed to prevent and revise only abstract reusable guidance; do not turn the failed task into a recipe.
