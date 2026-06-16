import { describe, expect, test } from 'bun:test'
import { validateSkillCandidate } from './skillCandidateSchema.js'

const baseCandidate = {
  schema_version: 2,
  id: 'ci-domain-ptychography-normalization',
  namespace: 'computational-imaging',
  type: 'domain',
  title: 'Check ptychography normalization before optimizer tuning',
  trigger: 'Ptychography reconstructions with valid output format but poor metrics.',
  domain_tags: ['ptychography', 'wave-optics'],
  summary:
    'Use this skill when a computational imaging reconstruction has valid output files but poor quality metrics, especially when geometry, normalization, or numerical model conventions may be more important than optimizer iteration count.',
  problem_signals: [
    'The submission has the expected files, array shapes, and finite values, but reconstruction metrics remain below threshold.',
    'Increasing iterations or changing step sizes produces little improvement, suggesting a model convention or normalization issue.',
  ],
  diagnostic_steps: [
    'Inspect the public task metadata and output contract before tuning the optimizer so that shape, axis, and unit assumptions are explicit.',
    'Check scan geometry, overlap, Fourier amplitude normalization, and probe/object scale ambiguity before increasing iterations.',
    'Make one falsifiable correction at a time and rerun the smallest validation or metric probe before a full task attempt.',
  ],
  math_physics_checks: [
    'Verify that Fourier amplitude constraints are applied in the intended domain and that phase/object scale ambiguity is handled consistently.',
    'Confirm that scan position units, overlap, and probe support are mutually consistent before interpreting optimizer convergence.',
  ],
  tool_decision_rules: [
    'Use file inspection and small array probes before long reconstruction runs when the failure appears to be geometric or normalization-related.',
  ],
  validation_checks: [
    'Compare intermediate amplitude ranges and output array conventions against the public contract before finalizing.',
    'Rerun the smallest available metric or judge probe after each conceptual correction to avoid conflating multiple fixes.',
  ],
  transfer_scope:
    'Applies to phase retrieval and ptychography-like inverse problems where public measurements define the model but hidden targets are unavailable.',
  guidance: [
    'Check scan geometry, overlap, Fourier amplitude normalization, and probe/object scale ambiguity before increasing iterations.',
    'Prefer correcting the physical forward-model assumptions before tuning optimizer hyperparameters.',
  ],
  anti_patterns: [
    'Do not tune only iteration count before checking geometry and normalization.',
    'Do not copy standard implementation code or task-specific constants into the learned skill.',
  ],
  evidence_runs: ['run-1'],
  validation: {
    status: 'candidate',
    used_count: 0,
    success_delta: 0,
    regressions: 0,
  },
}

describe('validateSkillCandidate', () => {
  test('accepts a valid computational-imaging domain candidate', () => {
    const result = validateSkillCandidate(baseCandidate)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  test('keeps legacy v1 candidates valid for existing pools', () => {
    const result = validateSkillCandidate({
      id: 'ci-general-legacy-feedback-loop',
      namespace: 'computational-imaging',
      type: 'general',
      title: 'Use feedback as one hypothesis',
      trigger: 'Judge feedback identifies a concrete mismatch.',
      domain_tags: ['general'],
      guidance: ['Convert feedback into one falsifiable hypothesis and validate the smallest related artifact.'],
      anti_patterns: ['Do not change unrelated algorithms in the same round.'],
      evidence_runs: ['run-1'],
      validation: {
        status: 'candidate',
        used_count: 0,
        success_delta: 0,
        regressions: 0,
      },
    })

    expect(result.ok).toBe(true)
  })

  test('rejects incomplete v2 candidates that omit reusable quality fields', () => {
    const result = validateSkillCandidate({
      ...baseCandidate,
      diagnostic_steps: undefined,
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('diagnostic_steps')
  })

  test('rejects domain candidates that contain code blocks', () => {
    const result = validateSkillCandidate({
      ...baseCandidate,
      guidance: ['```python\nprint("hardcoded")\n```'],
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('code block')
  })

  test('rejects private answer, judge, and std_code leakage markers', () => {
    const result = validateSkillCandidate({
      ...baseCandidate,
      guidance: [
        'Copy the value from tasks/foo/std_code/solve.py and compare against ground_truth in .judge_private.',
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('std_code')
    expect(result.errors.join('\n')).toContain('ground_truth')
    expect(result.errors.join('\n')).toContain('.judge_private')
  })

  test('rejects high precision constants that look like private answer values', () => {
    const result = validateSkillCandidate({
      ...baseCandidate,
      guidance: ['Use the reconstruction scale 0.123456789 exactly for this task.'],
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('high precision')
  })

  test('rejects candidate ids that are not single path-safe slug names', () => {
    for (const id of ['../escape', 'ci/domain', 'ci_domain', 'Ci-Domain']) {
      const result = validateSkillCandidate({ ...baseCandidate, id })

      expect(result.ok).toBe(false)
      expect(result.errors.join('\n')).toContain('id must be a path-safe slug')
    }
  })
})
