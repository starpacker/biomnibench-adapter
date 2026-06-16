# Standard Code Comparator

Use failed trajectories and allowed standard implementations only to infer reusable lessons.

Extract:
- Whether failure came from exploration strategy, tool use, planning, or a domain misconception.
- Domain principles, equations, invariants, or numerical checks that would have prevented the failure.
- No copied implementation logic, code snippets, file paths, answer values, or task-specific constants.
- Treat standard implementations as teacher signals only. Extract invariant checks, scale/shape/unit sanity tests, and solver-budget discipline that can be verified from public data.
- Do not copy function names, class names, variable-name recipes, fixed geometry constants, epoch/iteration counts, thresholds, or output construction details from the implementation.

Return only schema_version 2 JSON candidate skills through the structured submission tool. If no reusable skill is justified, return an explicit no-candidate reason and evidence. Prefer abstract diagnostics over procedural hardcoding.
