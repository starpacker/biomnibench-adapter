import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { runEvaluationBatch } from '../harness/evaluation/batchRunner.js'
import type { EvaluationContextOptions, EvaluationSkillOptions } from '../harness/evaluation/types.js'
import type { SkillLearningConfig } from './config.js'

export type ValidationPhase = 'train' | 'valid'

export type ValidationTaskResult = {
  taskId: string
  status: string
  reward?: number
}

export type ValidationEvaluateRequest = {
  label: 'baseline' | 'active' | 'skills'
  taskIds: string[]
  tasksDir: string
  runsDir: string
  concurrency: number
  maxRounds: number
  maxRoundsByTaskId?: Record<string, number>
  timeoutSeconds: number
  timeoutSecondsByTaskId?: Record<string, number>
  env?: Record<string, string>
  workerEnvByTaskId?: Record<string, Record<string, string>>
  skillOptions: EvaluationSkillOptions
  skillOptionsByTaskId?: Record<string, EvaluationSkillOptions>
  contextOptions?: EvaluationContextOptions
}

export type ValidationEvaluateResult = {
  ok: boolean
  taskResults: ValidationTaskResult[]
}

export type SkillContractViolation = {
  code: string
  message: string
  path?: string
  details?: unknown
}

export type ValidationEvaluator = (
  request: ValidationEvaluateRequest,
) => Promise<ValidationEvaluateResult>

export type SkillValidationReport = {
  cycleId: string
  phase: ValidationPhase
  configFingerprint?: string
  configSnapshot?: ValidationConfigSnapshot
  staleReportsIgnored?: Array<{ source: string; reason: string }>
  context?: {
    profile: EvaluationContextOptions['profile']
    runMemory: boolean
    knownBaselineReused: boolean
  }
  scope?: {
    taskIds: string[]
    source?: string
    reason?: string
  }
  baseline: ValidationTaskResult[]
  active?: ValidationTaskResult[]
  skills: ValidationTaskResult[]
  proof?: {
    baselineSource: 'locked-manifest' | 'evaluated' | 'known-results'
    baselineManifestPath?: string
    baselineRerun: boolean
    baselineFailedByTask: Record<string, boolean>
    skillsSucceededByTask: Record<string, boolean>
    recoveredByTask: Record<string, boolean>
    allFailedRecovered: boolean
  }
  skillRun?: {
    skillsDir: string
    additionalSkillsDirs: string[]
    allowedSkillNames: string[]
    activeSkillIds: string[]
    candidateSkillIds: string[]
    exposureByTask?: Record<string, string[]>
    candidateCoverage?: Record<string, string[]>
    skillToolUsageByTask?: Record<string, boolean | null>
    contractUsageByTask?: Record<string, boolean | null>
    contractViolationsByTask?: Record<string, SkillContractViolation[] | null>
  }
  gates: {
    noRegression: boolean
    activeNoRegression?: boolean
    innovation: boolean
    skillToolUsage?: boolean
    skillContractUsage?: boolean
    allFailedRecovered?: boolean
    trainPassed: boolean
    validAllowed: boolean
  }
}

export type RunSkillValidationInput = {
  config: SkillLearningConfig
  cycleId: string
  phase: ValidationPhase
  taskIds?: string[]
  reportFileName?: string
  scope?: SkillValidationReport['scope']
  knownBaselineResults?: ValidationTaskResult[]
  previouslySuccessfulTaskIds?: string[]
  previouslyFailedTaskIds?: string[]
  trainReport?: SkillValidationReport
  skillsDir?: string
  additionalSkillsDirs?: string[]
  allowedSkillNames?: string[]
  activeSkillIdsUnderTest?: string[]
  candidateSkillIdsUnderTest?: string[]
  skillOptionsByTaskId?: Record<string, EvaluationSkillOptions>
  exposureByTask?: Record<string, string[]>
  candidateCoverage?: Record<string, string[]>
  maxActiveSkills?: number
  staleReportsIgnored?: Array<{ source: string; reason: string }>
  evaluate?: ValidationEvaluator
}

