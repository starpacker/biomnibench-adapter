import { mkdir, readFile, writeFile } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import type { SkillCandidate } from './skillCandidateSchema.js'

export type SkillPool = {
  version: 1
  skills: Record<string, SkillCandidate>
}

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(baseDir), resolve(candidatePath))
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function assertLearningWorkDir(workDir: string): void {
  const normalized = resolve(workDir).replace(/\\/g, '/')
  const allowed = /\/output\/skill-learning(?:-[A-Za-z0-9._-]+)?$/.test(normalized)
  if (!allowed) {
    throw new Error('skill pool workDir must be output/skill-learning or output/skill-learning-*')
  }
}

function poolPath(workDir: string): string {
  assertLearningWorkDir(workDir)
  const path = resolve(workDir, 'pool.json')
  if (!isWithinDirectory(workDir, path)) throw new Error('pool path escapes output/skill-learning')
  return path
}

export async function loadSkillPool(workDir: string): Promise<SkillPool> {
  try {
    const parsed = JSON.parse(await readFile(poolPath(workDir), 'utf8')) as SkillPool
    return {
      version: 1,
      skills: parsed.skills ?? {},
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { version: 1, skills: {} }
    }
    throw error
  }
}

export async function writeSkillPool(workDir: string, pool: SkillPool): Promise<void> {
  const path = poolPath(workDir)
  await mkdir(resolve(workDir), { recursive: true })
  await writeFile(path, `${JSON.stringify(pool, null, 2)}\n`, 'utf8')
}

export async function addCandidateToPool(pool: SkillPool, candidate: SkillCandidate): Promise<SkillPool> {
  return {
    ...pool,
    skills: {
      ...pool.skills,
      [candidate.id]: candidate,
    },
  }
}

export async function updateSkillStatus(
  workDir: string,
  skillId: string,
  status: SkillCandidate['validation']['status'],
): Promise<SkillPool> {
  const pool = await loadSkillPool(workDir)
  const existing = pool.skills[skillId]
  if (!existing) throw new Error(`Unknown skill in pool: ${skillId}`)
  const updated = {
    ...pool,
    skills: {
      ...pool.skills,
      [skillId]: {
        ...existing,
        validation: {
          ...existing.validation,
          status,
        },
      },
    },
  }
  await writeSkillPool(workDir, updated)
  return updated
}

function prunePriority(skill: SkillCandidate): number {
  if (skill.validation.status === 'candidate' && skill.validation.used_count === 0) return 0
  if (skill.validation.status === 'deprecated') return 1
  if (skill.validation.status === 'quarantine') return 2
  if (skill.validation.status === 'candidate') return 3
  return 4
}

export function pruneSkillPool(pool: SkillPool, maxPoolSize: number): SkillPool {
  const entries = Object.entries(pool.skills)
  if (entries.length <= maxPoolSize) return pool

  const keep = entries
    .sort(([, a], [, b]) => {
      const priority = prunePriority(b) - prunePriority(a)
      if (priority !== 0) return priority
      return b.validation.success_delta - a.validation.success_delta
    })
    .slice(0, maxPoolSize)

  return {
    ...pool,
    skills: Object.fromEntries(keep),
  }
}
