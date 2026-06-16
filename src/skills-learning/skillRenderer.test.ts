import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { renderActiveSkills } from './skillRenderer.js'
import type { SkillCandidate } from './skillCandidateSchema.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function candidate(id: string, type: SkillCandidate['type'] = 'general'): SkillCandidate {
  return {
    schema_version: 2,
    id,
    namespace: 'computational-imaging',
    type,
    title: 'Check feedback one hypothesis at a time',
    trigger: 'A task passes schema validation but judge feedback reports poor quality.',
    domain_tags: ['general'],
    summary:
      'Use this skill when a computational imaging task produces valid outputs but the judge reports poor quality, and the next step should be a small diagnostic experiment rather than broad solver rewrites.',
    problem_signals: [
      'The submission has valid files and finite arrays, but quality metrics or judge feedback remain below threshold.',
      'The agent is tempted to tune multiple parameters without first isolating the failing assumption.',
    ],
    diagnostic_steps: [
      'Restate the feedback as one falsifiable diagnosis tied to a single artifact, axis convention, or metric.',
      'Inspect the smallest relevant output and public contract before changing algorithm internals.',
      'Run the narrowest local check after each change and record whether it supports the hypothesis.',
    ],
    math_physics_checks:
      type === 'domain'
        ? [
            'Verify that the forward-model convention, units, and transform domain match the public measurements.',
            'Check that the reconstruction update preserves the expected physical scale and array orientation.',
          ]
        : [],
    tool_decision_rules: [
      'Use file inspection and targeted local commands before launching expensive full task evaluations.',
    ],
    validation_checks: [
      'Confirm the generated output still matches the schema and expected shape after the targeted change.',
      'Compare the relevant local metric or artifact trend before consuming another judge round.',
    ],
    transfer_scope:
      'Applies to computational imaging debugging loops where visible contracts and judge feedback guide the next experiment.',
    guidance: [
      'Make one falsifiable diagnosis, inspect the smallest relevant artifact, then rerun locally.',
      'Keep a short record of the hypothesis and the check result before attempting a wider rewrite.',
    ],
    anti_patterns: [
      'Do not change multiple unrelated algorithm choices in one round.',
      'Do not skip local artifact checks when judge feedback names a concrete mismatch.',
    ],
    evidence_runs: ['run-1'],
    validation: {
      status: 'active',
      used_count: 0,
      success_delta: 0,
      regressions: 0,
    },
  }
}