export type ValidationConfigSnapshot = {
  tasks: {
    train: string[]
    valid: string[]
  }
  proof?: {
    lockedBaselineManifestPath?: string
    lockedBaselineManifestHash?: string
  }
  context?: {
    profile?: SkillLearningConfig['contextProfile']
    runMemory?: boolean
    includeClaudeDefaultUserContext?: boolean
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return value === undefined ? 'null' : JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function optionalFileHash(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined
  try {
    return sha256(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

export async function buildValidationConfigSnapshot(config: SkillLearningConfig): Promise<ValidationConfigSnapshot> {
  const lockedBaselineManifestPath = config.proof?.lockedBaselineManifestPath
  const lockedBaselineManifestHash = await optionalFileHash(lockedBaselineManifestPath)
  return {
    tasks: {
      train: [...config.tasks.train].sort(),
      valid: [...config.tasks.valid].sort(),
    },
    proof: lockedBaselineManifestPath || lockedBaselineManifestHash
      ? {
          lockedBaselineManifestPath,
          lockedBaselineManifestHash,
        }
      : undefined,
    context: config.contextProfile || config.runMemory !== undefined || config.includeClaudeDefaultUserContext !== undefined
      ? {
          profile: config.contextProfile,
          runMemory: config.runMemory,
          includeClaudeDefaultUserContext: config.includeClaudeDefaultUserContext,
        }
      : undefined,
  }
}

export async function buildValidationConfigFingerprint(config: SkillLearningConfig): Promise<string> {
  return sha256(stableJson(await buildValidationConfigSnapshot(config)))
}

async function defaultEvaluate(request: ValidationEvaluateRequest): Promise<ValidationEvaluateResult> {
  const result = await runEvaluationBatch({
    taskIds: request.taskIds,
    tasksDir: request.tasksDir,
    runsDir: request.runsDir,
    maxRounds: request.maxRounds,
    maxRoundsByTaskId: request.maxRoundsByTaskId,
    timeoutSeconds: request.timeoutSeconds,
    timeoutSecondsByTaskId: request.timeoutSecondsByTaskId,
    concurrency: request.concurrency,
    temperature: 1,
    thinking: 'disabled',
    workerEnv: request.env,
    workerEnvByTaskId: request.workerEnvByTaskId,
    skillOptions: request.skillOptions,
    skillOptionsByTaskId: request.skillOptionsByTaskId,
    contextOptions: request.contextOptions,
    verbose: true,
  })
  const fallbackResults = result.workers.map(worker => ({
    taskId: worker.taskId,
    status: worker.exitCode === 0 ? 'success' : 'failed',
    reward: worker.exitCode === 0 ? 1 : 0,
  }))
  const taskResults = await loadValidationTaskResultsFromRunSummaries(request.taskIds, request.runsDir, fallbackResults)
  return {
    ok: taskResults.every(result => isSuccess(result.status)),
    taskResults,
  }
}

function summaryResultFromJson(taskId: string, value: unknown): ValidationTaskResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.status !== 'string') return undefined
  return {
    taskId,
    status: raw.status,
    reward: typeof raw.reward === 'number' && Number.isFinite(raw.reward) ? raw.reward : undefined,
  }
}

export async function loadValidationTaskResultsFromRunSummaries(
  taskIds: string[],
  runsDir: string,
  fallbackResults: ValidationTaskResult[],
): Promise<ValidationTaskResult[]> {
  let entries
  try {
    entries = await readdir(runsDir, { withFileTypes: true })
  } catch {
    return fallbackResults
  }

  const fallbackByTask = new Map(fallbackResults.map(result => [result.taskId, result]))
  const summariesByTask = new Map<string, { runDirName: string; result: ValidationTaskResult }>()
  for (const taskId of taskIds) {
    const prefix = `${taskId}_`
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
      let summary
      try {
        summary = summaryResultFromJson(
          taskId,
          JSON.parse(await readFile(join(runsDir, entry.name, 'logs', 'run_summary.json'), 'utf8')),
        )
      } catch {
        continue
      }
      if (!summary) continue
      const previous = summariesByTask.get(taskId)
      if (!previous || entry.name.localeCompare(previous.runDirName) > 0) {
        summariesByTask.set(taskId, { runDirName: entry.name, result: summary })
      }
    }
  }

  return taskIds.map(taskId => summariesByTask.get(taskId)?.result ?? fallbackByTask.get(taskId) ?? {
    taskId,
    status: 'failed',
    reward: 0,
  })
}

function statusByTask(results: ValidationTaskResult[]): Map<string, string> {
  return new Map(results.map(result => [result.taskId, result.status]))
}

function isSuccess(status: string | undefined): boolean {
  return status === 'success'
}

function hasSkillToolCall(records: string): boolean {
  for (const line of records.split(/\r?\n/)) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    const raw = record as Record<string, unknown>
    const kind = raw.kind ?? raw.type
    if (kind === 'tool_call' && raw.tool === 'Skill') return true
  }
  return false
}

async function latestRunDirForTask(runsDir: string, taskId: string): Promise<string | undefined> {
  let entries
  try {
    entries = await readdir(runsDir, { withFileTypes: true })
  } catch {
    return undefined
  }
  const prefix = `${taskId}_`
  let latest: string | undefined
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    if (!latest || entry.name.localeCompare(latest) > 0) latest = entry.name
  }
  return latest ? join(runsDir, latest) : undefined
}

