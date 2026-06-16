import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'
import { validateSkillCandidate, type SkillCandidate } from './skillCandidateSchema.js'

export type RenderActiveSkillsOptions = {
  cleanObsolete?: boolean
}

export type SkillApplicationContract = {
  contract_version: 1
  schema_version: 1
  skill_id: string
  title: string
  namespace: SkillCandidate['namespace']
  type: SkillCandidate['type']
  domain_tags: string[]
  use_first: string[]
  required_cheap_probes: string[]
  blocking_stop_conditions: string[]
  long_run_budget_rules: string[]
  validation_before_submit: string[]
  domain_checks: string[]
  anti_patterns: string[]
}

const CONTRACT_FALLBACKS = {
  requiredCheapProbes: 'Run the smallest public-data check that can falsify the next solver assumption.',
  blockingStopConditions:
    'Stop or pivot when the cheap probe, schema check, or local metric does not support the planned long run.',
  longRunBudgetRules: 'Use bounded commands with observable logs and do not repeat a long run without new evidence.',
  validationBeforeSubmit: 'Validate output shape, dtype, finite values, and the relevant local metric before finalizing.',
  antiPatterns: 'Do not skip the contract before long computation.',
} as const

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(baseDir), resolve(candidatePath))
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function assertActiveSkillsDir(activeSkillsDir: string): void {
  const normalized = resolve(activeSkillsDir).replace(/\\/g, '/')
  if (normalized.endsWith('/output/skill-learning')) {
    throw new Error('active skills must render to the project skills directory, not output/skill-learning')
  }
  if (!normalized.endsWith('/skills')) {
    throw new Error('active skills directory must be named skills')
  }
}

function skillDir(activeSkillsDir: string, skillId: string): string {
  const dir = resolve(activeSkillsDir, skillId)
  if (!isWithinDirectory(activeSkillsDir, dir)) throw new Error(`Unsafe skill id: ${skillId}`)
  return dir
}

function frontmatter(candidate: SkillCandidate): string {
  return [
    '---',
    `name: ${candidate.id}`,
    `description: ${candidate.title}`,
    `when_to_use: ${candidate.trigger}`,
    '---',
  ].join('\n')
}

function section(title: string, items: string[] | undefined): string[] {
  if (!items || items.length === 0) return []
  return ['', `## ${title}`, '', ...items.map(item => `- ${item}`)]
}

function contractSubsection(title: string, items: string[] | undefined, fallback: string): string[] {
  const values = items && items.length > 0 ? items : [fallback]
  return ['', `### ${title}`, '', ...values.map(item => `- ${item}`)]
}

function contractValues(items: string[] | undefined, fallback: string): string[] {
  return items && items.length > 0 ? [...items] : [fallback]
}

export function buildSkillApplicationContract(candidate: SkillCandidate): SkillApplicationContract {
  return {
    contract_version: 1,
    schema_version: 1,
    skill_id: candidate.id,
    title: candidate.title,
    namespace: candidate.namespace,
    type: candidate.type,
    domain_tags: [...candidate.domain_tags],
    use_first: contractValues(candidate.problem_signals, candidate.trigger),
    required_cheap_probes: contractValues(candidate.diagnostic_steps, CONTRACT_FALLBACKS.requiredCheapProbes),
    blocking_stop_conditions: contractValues(candidate.validation_checks, CONTRACT_FALLBACKS.blockingStopConditions),
    long_run_budget_rules: contractValues(candidate.tool_decision_rules, CONTRACT_FALLBACKS.longRunBudgetRules),
    validation_before_submit: contractValues(candidate.validation_checks, CONTRACT_FALLBACKS.validationBeforeSubmit),
    domain_checks: [...(candidate.math_physics_checks ?? [])],
    anti_patterns: contractValues(candidate.anti_patterns, CONTRACT_FALLBACKS.antiPatterns),
  }
}

