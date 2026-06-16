export type SkillCandidateType = 'general' | 'domain'

export type SkillCandidate = {
  schema_version?: 1 | 2
  id: string
  namespace: 'computational-imaging'
  type: SkillCandidateType
  title: string
  trigger: string
  domain_tags: string[]
  summary?: string
  problem_signals?: string[]
  diagnostic_steps?: string[]
  math_physics_checks?: string[]
  tool_decision_rules?: string[]
  validation_checks?: string[]
  transfer_scope?: string
  guidance: string[]
  anti_patterns: string[]
  evidence_runs: string[]
  validation: {
    status: 'candidate' | 'active' | 'quarantine' | 'deprecated'
    used_count: number
    success_delta: number
    regressions: number
  }
}

export type SkillCandidateValidationResult = {
  ok: boolean
  errors: string[]
  candidate?: SkillCandidate
}

const FORBIDDEN_MARKERS = [
  'ground_truth',
  '.judge_private',
  'std_code',
  'reference_outputs',
  'answer.npz',
  'private',
]

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function collectText(candidate: Partial<SkillCandidate>): string {
  return [
    candidate.id,
    candidate.title,
    candidate.trigger,
    candidate.summary,
    candidate.transfer_scope,
    ...(candidate.domain_tags ?? []),
    ...(candidate.problem_signals ?? []),
    ...(candidate.diagnostic_steps ?? []),
    ...(candidate.math_physics_checks ?? []),
    ...(candidate.tool_decision_rules ?? []),
    ...(candidate.validation_checks ?? []),
    ...(candidate.guidance ?? []),
    ...(candidate.anti_patterns ?? []),
    ...(candidate.evidence_runs ?? []),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
}

function hasHighPrecisionConstant(text: string): boolean {
  return /(?<![A-Za-z_])[-+]?\d+\.\d{6,}(?:[eE][-+]?\d+)?(?![A-Za-z_])/.test(text)
}

function normalizeCandidate(input: unknown, errors: string[]): SkillCandidate | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('candidate must be an object')
    return undefined
  }

  const value = input as Record<string, unknown>
  const candidate: Partial<SkillCandidate> = {}
  if (value.schema_version !== undefined) {
    if (value.schema_version !== 1 && value.schema_version !== 2) {
      errors.push('schema_version must be 1 or 2 when provided')
    } else {
      candidate.schema_version = value.schema_version
    }
  }
  for (const key of ['id', 'title', 'trigger'] as const) {
    if (typeof value[key] !== 'string' || value[key].trim() === '') {
      errors.push(`${key} must be a non-empty string`)
    } else {
      candidate[key] = value[key]
    }
  }
  if (typeof value.id === 'string' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) {
    errors.push('id must be a path-safe slug using lowercase letters, numbers, and hyphens')
  }
  if (value.namespace !== 'computational-imaging') {
    errors.push('namespace must be computational-imaging')
  } else {
    candidate.namespace = value.namespace
  }
  if (value.type !== 'general' && value.type !== 'domain') {
    errors.push('type must be general or domain')
  } else {
    candidate.type = value.type
  }
  for (const key of ['domain_tags', 'guidance', 'anti_patterns', 'evidence_runs'] as const) {
    if (!isStringArray(value[key]) || value[key].length === 0) {
      errors.push(`${key} must be a non-empty string array`)
    } else {
      candidate[key] = value[key]
    }
  }
  if (value.schema_version === 2) {
    for (const key of ['summary', 'transfer_scope'] as const) {
      if (typeof value[key] !== 'string' || value[key].trim() === '') {
        errors.push(`${key} must be a non-empty string for schema_version 2`)
      } else {
        candidate[key] = value[key]
      }
    }
    for (const key of ['problem_signals', 'diagnostic_steps', 'tool_decision_rules', 'validation_checks'] as const) {
      if (!isStringArray(value[key]) || value[key].length === 0) {
        errors.push(`${key} must be a non-empty string array for schema_version 2`)
      } else {
        candidate[key] = value[key]
      }
    }
    if (value.type === 'domain') {
      if (!isStringArray(value.math_physics_checks) || value.math_physics_checks.length === 0) {
        errors.push('math_physics_checks must be a non-empty string array for schema_version 2 domain skills')
      } else {
        candidate.math_physics_checks = value.math_physics_checks
      }
    } else if (isStringArray(value.math_physics_checks)) {
      candidate.math_physics_checks = value.math_physics_checks
    }
  } else {
    for (const key of [
      'problem_signals',
      'diagnostic_steps',
      'math_physics_checks',
      'tool_decision_rules',
      'validation_checks',
    ] as const) {
      if (value[key] !== undefined) {
        if (!isStringArray(value[key])) errors.push(`${key} must be a string array when provided`)
        else candidate[key] = value[key]
      }
    }
    for (const key of ['summary', 'transfer_scope'] as const) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== 'string') errors.push(`${key} must be a string when provided`)
        else candidate[key] = value[key]
      }
    }
  }

  const validation = value.validation
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    errors.push('validation must be an object')
  } else {
    const raw = validation as Record<string, unknown>
    if (
      raw.status !== 'candidate' &&
      raw.status !== 'active' &&
      raw.status !== 'quarantine' &&
      raw.status !== 'deprecated'
    ) {
      errors.push('validation.status must be candidate, active, quarantine, or deprecated')
    }
    for (const key of ['used_count', 'success_delta', 'regressions'] as const) {
      if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) {
        errors.push(`validation.${key} must be a finite number`)
      }
    }
    if (errors.length === 0) {
      candidate.validation = {
        status: raw.status as SkillCandidate['validation']['status'],
        used_count: raw.used_count as number,
        success_delta: raw.success_delta as number,
        regressions: raw.regressions as number,
      }
    }
  }

  return errors.length === 0 ? candidate as SkillCandidate : undefined
}