describe('renderActiveSkills', () => {
  test('renders active candidates to skills/<id>/SKILL.md and metadata.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-render-'))
    roots.push(root)
    const activeSkillsDir = join(root, 'skills')

    await renderActiveSkills(activeSkillsDir, [candidate('ci-general-one')])

    const skillPath = join(activeSkillsDir, 'ci-general-one', 'SKILL.md')
    const metadataPath = join(activeSkillsDir, 'ci-general-one', 'metadata.json')
    const contractPath = join(activeSkillsDir, 'ci-general-one', 'contract.json')
    expect(existsSync(skillPath)).toBe(true)
    expect(existsSync(metadataPath)).toBe(true)
    expect(existsSync(contractPath)).toBe(true)
    const content = readFileSync(skillPath, 'utf8')
    expect(content).toContain('description:')
    expect(content).toContain('when_to_use:')
    expect(content).toContain('Machine-readable sidecar: `contract.json`')
    expect(content).toContain('## Problem Signals')
    expect(content).toContain('## Diagnostic Steps')
    expect(content).toContain('## Validation Checks')
    expect(content).toContain('## Application Contract')
    expect(content).toContain('### Use This First')
    expect(content).toContain('### Required Cheap Probes')
    expect(content).toContain('### Stop Conditions')
    expect(content).toContain('### Long-run Budget Rules')
    expect(content).toContain('### Validation Before Submission')
    expect(content).toContain('### Anti-patterns')
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
    expect(contract).toMatchObject({
      contract_version: 1,
      schema_version: 1,
      skill_id: 'ci-general-one',
      namespace: 'computational-imaging',
      type: 'general',
      required_cheap_probes: [
        'Restate the feedback as one falsifiable diagnosis tied to a single artifact, axis convention, or metric.',
        'Inspect the smallest relevant output and public contract before changing algorithm internals.',
        'Run the narrowest local check after each change and record whether it supports the hypothesis.',
      ],
      blocking_stop_conditions: [
        'Confirm the generated output still matches the schema and expected shape after the targeted change.',
        'Compare the relevant local metric or artifact trend before consuming another judge round.',
      ],
      long_run_budget_rules: [
        'Use file inspection and targeted local commands before launching expensive full task evaluations.',
      ],
      validation_before_submit: [
        'Confirm the generated output still matches the schema and expected shape after the targeted change.',
        'Compare the relevant local metric or artifact trend before consuming another judge round.',
      ],
      anti_patterns: [
        'Do not change multiple unrelated algorithm choices in one round.',
        'Do not skip local artifact checks when judge feedback names a concrete mismatch.',
      ],
    })
    expect(contract.evidence_runs).toBeUndefined()
  })

  test('derives a contract.json sidecar from legacy candidates with safe fallbacks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-render-contract-fallback-'))
    roots.push(root)
    const legacy = candidate('ci-legacy-one') as Partial<SkillCandidate> as SkillCandidate
    delete (legacy as Partial<SkillCandidate>).schema_version
    delete (legacy as Partial<SkillCandidate>).problem_signals
    delete (legacy as Partial<SkillCandidate>).diagnostic_steps
    delete (legacy as Partial<SkillCandidate>).tool_decision_rules
    delete (legacy as Partial<SkillCandidate>).validation_checks

    await renderActiveSkills(join(root, 'skills'), [legacy])

    const contract = JSON.parse(readFileSync(join(root, 'skills', 'ci-legacy-one', 'contract.json'), 'utf8'))
    expect(contract.required_cheap_probes).toEqual([
      'Run the smallest public-data check that can falsify the next solver assumption.',
    ])
    expect(contract.blocking_stop_conditions).toEqual([
      'Stop or pivot when the cheap probe, schema check, or local metric does not support the planned long run.',
    ])
    expect(contract.long_run_budget_rules).toEqual([
      'Use bounded commands with observable logs and do not repeat a long run without new evidence.',
    ])
    expect(contract.validation_before_submit).toEqual([
      'Validate output shape, dtype, finite values, and the relevant local metric before finalizing.',
    ])
    expect(contract.use_first).toEqual([
      'A task passes schema validation but judge feedback reports poor quality.',
    ])
  })

  test('derives domain contract checks from math and physics checks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-render-domain-contract-'))
    roots.push(root)

    await renderActiveSkills(join(root, 'skills'), [candidate('ci-domain-one', 'domain')])

    const contract = JSON.parse(readFileSync(join(root, 'skills', 'ci-domain-one', 'contract.json'), 'utf8'))
    expect(contract.domain_checks).toEqual([
      'Verify that the forward-model convention, units, and transform domain match the public measurements.',
      'Check that the reconstruction update preserves the expected physical scale and array orientation.',
    ])
  })

  test('rejects domain skills that contain code blocks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-render-domain-'))
    roots.push(root)
    const unsafe = candidate('ci-domain-unsafe', 'domain')
    unsafe.guidance = ['```python\nprint("no")\n```']

    await expect(renderActiveSkills(join(root, 'skills'), [unsafe])).rejects.toThrow('code block')
  })

  test('cleans obsolete rendered skill directories without deleting non-rendered files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-render-clean-'))
    roots.push(root)
    const activeSkillsDir = join(root, 'skills')
    mkdirSync(join(activeSkillsDir, 'obsolete-skill'), { recursive: true })
    writeFileSync(join(activeSkillsDir, 'obsolete-skill', 'metadata.json'), '{"managed_by":"skill-learning"}', 'utf8')
    mkdirSync(join(activeSkillsDir, 'manual-skill'), { recursive: true })
    writeFileSync(join(activeSkillsDir, 'manual-skill', 'SKILL.md'), '# manual', 'utf8')

    await renderActiveSkills(activeSkillsDir, [candidate('ci-general-one')], { cleanObsolete: true })

    expect(existsSync(join(activeSkillsDir, 'obsolete-skill'))).toBe(false)
    expect(existsSync(join(activeSkillsDir, 'manual-skill', 'SKILL.md'))).toBe(true)
  })

  test('rejects active skill rendering into output/skill-learning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-render-path-'))
    roots.push(root)

    await expect(renderActiveSkills(join(root, 'output', 'skill-learning'), [candidate('ci-general-one')])).rejects.toThrow(
      'active skills',
    )
  })
})