async function runHasSkillToolCall(runsDir: string, taskId: string): Promise<boolean | undefined> {
  const runDir = await latestRunDirForTask(runsDir, taskId)
  if (!runDir) return undefined
  for (const relPath of ['logs/trajectory.clean.jsonl', 'logs/trajectory.raw.jsonl']) {
    try {
      if (hasSkillToolCall(await readFile(join(runDir, relPath), 'utf8'))) return true
    } catch {
      // Try the next trajectory. Missing files are possible for failed infra runs.
    }
  }
  return false
}

const VALID_SKILL_APPLICATION_STATUSES = new Set([
  'used',
  'not_applicable',
  'blocked_but_overridden',
])

function skillApplicationEntries(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.skills)) return undefined
  if (!raw.skills.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    return undefined
  }
  return raw.skills as Array<Record<string, unknown>>
}

function hasUnsafeSkillApplicationPath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/')
  return (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.includes('.judge_private') ||
    normalized.includes('known_tasks/')
  )
}

function validateSkillApplicationJson(input: {
  value: unknown
  path: string
  expectedSkillNames?: string[]
}): SkillContractViolation[] {
  const entries = skillApplicationEntries(input.value)
  if (!entries || entries.length === 0) {
    return [
      {
        code: 'invalid_skill_application',
        message: 'skill_application.json must contain a non-empty skills array.',
        path: input.path,
      },
    ]
  }

  const invalidIndexes = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const skill = entry.skill
      const status = entry.status
      const evidencePath = entry.evidence_path
      const reason = entry.reason
      return (
        typeof skill !== 'string' ||
        skill.trim().length === 0 ||
        typeof status !== 'string' ||
        !VALID_SKILL_APPLICATION_STATUSES.has(status) ||
        typeof evidencePath !== 'string' ||
        evidencePath.trim().length === 0 ||
        hasUnsafeSkillApplicationPath(evidencePath) ||
        typeof reason !== 'string' ||
        reason.trim().length === 0
      )
    })
    .map(item => item.index)

  if (invalidIndexes.length > 0) {
    return [
      {
        code: 'invalid_skill_application',
        message: 'skill_application.json has invalid skill application entries.',
        path: input.path,
        details: { invalidIndexes },
      },
    ]
  }

  const expected = [...new Set(input.expectedSkillNames?.filter(Boolean) ?? [])]
  if (expected.length > 0) {
    const covered = new Set(entries.map(entry => String(entry.skill)))
    const missingSkillNames = expected.filter(skill => !covered.has(skill))
    if (missingSkillNames.length > 0) {
      return [
        {
          code: 'incomplete_skill_application',
          message: 'skill_application.json does not cover every exposed active skill.',
          path: input.path,
          details: { missingSkillNames },
        },
      ]
    }
  }

  return []
}

