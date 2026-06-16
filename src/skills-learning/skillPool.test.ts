import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addCandidateToPool,
  loadSkillPool,
  pruneSkillPool,
  updateSkillStatus,
  writeSkillPool,
} from './skillPool.js'
import type { SkillCandidate } from './skillCandidateSchema.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function candidate(id: string, status: SkillCandidate['validation']['status'] = 'candidate'): SkillCandidate {
  return {
    id,
    namespace: 'computational-imaging',
    type: 'general',
    title: `Skill ${id}`,
    trigger: 'When judge feedback identifies a concrete mismatch.',
    domain_tags: ['general'],
    guidance: ['Turn the feedback into one hypothesis and validate the smallest related output contract.'],
    anti_patterns: ['Do not modify unrelated algorithms in the same round.'],
    evidence_runs: [`${id}-run`],
    validation: {
      status,
      used_count: 0,
      success_delta: 0,
      regressions: 0,
    },
  }
}

describe('skill pool', () => {
  test('writes and loads candidate, active, quarantine, and deprecated states under workDir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-pool-'))
    roots.push(root)
    const workDir = join(root, 'output', 'skill-learning')
    const pool = await addCandidateToPool(await loadSkillPool(workDir), candidate('ci-general-one'))
    await writeSkillPool(workDir, pool)
    await updateSkillStatus(workDir, 'ci-general-one', 'active')
    await updateSkillStatus(workDir, 'ci-general-one', 'quarantine')
    await updateSkillStatus(workDir, 'ci-general-one', 'deprecated')

    const reloaded = await loadSkillPool(workDir)

    expect(reloaded.skills['ci-general-one'].validation.status).toBe('deprecated')
    expect(existsSync(join(workDir, 'pool.json'))).toBe(true)
  })

  test('prunes never-used candidates before active or used skills when max pool size is exceeded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-pool-prune-'))
    roots.push(root)
    const pool = {
      version: 1,
      skills: {
        active: candidate('active', 'active'),
        used: { ...candidate('used'), validation: { ...candidate('used').validation, used_count: 2 } },
        old: candidate('old'),
      },
    }

    const pruned = pruneSkillPool(pool, 2)

    expect(Object.keys(pruned.skills).sort()).toEqual(['active', 'used'])
  })

  test('rejects pool writes outside output/skill-learning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-pool-path-'))
    roots.push(root)
    const workDir = join(root, 'output', 'skill-learning')
    mkdirSync(workDir, { recursive: true })

    await expect(writeSkillPool(join(root, 'skills'), { version: 1, skills: {} })).rejects.toThrow(
      'output/skill-learning',
    )
  })

  test('allows isolated proof workDirs under output/skill-learning-*', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-pool-proof-path-'))
    roots.push(root)
    const workDir = join(root, 'output', 'skill-learning-six-task-proof')

    await writeSkillPool(workDir, { version: 1, skills: {} })

    expect(existsSync(join(workDir, 'pool.json'))).toBe(true)
  })
})
