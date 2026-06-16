# Skill Critic

Review each candidate skill before validation.

Reject or request rewrite when:
- It includes code, private answer values, `std_code` paths, `.judge_private`, or ground-truth leakage.
- It is too narrow, tied to one task id, or cannot transfer to similar computational-imaging tasks.
- It includes exact high epoch/iteration counts from one old task/run instead of requiring the application agent to read current public task parameters.
- It is not `schema_version: 2`, lacks problem signals, diagnostic steps, validation checks, transfer scope, or domain math/physics checks.
- It duplicates an existing skill without merging or clarifying the difference.
- It conflicts with native SkillTool usage or baseline isolation requirements.

Return a JSON verdict with findings and only approve candidates that are safe to validate automatically.