async function runSkillApplicationStatus(input: {
  runsDir: string
  taskId: string
  expectedSkillNames?: string[]
}): Promise<{ ok: boolean; violations: SkillContractViolation[] } | undefined> {
  const runDir = await latestRunDirForTask(input.runsDir, input.taskId)
  if (!runDir) return undefined
  const relPath = 'workspace/skill_application.json'
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(runDir, relPath), 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        ok: false,
        violations: [
          {
            code: 'missing_skill_application',
            message: 'workspace/skill_application.json is missing from the skills run.',
            path: relPath,
          },
        ],
      }
    }
    return {
      ok: false,
      violations: [
        {
          code: 'invalid_skill_application',
          message: 'workspace/skill_application.json could not be parsed as JSON.',
          path: relPath,
          details: { error: error instanceof Error ? error.message : String(error) },
        },
      ],
    }
  }

  const violations = validateSkillApplicationJson({
    value: parsed,
    path: relPath,
    expectedSkillNames: input.expectedSkillNames,
  })
  return { ok: violations.length === 0, violations }
}

type LockedBaselineManifest = {
  tasks?: Array<{
    taskId?: unknown
    status?: unknown
    reward?: unknown
    rounds?: unknown
    trajectoryPath?: unknown
    skillToolCalls?: unknown
  }>
}

function isLockedBaselineFailure(result: ValidationTaskResult): boolean {
  return !isSuccess(result.status) && (result.reward ?? 0) <= 0
}

async function loadLockedBaselineResults(input: {
  config: SkillLearningConfig
  phase: ValidationPhase
  taskIds: string[]
}): Promise<{ results: ValidationTaskResult[]; manifestPath: string } | undefined> {
  const manifestPath = input.config.proof?.lockedBaselineManifestPath
  if (!manifestPath || input.phase !== 'train') return undefined

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as LockedBaselineManifest
  if (!Array.isArray(manifest.tasks)) {
    throw new Error('locked baseline manifest must contain a tasks array')
  }
  const byTask = new Map<string, LockedBaselineManifest['tasks'][number]>()
  for (const entry of manifest.tasks) {
    if (typeof entry.taskId === 'string') byTask.set(entry.taskId, entry)
  }

  const results: ValidationTaskResult[] = []
  for (const taskId of input.taskIds) {
    const entry = byTask.get(taskId)
    if (!entry) throw new Error(`locked baseline missing task: ${taskId}`)
    const result = {
      taskId,
      status: typeof entry.status === 'string' ? entry.status : 'unknown',
      reward: typeof entry.reward === 'number' && Number.isFinite(entry.reward) ? entry.reward : undefined,
    }
    if (!isLockedBaselineFailure(result)) {
      throw new Error(`locked baseline for ${taskId} is not a failed no-skill run`)
    }
    if (typeof entry.skillToolCalls === 'number' && entry.skillToolCalls > 0) {
      throw new Error(`locked baseline for ${taskId} contains Skill tool calls`)
    }
    if (typeof entry.trajectoryPath === 'string') {
      try {
        if (hasSkillToolCall(await readFile(entry.trajectoryPath, 'utf8'))) {
          throw new Error(`locked baseline for ${taskId} contains Skill tool calls`)
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('contains Skill tool calls')) throw error
        // A missing legacy trajectory should not trigger rerunning baseline; the manifest
        // status/reward remains the baseline evidence, and audit can flag weak evidence.
      }
    }
    results.push(result)
  }

  return { results, manifestPath }
}

function expectsSkillUse(
  taskId: string,
  globalSkillOptions: EvaluationSkillOptions,
  skillOptionsByTaskId?: Record<string, EvaluationSkillOptions>,
): boolean {
  const options = skillOptionsByTaskId?.[taskId] ?? globalSkillOptions
  if (!options.enabled) return false
  return options.allowedSkillNames === undefined || options.allowedSkillNames.length > 0
}

function expectedSkillNamesForTask(
  taskId: string,
  globalSkillOptions: EvaluationSkillOptions,
  skillOptionsByTaskId?: Record<string, EvaluationSkillOptions>,
): string[] | undefined {
  const options = skillOptionsByTaskId?.[taskId] ?? globalSkillOptions
  return options.allowedSkillNames
}