function applicationContract(candidate: SkillCandidate): string[] {
  return [
    '',
    '## Application Contract',
    '',
    'Before writing solver code or launching long experiments, apply this contract in the round plan.',
    'Machine-readable sidecar: `contract.json`.',
    ...contractSubsection('Use This First', candidate.problem_signals, candidate.trigger),
    ...contractSubsection(
      'Required Cheap Probes',
      candidate.diagnostic_steps,
      CONTRACT_FALLBACKS.requiredCheapProbes,
    ),
    ...contractSubsection(
      'Stop Conditions',
      candidate.validation_checks,
      CONTRACT_FALLBACKS.blockingStopConditions,
    ),
    ...contractSubsection(
      'Long-run Budget Rules',
      candidate.tool_decision_rules,
      CONTRACT_FALLBACKS.longRunBudgetRules,
    ),
    ...contractSubsection(
      'Validation Before Submission',
      candidate.validation_checks,
      CONTRACT_FALLBACKS.validationBeforeSubmit,
    ),
    ...contractSubsection('Anti-patterns', candidate.anti_patterns, CONTRACT_FALLBACKS.antiPatterns),
  ]
}

function renderSkillMarkdown(candidate: SkillCandidate): string {
  return [
    frontmatter(candidate),
    '',
    `# ${candidate.title}`,
    '',
    `Type: ${candidate.type}`,
    `Namespace: ${candidate.namespace}`,
    `Tags: ${candidate.domain_tags.join(', ')}`,
    ...(candidate.summary ? ['', '## Summary', '', candidate.summary] : []),
    ...(candidate.transfer_scope ? ['', '## Transfer Scope', '', candidate.transfer_scope] : []),
    ...section('Problem Signals', candidate.problem_signals),
    ...section('Diagnostic Steps', candidate.diagnostic_steps),
    ...section('Math And Physics Checks', candidate.math_physics_checks),
    ...section('Tool Decision Rules', candidate.tool_decision_rules),
    ...section('Validation Checks', candidate.validation_checks),
    ...applicationContract(candidate),
    '',
    '## Guidance',
    '',
    ...candidate.guidance.map(item => `- ${item}`),
    '',
    '## Anti-patterns',
    '',
    ...candidate.anti_patterns.map(item => `- ${item}`),
    '',
  ].join('\n')
}

async function cleanObsoleteManagedSkills(activeSkillsDir: string, activeIds: Set<string>): Promise<void> {
  let entries
  try {
    entries = await readdir(activeSkillsDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || activeIds.has(entry.name)) continue
    const metadataPath = join(activeSkillsDir, entry.name, 'metadata.json')
    try {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
      if (metadata.managed_by === 'skill-learning') {
        await rm(join(activeSkillsDir, entry.name), { recursive: true, force: true })
      }
    } catch {
      // Unmanaged skills are intentionally preserved.
    }
  }
}

export async function renderActiveSkills(
  activeSkillsDir: string,
  candidates: SkillCandidate[],
  options: RenderActiveSkillsOptions = {},
): Promise<void> {
  assertActiveSkillsDir(activeSkillsDir)
  const active = candidates.filter(candidate => candidate.validation.status === 'active')
  for (const candidate of active) {
    const validation = validateSkillCandidate(candidate)
    if (!validation.ok) throw new Error(validation.errors.join('\n'))
    if (candidate.type === 'domain' && candidate.guidance.some(item => item.includes('```'))) {
      throw new Error('domain skill cannot contain a code block')
    }
  }

  await mkdir(activeSkillsDir, { recursive: true })
  if (options.cleanObsolete) {
    await cleanObsoleteManagedSkills(activeSkillsDir, new Set(active.map(candidate => candidate.id)))
  }

  for (const candidate of active) {
    const dir = skillDir(activeSkillsDir, candidate.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), renderSkillMarkdown(candidate), 'utf8')
    await writeFile(
      join(dir, 'contract.json'),
      `${JSON.stringify(buildSkillApplicationContract(candidate), null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      join(dir, 'metadata.json'),
      `${JSON.stringify(
        {
          managed_by: 'skill-learning',
          id: candidate.id,
          namespace: candidate.namespace,
          schema_version: candidate.schema_version,
          type: candidate.type,
          domain_tags: candidate.domain_tags,
          evidence_runs: candidate.evidence_runs,
          validation: candidate.validation,
          contract: {
            schema_version: 1,
            path: 'contract.json',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
}