export function validateSkillCandidate(input: unknown): SkillCandidateValidationResult {
  const errors: string[] = []
  const candidate = normalizeCandidate(input, errors)
  const text = collectText((input && typeof input === 'object' ? input : {}) as Partial<SkillCandidate>)
  const lower = text.toLowerCase()

  if ((input as Partial<SkillCandidate>)?.type === 'domain' && /```/.test(text)) {
    errors.push('domain skill candidate must not contain a code block')
  }
  for (const marker of FORBIDDEN_MARKERS) {
    if (lower.includes(marker)) errors.push(`candidate must not contain forbidden marker: ${marker}`)
  }
  if (hasHighPrecisionConstant(text)) {
    errors.push('candidate contains a high precision numeric constant that may be a private answer value')
  }

  return {
    ok: errors.length === 0,
    errors,
    candidate: errors.length === 0 ? candidate : undefined,
  }
}

export function parseSkillCandidates(text: string): SkillCandidateValidationResult {
  const parsed = parseSkillCandidateList(text)
  return {
    ok: parsed.ok,
    errors: parsed.errors,
    candidate: parsed.candidates[0],
  }
}

export function parseSkillCandidateList(text: string, options: { requireSchemaVersion?: 2 } = {}): {
  ok: boolean
  errors: string[]
  candidates: SkillCandidate[]
} {
  try {
    const parsed = JSON.parse(text)
    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    const errors: string[] = []
    const valid: SkillCandidate[] = []
    for (const candidate of candidates) {
      const result = validateSkillCandidate(candidate)
      if (result.candidate) valid.push(result.candidate)
      errors.push(...result.errors)
      if (options.requireSchemaVersion === 2 && (candidate as Partial<SkillCandidate>)?.schema_version !== 2) {
        errors.push('candidate must use schema_version 2')
      }
    }
    return { ok: errors.length === 0, errors, candidates: valid }
  } catch (error) {
    return {
      ok: false,
      errors: [`candidate output must be JSON: ${error instanceof Error ? error.message : String(error)}`],
      candidates: [],
    }
  }
}