async function inspectSkillToolUsage(input: {
  runsDir: string
  taskIds: string[]
  skillOptions: EvaluationSkillOptions
  skillOptionsByTaskId?: Record<string, EvaluationSkillOptions>
}): Promise<{ ok: boolean; byTask: Record<string, boolean | null> }> {
  const byTask: Record<string, boolean | null> = {}
  const expectedTaskIds = input.taskIds.filter(taskId =>
    expectsSkillUse(taskId, input.skillOptions, input.skillOptionsByTaskId),
  )
  if (expectedTaskIds.length === 0) return { ok: true, byTask }
  let ok = true
  for (const taskId of expectedTaskIds) {
    const observed = await runHasSkillToolCall(input.runsDir, taskId)
    byTask[taskId] = observed ?? null
    if (observed !== true) ok = false
  }
  return { ok, byTask }
}

async function inspectSkillContractUsage(input: {
  runsDir: string
  taskIds: string[]
  skillOptions: EvaluationSkillOptions
  skillOptionsByTaskId?: Record<string, EvaluationSkillOptions>
}): Promise<{
  ok: boolean
  byTask: Record<string, boolean | null>
  violationsByTask: Record<string, SkillContractViolation[] | null>
}> {
  const byTask: Record<string, boolean | null> = {}
  const violationsByTask: Record<string, SkillContractViolation[] | null> = {}
  const expectedTaskIds = input.taskIds.filter(taskId =>
    expectsSkillUse(taskId, input.skillOptions, input.skillOptionsByTaskId),
  )
  if (expectedTaskIds.length === 0) return { ok: true, byTask, violationsByTask }
  let ok = true
  for (const taskId of expectedTaskIds) {
    const observed = await runSkillApplicationStatus({
      runsDir: input.runsDir,
      taskId,
      expectedSkillNames: expectedSkillNamesForTask(
        taskId,
        input.skillOptions,
        input.skillOptionsByTaskId,
      ),
    })
    byTask[taskId] = observed?.ok ?? null
    violationsByTask[taskId] = observed?.violations ?? null
    if (observed?.ok !== true) ok = false
  }
  return { ok, byTask, violationsByTask }
}

function proofStatus(input: {
  taskIds: string[]
  baseline: ValidationTaskResult[]
  skills: ValidationTaskResult[]
  baselineSource: SkillValidationReport['proof']['baselineSource']
  baselineManifestPath?: string
  baselineRerun: boolean
}): SkillValidationReport['proof'] {
  const baselineByTask = new Map(input.baseline.map(result => [result.taskId, result]))
  const skillsByTask = new Map(input.skills.map(result => [result.taskId, result]))
  const baselineFailedByTask: Record<string, boolean> = {}
  const skillsSucceededByTask: Record<string, boolean> = {}
  const recoveredByTask: Record<string, boolean> = {}
  for (const taskId of input.taskIds) {
    baselineFailedByTask[taskId] = isLockedBaselineFailure(baselineByTask.get(taskId) ?? { taskId, status: 'unknown', reward: 0 })
    skillsSucceededByTask[taskId] = isSuccess(skillsByTask.get(taskId)?.status)
    recoveredByTask[taskId] = baselineFailedByTask[taskId] && skillsSucceededByTask[taskId]
  }
  return {
    baselineSource: input.baselineSource,
    baselineManifestPath: input.baselineManifestPath,
    baselineRerun: input.baselineRerun,
    baselineFailedByTask,
    skillsSucceededByTask,
    recoveredByTask,
    allFailedRecovered: input.taskIds.every(taskId => recoveredByTask[taskId]),
  }
}

function assertSafeReportFileName(fileName: string): void {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(fileName)) {
    throw new Error(`unsafe validation report file name: ${fileName}`)
  }
}

function reportPath(config: SkillLearningConfig, cycleId: string, phase: ValidationPhase, fileName?: string): string {
  const safeFileName = fileName ?? `${phase}-report.json`
  assertSafeReportFileName(safeFileName)
  return join(config.paths.workDir, 'validation', cycleId, safeFileName)
}

