import { describe, expect, test } from 'bun:test'
import { critiqueSkillCandidate } from './skillCritic.js'
import type { SkillCandidate } from './skillCandidateSchema.js'

const candidate: SkillCandidate = {
  schema_version: 2,
  id: 'ci-general-judge-feedback-loop',
  namespace: 'computational-imaging',
  type: 'general',
  title: 'Use judge feedback to isolate the next experiment',
  trigger: 'A run fails after validation passes but judge feedback names a concrete mismatch.',
  domain_tags: ['general'],
  summary:
    'Use this skill when an agent receives concrete judge feedback after a valid submission and must convert that feedback into a small, testable next experiment rather than making broad unrelated changes.',
  problem_signals: [
    'The output format is valid, but judge feedback points to one or two concrete metric or artifact mismatches.',
    'The previous round changed several areas at once, making it unclear which decision affected the judge result.',
  ],
  diagnostic_steps: [
    'Restate the judge feedback as one falsifiable hypothesis tied to a single output artifact or metric.',
    'Inspect the smallest relevant public file, generated output, or local validation result before editing algorithm code.',
    'Apply one targeted change and rerun the narrowest available check before spending another full evaluation round.',
  ],
  math_physics_checks: [],
  tool_decision_rules: [
    'Use read/list tools to inspect the failing artifact and contract before running expensive full-task commands.',
  ],
  validation_checks: [
    'Record which hypothesis was tested and whether the smallest local check moved in the expected direction.',
    'Only proceed to full submission after the local artifact or metric check supports the targeted change.',
  ],
  transfer_scope:
    'Applies across computational imaging tasks where judge feedback is available but hidden targets are not visible.',
  guidance: [
    'Convert each judge issue into one small hypothesis, inspect the relevant output contract, and rerun only the smallest local check before another full attempt.',
    'Use the next round to validate the hypothesis rather than to rewrite unrelated parts of the solver.',
  ],
  anti_patterns: [
    'Do not change several unrelated algorithm choices after one judge failure.',
    'Do not ignore the exact artifact or metric named by judge feedback while tuning unrelated parameters.',
  ],
  evidence_runs: ['run-a'],
  validation: {
    status: 'candidate',
    used_count: 0,
    success_delta: 0,
    regressions: 0,
  },
}

describe('critiqueSkillCandidate', () => {
  test('approves a transferable non-duplicate candidate', () => {
    const result = critiqueSkillCandidate(candidate)

    expect(result.approved).toBe(true)
    expect(result.findings).toEqual([])
  })

  test('rejects duplicate candidates by id or title', () => {
    const result = critiqueSkillCandidate(candidate, {
      existing: [{ ...candidate, evidence_runs: ['older-run'] }],
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('duplicate')
  })

  test('rejects candidates tied to a single task id', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      trigger: 'Only use this for configured_train_task.',
    }, {
      taskIds: ['configured_train_task'],
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('task-specific')
  })

  test('allows revision identity to retain an existing task-derived id', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      id: 'configured-train-task-domain',
      title: 'configured-train-task-domain title',
    }, {
      mode: 'revision',
      taskIds: ['configured-train-task'],
    })

    expect(result.approved).toBe(true)
    expect(result.findings).toEqual([])
  })

  test('rejects revision content that still mentions a task id', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      id: 'configured-train-task-domain',
      title: 'configured-train-task-domain title',
      guidance: [
        'For configured-train-task, inspect the exact hidden setup before trying general checks.',
        'Use the next round to validate the hypothesis rather than to rewrite unrelated parts of the solver.',
      ],
    }, {
      mode: 'revision',
      taskIds: ['configured-train-task'],
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('task-specific')
  })

  test('rejects proof baseline run names and source-leak markers in reusable content', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      guidance: [
        'When debugging, inspect locked_failure_run_20260602 and compare against reference_outputs.',
        'Use the next round to validate the hypothesis rather than to rewrite unrelated parts of the solver.',
      ],
    }, {
      forbiddenTerms: ['locked_failure_run_20260602'],
    })

    expect(result.approved).toBe(false)
    expect(result.findings).toContain('candidate contains forbidden proof/source term: locked_failure_run_20260602')
    expect(result.findings).toContain('candidate must not contain forbidden marker: reference_outputs')
  })

  test('rejects application guidance that tells agents to read reference implementations', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      guidance: [
        'Before coding, read the reference implementation source code and match it exactly.',
        'Use the next round to validate the hypothesis rather than to rewrite unrelated parts of the solver.',
      ],
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('reference implementation')
  })

  test('rejects guidance that tells agents to match reference code conventions', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      guidance: [
        'When reference code is available, match its exact conventions for padding and output cropping.',
        'Use the next round to validate the hypothesis rather than to rewrite unrelated parts of the solver.',
      ],
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('reference implementation')
  })

  test('rejects plural reference implementation leakage', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      math_physics_checks: [
        'Sub-stepping must conserve source energy under the chosen discretization before any long run starts.',
        'Do not justify solver behavior by saying reference implementations typically use a specific source injection convention.',
      ],
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('reference implementation')
  })

  test('rejects stale high epoch constants in reusable guidance', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      guidance: [
        'Before a long optimization, read the public task metadata and derive the planned iteration count from it.',
        'Estimate runtime before running full n_epochs; running full n_epochs (e.g., 800) without a probe wastes compute.',
      ],
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('stale exact epoch or iteration constant')
  })

  test('allows non-epoch physical magnitudes near large numbers', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      guidance: [
        'Before a long optimization, read the public task metadata and derive the planned iteration count from it.',
        'Check whether a learning rate would cause 1000+ m/s parameter jumps before continuing optimization.',
      ],
    })

    expect(result.approved).toBe(true)
  })

  test('rejects thin or legacy candidates before pool insertion', () => {
    const result = critiqueSkillCandidate({
      ...candidate,
      schema_version: 1,
      summary: undefined,
      diagnostic_steps: undefined,
    })

    expect(result.approved).toBe(false)
    expect(result.findings.join('\n')).toContain('schema_version 2')
    expect(result.findings.join('\n')).toContain('summary')
  })
})
