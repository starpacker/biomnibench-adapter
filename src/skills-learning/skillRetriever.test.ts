import { describe, expect, test } from 'bun:test'
import { retrieveSkillsForTask } from './skillRetriever.js'
import type { SkillCandidate } from './skillCandidateSchema.js'

function skill(
  id: string,
  tags: string[],
  status: SkillCandidate['validation']['status'] = 'active',
  successDelta = 0,
): SkillCandidate {
  return {
    id,
    namespace: 'computational-imaging',
    type: tags.includes('general') ? 'general' : 'domain',
    title: `${id} title`,
    trigger: `${tags.join(' ')} trigger`,
    domain_tags: tags,
    guidance: ['Reusable guidance for the matching task context.'],
    anti_patterns: ['Avoid irrelevant broad changes.'],
    evidence_runs: ['run-1'],
    validation: {
      status,
      used_count: 1,
      success_delta: successDelta,
      regressions: 0,
    },
  }
}

describe('retrieveSkillsForTask', () => {
  test('returns active skills ranked by task text, tags, and validation score', () => {
    const results = retrieveSkillsForTask(
      {
        taskId: 'xray_ptychography_tike',
        readme: 'Recover object phase using ptychography and Fourier diffraction measurements.',
        tags: ['ptychography', 'wave-optics'],
      },
      [
        skill('ci-general-feedback', ['general'], 'active', 1),
        skill('ci-domain-ptychography', ['ptychography', 'wave-optics'], 'active', 3),
        skill('ci-domain-ct', ['ct', 'tomography'], 'active', 5),
        skill('ci-candidate-ignore', ['ptychography'], 'candidate', 10),
      ],
      { maxSkills: 2 },
    )

    expect(results.map(result => result.skill.id)).toEqual([
      'ci-domain-ptychography',
      'ci-general-feedback',
    ])
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })
})
