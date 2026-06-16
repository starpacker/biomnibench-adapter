import { validateSkillCandidate, type SkillCandidate } from './skillCandidateSchema.js'

export type SkillCriticOptions = {
  existing?: SkillCandidate[]
  taskIds?: string[]
  forbiddenTerms?: string[]
  mode?: 'new' | 'revision'
}

export type SkillCriticResult = {
  approved: boolean
  findings: string[]
}

function candidateText(candidate: SkillCandidate, options: { includeIdentity?: boolean } = {}): string {
  const includeIdentity = options.includeIdentity ?? true
  const identity = includeIdentity ? [candidate.id, candidate.title] : []
  return [
    ...identity,
    candidate.trigger,
    candidate.summary,
    candidate.transfer_scope,
    ...candidate.domain_tags,
    ...(candidate.problem_signals ?? []),
    ...(candidate.diagnostic_steps ?? []),
    ...(candidate.math_physics_checks ?? []),
    ...(candidate.tool_decision_rules ?? []),
    ...(candidate.validation_checks ?? []),
    ...candidate.guidance,
    ...candidate.anti_patterns,
  ].filter((value): value is string => typeof value === 'string').join('\n')
}

function joinedLength(items: string[] | undefined): number {
  return (items ?? []).join(' ').trim().length
}

function taskIdMentioned(text: string, taskIds: string[]): boolean {
  const lower = text.toLowerCase()
  return taskIds.some(taskId => taskId.trim() !== '' && lower.includes(taskId.toLowerCase()))
}

function normalizedForbiddenTerms(terms: string[] | undefined): string[] {
  return [...new Set((terms ?? []).map(term => term.trim()).filter(term => term.length >= 4))]
    .sort((a, b) => b.length - a.length)
}

function mentionsReferenceImplementationAccess(text: string): boolean {
  return /\b(?:read|inspect|compare|match|copy|diff)[^\n.]{0,80}\breference\s+(?:implementations?|source|code|files?)\b/i
    .test(text)
    || /\breference\s+(?:implementations?|code|source\s+code|source\s+files?)\b/i.test(text)
    || /\bmatch\s+(?:its\s+)?exact\s+conventions\b/i.test(text)
}

function mentionsStaleHighIterationConstant(text: string): boolean {
  const highNumber = String.raw`(?:[5-9]\d{2}|[1-9]\d{3,})`
  const iterationUnit = String.raw`(?:epochs?|iterations?|iters?)`
  const explicitCount = new RegExp(String.raw`\b${highNumber}\s*\+?\s*${iterationUnit}\b`, 'i')
  const namedEpochParameter = new RegExp(String.raw`\bn_epochs?\b[^\n]{0,80}\b${highNumber}\b`, 'i')
  const countAssignment = new RegExp(
    String.raw`\b${iterationUnit}\b\s*(?:=|:|\(|\[|,|count|counts|budget|planned|plan|for|of|e\.g\.)[^\n]{0,30}\b${highNumber}\b`,
    'i',
  )
  return explicitCount.test(text) || namedEpochParameter.test(text) || countAssignment.test(text)
}

export function critiqueSkillCandidate(
  candidate: SkillCandidate,
  options: SkillCriticOptions = {},
): SkillCriticResult {
  const findings: string[] = []
  const validation = validateSkillCandidate(candidate)
  findings.push(...validation.errors)

  const title = candidate.title.toLowerCase()
  const id = candidate.id.toLowerCase()
  for (const existing of options.existing ?? []) {
    if (existing.id.toLowerCase() === id || existing.title.toLowerCase() === title) {
      findings.push(`duplicate candidate overlaps existing skill: ${existing.id}`)
    }
  }

  const taskIds = options.taskIds ?? []
  const text = candidateText(candidate, { includeIdentity: options.mode !== 'revision' })
  if (taskIdMentioned(text, taskIds)) {
    findings.push('candidate is task-specific; rewrite as transferable guidance before activation')
  }
  const lowerText = text.toLowerCase()
  for (const term of normalizedForbiddenTerms(options.forbiddenTerms)) {
    if (lowerText.includes(term.toLowerCase())) {
      findings.push(`candidate contains forbidden proof/source term: ${term}`)
    }
  }
  if (mentionsReferenceImplementationAccess(text)) {
    findings.push('candidate tells application agents to read or match a reference implementation')
  }
  if (mentionsStaleHighIterationConstant(text)) {
    findings.push('candidate contains a stale exact epoch or iteration constant; derive long-run counts from current public task parameters instead')
  }
  if (candidate.schema_version !== 2) {
    findings.push('new skill candidates must use schema_version 2')
  }
  if (!candidate.summary || candidate.summary.length < 80) {
    findings.push('candidate summary is too thin to be reusable')
  }
  if ((candidate.problem_signals ?? []).length < 2 || joinedLength(candidate.problem_signals) < 80) {
    findings.push('candidate needs at least two concrete reusable problem signals')
  }
  if ((candidate.diagnostic_steps ?? []).length < 3 || joinedLength(candidate.diagnostic_steps) < 140) {
    findings.push('candidate needs at least three substantial diagnostic steps')
  }
  if ((candidate.validation_checks ?? []).length < 2 || joinedLength(candidate.validation_checks) < 80) {
    findings.push('candidate needs at least two validation checks')
  }
  if ((candidate.tool_decision_rules ?? []).length < 1 || joinedLength(candidate.tool_decision_rules) < 50) {
    findings.push('candidate needs reusable tool decision rules')
  }
  if (!candidate.transfer_scope || candidate.transfer_scope.length < 60) {
    findings.push('candidate transfer_scope is too narrow or too thin')
  }
  if (
    candidate.type === 'domain' &&
    ((candidate.math_physics_checks ?? []).length < 2 || joinedLength(candidate.math_physics_checks) < 120)
  ) {
    findings.push('domain candidate needs at least two substantial math_physics_checks')
  }
  if (candidate.guidance.length < 2 || candidate.guidance.join(' ').length < 120) {
    findings.push('candidate guidance is too thin to be reusable')
  }
  if (candidate.anti_patterns.length < 2 || candidate.anti_patterns.join(' ').length < 80) {
    findings.push('candidate anti_patterns are too thin to prevent misuse')
  }
  if (candidate.validation.regressions > 0) {
    findings.push('candidate has recorded regressions')
  }

  return {
    approved: findings.length === 0,
    findings,
  }
}
