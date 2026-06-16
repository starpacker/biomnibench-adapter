import type { SkillCandidate } from './skillCandidateSchema.js'

export type SkillRetrievalTask = {
  taskId: string
  readme: string
  tags?: string[]
}

export type SkillRetrievalOptions = {
  maxSkills: number
}

export type SkillRetrievalResult = {
  skill: SkillCandidate
  score: number
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9_+-]+/).filter(token => token.length >= 3))
}

export function retrieveSkillsForTask(
  task: SkillRetrievalTask,
  skills: SkillCandidate[],
  options: SkillRetrievalOptions,
): SkillRetrievalResult[] {
  const taskTokens = tokenize([task.taskId, task.readme, ...(task.tags ?? [])].join(' '))
  const taskTags = new Set((task.tags ?? []).map(tag => tag.toLowerCase()))

  return skills
    .filter(skill => skill.validation.status === 'active' && skill.validation.regressions === 0)
    .map(skill => {
      const skillTokens = tokenize([
        skill.id,
        skill.title,
        skill.trigger,
        ...skill.domain_tags,
        ...skill.guidance,
      ].join(' '))
      let score = skill.validation.success_delta
      for (const tag of skill.domain_tags) {
        if (taskTags.has(tag.toLowerCase())) score += 6
      }
      for (const token of skillTokens) {
        if (taskTokens.has(token)) score += 1
      }
      if (skill.type === 'general') score += 0.5
      if (skill.type === 'domain' && !skill.domain_tags.some(tag => taskTags.has(tag.toLowerCase()))) {
        score -= 20
      }
      return { skill, score }
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, options.maxSkills)
}