function validationWorkerEnv(config: SkillLearningConfig, maxBashTimeoutMs?: number): Record<string, string> | undefined {
  const bashTimeoutMs = String(maxBashTimeoutMs ?? config.limits.validationMaxBashTimeoutMs)
  const env: Record<string, string> = {
    BASH_DEFAULT_TIMEOUT_MS: bashTimeoutMs,
    BASH_MAX_TIMEOUT_MS: bashTimeoutMs,
    SOURCE_EVAL_MAX_BASH_TIMEOUT_MS: bashTimeoutMs,
  }
  if (config.limits.validationDisableGpu) {
    env.CUDA_VISIBLE_DEVICES = ''
    env.NVIDIA_VISIBLE_DEVICES = 'void'
    env.PYTORCH_NO_CUDA_MEMORY_CACHING = '1'
  }
  return env
}

function validationTaskOverrideMaps(
  config: SkillLearningConfig,
  taskIds: string[],
): {
  maxRoundsByTaskId?: Record<string, number>
  timeoutSecondsByTaskId?: Record<string, number>
  workerEnvByTaskId?: Record<string, Record<string, string>>
} {
  const overrides = config.limits.validationTaskOverrides
  if (!overrides) return {}
  const taskSet = new Set(taskIds)
  const maxRoundsByTaskId: Record<string, number> = {}
  const timeoutSecondsByTaskId: Record<string, number> = {}
  const workerEnvByTaskId: Record<string, Record<string, string>> = {}
  for (const [taskId, override] of Object.entries(overrides)) {
    if (!taskSet.has(taskId)) continue
    if (override.maxRounds !== undefined) maxRoundsByTaskId[taskId] = override.maxRounds
    if (override.timeoutSeconds !== undefined) timeoutSecondsByTaskId[taskId] = override.timeoutSeconds
    if (override.maxBashTimeoutMs !== undefined) workerEnvByTaskId[taskId] = validationWorkerEnv(config, override.maxBashTimeoutMs) ?? {}
  }
  return {
    maxRoundsByTaskId: Object.keys(maxRoundsByTaskId).length > 0 ? maxRoundsByTaskId : undefined,
    timeoutSecondsByTaskId: Object.keys(timeoutSecondsByTaskId).length > 0 ? timeoutSecondsByTaskId : undefined,
    workerEnvByTaskId: Object.keys(workerEnvByTaskId).length > 0 ? workerEnvByTaskId : undefined,
  }
}

function validationContextOptions(config: SkillLearningConfig): EvaluationContextOptions | undefined {
  if (!config.contextProfile && config.runMemory !== true) return undefined
  return {
    profile: config.contextProfile ?? 'eval-minimal',
    runMemory: config.runMemory === true,
    recordContextEvents: true,
    reInjectActiveSkillsEachRound: true,
    includeClaudeDefaultUserContext: config.includeClaudeDefaultUserContext === true,
    enableSlashCommands: false,
    enableMcpClients: false,
    enableAgentTool: false,
  }
}

export async function loadValidationReport(
  config: SkillLearningConfig,
  cycleId: string,
  phase: ValidationPhase = 'train',
): Promise<SkillValidationReport> {
  try {
    return JSON.parse(await readFile(reportPath(config, cycleId, phase), 'utf8')) as SkillValidationReport
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return JSON.parse(await readFile(join(config.paths.workDir, 'validation', cycleId, 'report.json'), 'utf8')) as SkillValidationReport
    }
    throw error
  }
}

export async function loadValidationReportFile(
  config: SkillLearningConfig,
  cycleId: string,
  fileName: string,
): Promise<SkillValidationReport> {
  return JSON.parse(await readFile(reportPath(config, cycleId, 'train', fileName), 'utf8')) as SkillValidationReport
}

export async function writeValidationReport(
  config: SkillLearningConfig,
  report: SkillValidationReport,
  fileName?: string,
): Promise<void> {
  const path = reportPath(config, report.cycleId, report.phase, fileName)
  await mkdir(join(config.paths.workDir, 'validation', report.cycleId), { recursive: true })
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runSkillValidation(input: RunSkillValidationInput): Promise<SkillValidationReport> {
  if (input.phase === 'valid' && !input.trainReport?.gates.validAllowed) {
    throw new Error('train validation must pass before valid validation')
  }

  const evaluate = input.evaluate ?? defaultEvaluate
  const defaultTaskIds = input.phase === 'train' ? input.config.tasks.train : input.config.tasks.valid
  const taskIds = input.taskIds ?? defaultTaskIds
  const configuredTaskIds = new Set(defaultTaskIds)
  const unknownTaskIds = taskIds.filter(taskId => !configuredTaskIds.has(taskId))
  if (unknownTaskIds.length > 0) {
    throw new Error(`validation task override contains tasks outside ${input.phase}: ${unknownTaskIds.join(', ')}`)
  }
  const skillsDir = input.skillsDir ?? input.config.paths.activeSkillsDir
  const additionalSkillsDirs = input.additionalSkillsDirs ?? []
  const allowedSkillNames = input.allowedSkillNames ?? []
  const activeSkillIds = input.activeSkillIdsUnderTest ?? []
  const candidateSkillIds = input.candidateSkillIdsUnderTest ?? []
  const concurrency = input.config.limits.validationConcurrency
  const maxRounds = input.config.limits.validationMaxRounds
  const timeoutSeconds = input.config.limits.validationTimeoutSeconds ?? 10800
  const env = validationWorkerEnv(input.config)
  const taskOverrideMaps = validationTaskOverrideMaps(input.config, taskIds)
  const contextOptions = validationContextOptions(input.config)
  const lockedBaseline = await loadLockedBaselineResults({ config: input.config, phase: input.phase, taskIds })
  const canReuseKnownBaseline = Boolean(input.knownBaselineResults) && !contextOptions && !lockedBaseline
  const hasCandidateOverlay = additionalSkillsDirs.length > 0 || candidateSkillIds.length > 0
  const shouldCompareActive = hasCandidateOverlay && activeSkillIds.length > 0
  const skillsRunsDir = join(input.config.paths.workDir, 'validation', input.cycleId, `${input.phase}-skills-runs`)
  const baseline = lockedBaseline
    ? {
        ok: false,
        taskResults: lockedBaseline.results,
      }
    : canReuseKnownBaseline
    ? {
        ok: input.knownBaselineResults!.every(result => isSuccess(result.status)),
        taskResults: input.knownBaselineResults!,
      }
    : await evaluate({
        label: 'baseline',
        taskIds,
        tasksDir: input.config.paths.tasksDir,
        runsDir: join(input.config.paths.workDir, 'validation', input.cycleId, `${input.phase}-baseline-runs`),
        concurrency,
        maxRounds,
        maxRoundsByTaskId: taskOverrideMaps.maxRoundsByTaskId,
        timeoutSeconds,
        timeoutSecondsByTaskId: taskOverrideMaps.timeoutSecondsByTaskId,
        env,
        workerEnvByTaskId: taskOverrideMaps.workerEnvByTaskId,
        skillOptions: {
          enabled: false,
          mode: 'native',
          skillsDir: input.config.paths.activeSkillsDir,
        },
        contextOptions,
      })
  const active = shouldCompareActive
    ? await evaluate({
        label: 'active',
        taskIds,
        tasksDir: input.config.paths.tasksDir,
        runsDir: join(input.config.paths.workDir, 'validation', input.cycleId, `${input.phase}-active-runs`),
        concurrency,
        maxRounds,
        maxRoundsByTaskId: taskOverrideMaps.maxRoundsByTaskId,
        timeoutSeconds,
        timeoutSecondsByTaskId: taskOverrideMaps.timeoutSecondsByTaskId,
        env,
        workerEnvByTaskId: taskOverrideMaps.workerEnvByTaskId,
        skillOptions: {
          enabled: true,
          mode: 'native',
          skillsDir: input.config.paths.activeSkillsDir,
          allowedSkillNames: activeSkillIds,
          maxActiveSkills: input.maxActiveSkills,
        },
        contextOptions,
      })
    : undefined
  const skills = await evaluate({
    label: 'skills',
    taskIds,
    tasksDir: input.config.paths.tasksDir,
    runsDir: skillsRunsDir,
    concurrency,
    maxRounds,
    maxRoundsByTaskId: taskOverrideMaps.maxRoundsByTaskId,
    timeoutSeconds,
    timeoutSecondsByTaskId: taskOverrideMaps.timeoutSecondsByTaskId,
    env,
    workerEnvByTaskId: taskOverrideMaps.workerEnvByTaskId,
    skillOptions: {
      enabled: true,
      mode: 'native',
      skillsDir,
      additionalSkillsDirs,
      allowedSkillNames,
      maxActiveSkills: input.maxActiveSkills,
    },
    skillOptionsByTaskId: input.skillOptionsByTaskId,
    contextOptions,
  })

  const baselineStatuses = statusByTask(baseline.taskResults)
  const activeStatuses = active ? statusByTask(active.taskResults) : undefined
  const skillStatuses = statusByTask(skills.taskResults)
  const previouslySuccessful = input.previouslySuccessfulTaskIds ?? taskIds.filter(taskId => isSuccess(baselineStatuses.get(taskId)))
  const previouslyFailed = input.previouslyFailedTaskIds ?? taskIds.filter(taskId => !isSuccess(baselineStatuses.get(taskId)))
  const activeNoRegression = activeStatuses
    ? previouslySuccessful.every(taskId => isSuccess(activeStatuses.get(taskId)))
    : true
  const noRegression = previouslySuccessful.every(taskId => isSuccess(skillStatuses.get(taskId)))
  const innovation = previouslyFailed.length === 0 || previouslyFailed.some(taskId => isSuccess(skillStatuses.get(taskId)))
  const skillsSkillOptions: EvaluationSkillOptions = {
    enabled: true,
    mode: 'native',
    skillsDir,
    additionalSkillsDirs,
    allowedSkillNames,
    maxActiveSkills: input.maxActiveSkills,
  }
  const skillToolUsage = await inspectSkillToolUsage({
    runsDir: skillsRunsDir,
    taskIds,
    skillOptions: skillsSkillOptions,
    skillOptionsByTaskId: input.skillOptionsByTaskId,
  })
  const skillContractUsage = await inspectSkillContractUsage({
    runsDir: skillsRunsDir,
    taskIds,
    skillOptions: skillsSkillOptions,
    skillOptionsByTaskId: input.skillOptionsByTaskId,
  })
  const configSnapshot = await buildValidationConfigSnapshot(input.config)
  const configFingerprint = sha256(stableJson(configSnapshot))
  const proof = proofStatus({
    taskIds,
    baseline: baseline.taskResults,
    skills: skills.taskResults,
    baselineSource: lockedBaseline ? 'locked-manifest' : canReuseKnownBaseline ? 'known-results' : 'evaluated',
    baselineManifestPath: lockedBaseline?.manifestPath,
    baselineRerun: !lockedBaseline && !canReuseKnownBaseline,
  })
  const trainPassed = input.phase === 'train'
    ? activeNoRegression && noRegression && skills.ok && skillToolUsage.ok && skillContractUsage.ok && (!lockedBaseline || proof.allFailedRecovered)
    : input.trainReport?.gates.trainPassed === true
  const report: SkillValidationReport = {
    cycleId: input.cycleId,
    phase: input.phase,
    configFingerprint,
    configSnapshot,
    staleReportsIgnored: input.staleReportsIgnored && input.staleReportsIgnored.length > 0
      ? input.staleReportsIgnored
      : undefined,
    context: contextOptions
      ? {
          profile: contextOptions.profile,
          runMemory: contextOptions.runMemory,
          knownBaselineReused: canReuseKnownBaseline,
        }
      : undefined,
    scope: input.scope,
    baseline: baseline.taskResults,
    active: active?.taskResults,
    skills: skills.taskResults,
    proof,
    skillRun: {
      skillsDir,
      additionalSkillsDirs,
      allowedSkillNames,
      activeSkillIds,
      candidateSkillIds,
      exposureByTask: input.exposureByTask,
      candidateCoverage: input.candidateCoverage,
      skillToolUsageByTask: skillToolUsage.byTask,
      contractUsageByTask: skillContractUsage.byTask,
      contractViolationsByTask: skillContractUsage.violationsByTask,
    },
    gates: {
      noRegression,
      activeNoRegression,
      innovation,
      skillToolUsage: skillToolUsage.ok,
      skillContractUsage: skillContractUsage.ok,
      allFailedRecovered: lockedBaseline ? proof.allFailedRecovered : undefined,
      trainPassed,
      validAllowed: input.phase === 'train' ? trainPassed : input.trainReport?.gates.validAllowed === true,
    },
  }
  await writeValidationReport(input.config, report, input.reportFileName)
  return report
}
