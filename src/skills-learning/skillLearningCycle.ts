import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { SkillLearningConfig } from './config.js'
import { indexArtifacts } from './artifactIndex.js'
import { buildEvidencePackages } from './evidenceBuilder.js'
import { readTrajectory } from './trajectoryReader.js'
import { scanRunRoots } from './runScanner.js'
import type { EvidencePackage, EvidenceRunInput, RunIndexEntry } from './types.js'
import { runLearningAgent, type LearningAgentTransport } from './agent/learningSubagentRunner.js'
import { critiqueSkillCandidate } from './skillCritic.js'
import { validateSkillCandidate, type SkillCandidate } from './skillCandidateSchema.js'
import { addCandidateToPool, loadSkillPool, pruneSkillPool, writeSkillPool } from './skillPool.js'
import { renderActiveSkills } from './skillRenderer.js'
import type { EvaluationSkillOptions } from '../harness/evaluation/types.js'
import {
  loadValidationReportFile,
  loadValidationReport,
  buildValidationConfigFingerprint,
  runSkillValidation,
  type SkillValidationReport,
  type ValidationTaskResult,
  type ValidationEvaluator,
} from './validationRunner.js'

export type LearnCycleCandidatesOptions = {
  transport?: LearningAgentTransport
}

export type ValidateCycleOptions = {
  evaluate?: ValidationEvaluator
}

export const TRAIN_FAILED_REPORT_FILE = 'train-failed-report.json'

export type RefineFailedCycleOptions = {
  transport?: LearningAgentTransport
}

export type RefineFailedCycleResult = {
  revised: SkillCandidate[]
  rejected: Array<{ taskId: string; id?: string; findings: string[] }>
  refinedTasks: string[]
  skippedTasks: Array<{ taskId: string; reason: string }>
  policyRejectedPoolSkills: Array<{ id: string; findings: string[] }>
}

function roleForEvidence(evidence: unknown): Parameters<typeof runLearningAgent>[0]['role'] {
  const kind = evidence && typeof evidence === 'object' && 'kind' in evidence ? String(evidence.kind) : ''
  if (kind === 'success-vs-failure') return 'success-failure-comparator'
  if (kind === 'failure-vs-std-code') return 'std-code-comparator'
  return 'trajectory-analyst'
}

function safeEvidenceName(pkg: EvidencePackage): string {
  return `${pkg.taskId}-${pkg.kind}.json`
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function isSuccessfulRun(run: RunIndexEntry): boolean {
  return run.status === 'success' || run.reward >= 1
}

function asValidationActive(skill: SkillCandidate): SkillCandidate {
  return {
    ...skill,
    validation: {
      ...skill.validation,
      status: 'active',
    },
  }
}

function sortSkillsForApplication(skills: SkillCandidate[]): SkillCandidate[] {
  return [...skills].sort((a, b) => {
    const delta = b.validation.success_delta - a.validation.success_delta
    if (delta !== 0) return delta
    return a.id.localeCompare(b.id)
  })
}

function selectCandidatesForValidation(poolSkills: SkillCandidate[]): SkillCandidate[] {
  return sortSkillsForApplication(poolSkills.filter(skill => skill.validation.status === 'candidate'))
}

function selectActiveForValidation(
  poolSkills: SkillCandidate[],
  config: SkillLearningConfig,
  candidateCount: number,
): SkillCandidate[] {
  const activeSlots = Math.max(0, config.limits.maxActiveSkillsAppliedPerRun - candidateCount)
  return sortSkillsForApplication(
    poolSkills.filter(skill => skill.validation.status === 'active' && skill.validation.regressions === 0),
  ).slice(0, activeSlots)
}

type KnownBaselineFromEvidence = {
  results: ValidationTaskResult[]
  previouslySuccessfulTaskIds: string[]
  previouslyFailedTaskIds: string[]
}

async function loadKnownTrainBaselineFromEvidence(
  config: SkillLearningConfig,
  cycleId: string,
): Promise<KnownBaselineFromEvidence | undefined> {
  const evidenceDir = join(config.paths.workDir, 'evidence', cycleId)
  const trainTasks = new Set(config.tasks.train)
  const successful = new Set<string>()
  const failed = new Set<string>()

  let entries: string[]
  try {
    entries = await readdir(evidenceDir)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }

  for (const entry of entries.filter(name => name.endsWith('.json'))) {
    const raw = JSON.parse(await readFile(join(evidenceDir, entry), 'utf8')) as Partial<EvidencePackage>
    if (!raw.taskId || !trainTasks.has(raw.taskId)) continue
    if (raw.kind === 'success' || raw.kind === 'success-vs-failure') {
      successful.add(raw.taskId)
    }
    if (raw.kind === 'failure-vs-std-code' || raw.kind === 'success-vs-failure') {
      failed.add(raw.taskId)
    }
  }

  if (!config.tasks.train.every(taskId => successful.has(taskId) || failed.has(taskId))) {
    return undefined
  }

  return {
    results: config.tasks.train.map(taskId => (
      successful.has(taskId)
        ? { taskId, status: 'success', reward: 1 }
        : { taskId, status: 'failed', reward: 0 }
    )),
    previouslySuccessfulTaskIds: config.tasks.train.filter(taskId => successful.has(taskId)),
    previouslyFailedTaskIds: config.tasks.train.filter(taskId => failed.has(taskId)),
  }
}

async function buildRunInput(config: SkillLearningConfig, run: RunIndexEntry): Promise<EvidenceRunInput> {
  return {
    run,
    records: await readTrajectory(run.trajectoryPath),
    artifacts: await indexArtifacts(run.runDir, config.paths.tasksDir, run.taskId),
  }
}

export async function indexCycleEvidence(config: SkillLearningConfig, cycleId: string): Promise<EvidencePackage[]> {
  const trainTasks = new Set(config.tasks.train)
  const runs = (await scanRunRoots(config.paths.runRoots)).filter(run => trainTasks.has(run.taskId))
  const byTask = new Map<string, RunIndexEntry[]>()
  for (const run of runs) byTask.set(run.taskId, [...(byTask.get(run.taskId) ?? []), run])

  const packages: EvidencePackage[] = []
  const evidenceDir = join(config.paths.workDir, 'evidence', cycleId)
  await mkdir(evidenceDir, { recursive: true })
  for (const [taskId, taskRuns] of [...byTask.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const runInputs = await Promise.all(taskRuns.map(run => buildRunInput(config, run)))
    const successes = runInputs.filter(input => isSuccessfulRun(input.run))
    const failures = runInputs.filter(input => !isSuccessfulRun(input.run))
    for (const pkg of buildEvidencePackages({ taskId, successes, failures })) {
      packages.push(pkg)
      await writeJson(join(evidenceDir, safeEvidenceName(pkg)), pkg)
    }
  }
  return packages
}

async function readJsonFiles(dir: string): Promise<unknown[]> {
  return (await readJsonFileEntries(dir)).map(entry => entry.value)
}

async function readJsonFileEntries(dir: string): Promise<Array<{ name: string; value: unknown }>> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const values: Array<{ name: string; value: unknown }> = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    values.push({
      name: entry.name,
      value: JSON.parse(await readFile(join(dir, entry.name), 'utf8')),
    })
  }
  return values
}

function evidenceField(evidence: unknown, name: string): string | undefined {
  if (!evidence || typeof evidence !== 'object' || !(name in evidence)) return undefined
  return String((evidence as Record<string, unknown>)[name])
}

function withLearningBudget(
  evidence: unknown,
  taskId: string,
  acceptedForTask: number,
  perTaskLimit: number,
): unknown {
  const skillLearningBudget = {
    maxNewSkillsPerTask: perTaskLimit,
    acceptedCandidateCountForTask: acceptedForTask,
    remainingCandidateSlotsForTask: Math.max(0, perTaskLimit - acceptedForTask),
    instruction: 'Submit no more candidate skills for this task than remainingCandidateSlotsForTask.',
  }
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    return { ...(evidence as Record<string, unknown>), skillLearningBudget }
  }
  return { taskId, evidence, skillLearningBudget }
}

function evidenceRunIds(evidence: unknown): string[] {
  if (!evidence || typeof evidence !== 'object' || !('runIds' in evidence)) return []
  const rawRunIds = (evidence as { runIds?: unknown }).runIds
  if (!Array.isArray(rawRunIds)) return []
  return rawRunIds.filter((runId): runId is string => typeof runId === 'string' && runId.trim() !== '')
}

function groundCandidateEvidenceRuns(
  candidate: SkillCandidate,
  allowedRunIds: string[],
): { candidate: SkillCandidate; correction?: { id: string; from: string[]; to: string[] } } {
  if (allowedRunIds.length === 0) return { candidate }
  const allowed = new Set(allowedRunIds)
  const grounded = candidate.evidence_runs.filter(runId => allowed.has(runId))
  const nextRuns = grounded.length > 0 ? grounded : allowedRunIds
  if (
    nextRuns.length === candidate.evidence_runs.length &&
    nextRuns.every((runId, index) => runId === candidate.evidence_runs[index])
  ) {
    return { candidate }
  }
  return {
    candidate: { ...candidate, evidence_runs: nextRuns },
    correction: { id: candidate.id, from: candidate.evidence_runs, to: nextRuns },
  }
}

async function loadRunTaskIdsFromEvidence(
  config: SkillLearningConfig,
  cycleId: string,
): Promise<Map<string, string>> {
  const evidenceDir = join(config.paths.workDir, 'evidence', cycleId)
  const runTaskIds = new Map<string, string>()
  for (const entry of await readJsonFileEntries(evidenceDir)) {
    const evidence = entry.value
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue
    const taskId = evidenceField(evidence, 'taskId')
    const runIds = (evidence as Partial<EvidencePackage>).runIds
    if (!taskId || !Array.isArray(runIds)) continue
    for (const runId of runIds) {
      if (typeof runId === 'string' && runId.trim()) {
        runTaskIds.set(runId, taskId)
      }
    }
  }
  return runTaskIds
}

function originTasksForSkill(
  skill: SkillCandidate,
  taskIds: string[],
  runTaskIds: Map<string, string>,
): string[] {
  const configuredTasks = new Set(taskIds)
  const origins = new Set<string>()
  for (const runId of skill.evidence_runs) {
    const mappedTask = runTaskIds.get(runId)
    if (mappedTask && configuredTasks.has(mappedTask)) {
      origins.add(mappedTask)
    }
    if (configuredTasks.has(runId)) {
      origins.add(runId)
    }
  }
  return [...origins].sort((a, b) => taskIds.indexOf(a) - taskIds.indexOf(b))
}

function buildTrainSkillExposure(input: {
  taskIds: string[]
  skillsDir: string
  additionalSkillsDirs: string[]
  active: SkillCandidate[]
  candidates: SkillCandidate[]
  runTaskIds: Map<string, string>
}): {
  skillOptionsByTaskId: Record<string, EvaluationSkillOptions>
  exposureByTask: Record<string, string[]>
  candidateCoverage: Record<string, string[]>
} {
  const exposureSets = new Map(input.taskIds.map(taskId => [taskId, new Set<string>()]))
  const candidateCoverage: Record<string, string[]> = {}
  const exposeSkill = (skill: SkillCandidate, coverage?: Record<string, string[]>): void => {
    const taskIds =
      skill.type === 'general'
        ? input.taskIds
        : originTasksForSkill(skill, input.taskIds, input.runTaskIds)
    if (coverage) coverage[skill.id] = taskIds
    for (const taskId of taskIds) {
      exposureSets.get(taskId)?.add(skill.id)
    }
  }

  for (const skill of input.active) exposeSkill(skill)
  for (const skill of input.candidates) exposeSkill(skill, candidateCoverage)

  const exposureByTask: Record<string, string[]> = {}
  const skillOptionsByTaskId: Record<string, EvaluationSkillOptions> = {}
  for (const taskId of input.taskIds) {
    const allowedSkillNames = [...(exposureSets.get(taskId) ?? [])]
    exposureByTask[taskId] = allowedSkillNames
    skillOptionsByTaskId[taskId] = allowedSkillNames.length > 0
      ? {
          enabled: true,
          mode: 'native',
          skillsDir: input.skillsDir,
          additionalSkillsDirs: input.additionalSkillsDirs,
          allowedSkillNames,
          maxActiveSkills: allowedSkillNames.length,
        }
      : {
          enabled: false,
          mode: 'native',
          skillsDir: input.skillsDir,
        }
  }

  return { skillOptionsByTaskId, exposureByTask, candidateCoverage }
}

function isValidationSuccess(status: string | undefined): boolean {
  return status === 'success'
}

type FailedSkillTaskSelection = {
  taskIds: string[]
  skippedTasks: Array<{ taskId: string; reason: string; source?: string }>
}

function failedSkillTaskIds(report: SkillValidationReport, config: SkillLearningConfig): FailedSkillTaskSelection {
  const trainTasks = new Set(config.tasks.train)
  const taskIds: string[] = []
  const skippedTasks: Array<{ taskId: string; reason: string; source?: string }> = []
  for (const result of report.skills) {
    if (isValidationSuccess(result.status)) continue
    if (!trainTasks.has(result.taskId)) {
      skippedTasks.push({
        taskId: result.taskId,
        reason: 'task is not configured in current train set',
      })
      continue
    }
    taskIds.push(result.taskId)
  }
  return { taskIds, skippedTasks }
}

function reportTaskIds(report: SkillValidationReport): string[] {
  return [...new Set([
    ...report.baseline.map(result => result.taskId),
    ...(report.active ?? []).map(result => result.taskId),
    ...report.skills.map(result => result.taskId),
    ...(report.scope?.taskIds ?? []),
  ])]
}

async function staleReportReason(
  config: SkillLearningConfig,
  report: SkillValidationReport,
  expectedFingerprint: string,
): Promise<string | undefined> {
  if (report.configFingerprint && report.configFingerprint !== expectedFingerprint) {
    return 'config fingerprint mismatch'
  }
  const trainTasks = new Set(config.tasks.train)
  const outsideTrain = reportTaskIds(report).filter(taskId => !trainTasks.has(taskId))
  const failedSelection = failedSkillTaskIds(report, config)
  if (!report.configFingerprint && outsideTrain.length > 0 && failedSelection.taskIds.length === 0) {
    return `legacy report has no failed tasks in current train set; outside tasks: ${outsideTrain.join(', ')}`
  }
  return undefined
}

function filterBaselineForTasks(
  report: SkillValidationReport,
  taskIds: string[],
): KnownBaselineFromEvidence | undefined {
  const taskSet = new Set(taskIds)
  const results = report.baseline.filter(result => taskSet.has(result.taskId))
  if (results.length !== taskIds.length) return undefined
  const statusByTask = new Map(results.map(result => [result.taskId, result.status]))
  return {
    results: taskIds.map(taskId => results.find(result => result.taskId === taskId) ?? {
      taskId,
      status: 'failed',
      reward: 0,
    }),
    previouslySuccessfulTaskIds: taskIds.filter(taskId => isValidationSuccess(statusByTask.get(taskId))),
    previouslyFailedTaskIds: taskIds.filter(taskId => !isValidationSuccess(statusByTask.get(taskId))),
  }
}

async function loadLatestTrainReportForRefinement(
  config: SkillLearningConfig,
  cycleId: string,
): Promise<{
  report: SkillValidationReport
  source: string
  staleReportsIgnored: Array<{ source: string; reason: string }>
}> {
  const canonical = await loadValidationReport(config, cycleId, 'train')
  const canonicalPath = join(config.paths.workDir, 'validation', cycleId, 'train-report.json')
  const failedPath = join(config.paths.workDir, 'validation', cycleId, TRAIN_FAILED_REPORT_FILE)
  const expectedFingerprint = await buildValidationConfigFingerprint(config)
  const staleReportsIgnored: Array<{ source: string; reason: string }> = []
  try {
    const [canonicalStat, failedStat] = await Promise.all([stat(canonicalPath), stat(failedPath)])
    if (failedStat.mtimeMs > canonicalStat.mtimeMs) {
      const failedReport = await loadValidationReportFile(config, cycleId, TRAIN_FAILED_REPORT_FILE)
      const reason = await staleReportReason(config, failedReport, expectedFingerprint)
      if (reason) {
        staleReportsIgnored.push({ source: TRAIN_FAILED_REPORT_FILE, reason })
      } else {
        return {
          report: failedReport,
          source: TRAIN_FAILED_REPORT_FILE,
          staleReportsIgnored,
        }
      }
    }
  } catch {
    // Missing failed-only report is expected before the first refinement iteration.
  }
  const canonicalReason = await staleReportReason(config, canonical, expectedFingerprint)
  if (canonicalReason && canonical.configFingerprint) {
    throw new Error(`stale train-report.json: ${canonicalReason}`)
  }
  return { report: canonical, source: 'train-report.json', staleReportsIgnored }
}

function recoveredTaskIdsInReport(report: SkillValidationReport, config: SkillLearningConfig): string[] {
  const trainTasks = new Set(config.tasks.train)
  const recovered = new Set<string>()
  for (const result of report.skills) {
    if (trainTasks.has(result.taskId) && isValidationSuccess(result.status)) recovered.add(result.taskId)
  }
  for (const [taskId, isRecovered] of Object.entries(report.proof?.recoveredByTask ?? {})) {
    if (isRecovered && trainTasks.has(taskId)) recovered.add(taskId)
  }
  return [...recovered]
}

async function loadRecoveredTaskIdsFromCompatibleReports(
  config: SkillLearningConfig,
  cycleId: string,
): Promise<Map<string, string>> {
  const expectedFingerprint = await buildValidationConfigFingerprint(config)
  const reports: Array<{ source: string; report: SkillValidationReport }> = []
  try {
    reports.push({ source: 'train-report.json', report: await loadValidationReport(config, cycleId, 'train') })
  } catch {
    // Missing canonical report is handled by callers that require refinement evidence.
  }
  try {
    reports.push({
      source: TRAIN_FAILED_REPORT_FILE,
      report: await loadValidationReportFile(config, cycleId, TRAIN_FAILED_REPORT_FILE),
    })
  } catch {
    // No failed-only report exists before the first focused validation.
  }

  const recovered = new Map<string, string>()
  for (const { source, report } of reports) {
    if (await staleReportReason(config, report, expectedFingerprint)) continue
    for (const taskId of recoveredTaskIdsInReport(report, config)) recovered.set(taskId, source)
  }
  return recovered
}

async function skipAlreadyRecoveredTasks(
  config: SkillLearningConfig,
  cycleId: string,
  selection: FailedSkillTaskSelection,
): Promise<FailedSkillTaskSelection> {
  if (!config.limits.skipAlreadyRecoveredTasks) return selection
  const recovered = await loadRecoveredTaskIdsFromCompatibleReports(config, cycleId)
  if (recovered.size === 0) return selection
  const taskIds: string[] = []
  const skippedTasks = [...selection.skippedTasks]
  for (const taskId of selection.taskIds) {
    const recoveredSource = recovered.get(taskId)
    if (recoveredSource) {
      skippedTasks.push({
        taskId,
        reason: 'already recovered in a compatible validation report',
        source: recoveredSource,
      })
    } else {
      taskIds.push(taskId)
    }
  }
  return { taskIds, skippedTasks }
}

async function latestValidationRunArtifacts(
  config: SkillLearningConfig,
  cycleId: string,
  taskId: string,
): Promise<Record<string, string | undefined>> {
  const runsDir = join(config.paths.workDir, 'validation', cycleId, 'train-skills-runs')
  let entries
  try {
    entries = await readdir(runsDir, { withFileTypes: true })
  } catch {
    return {}
  }
  const latest = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(`${taskId}_`))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .at(-1)
  if (!latest) return {}
  const runDir = join(runsDir, latest)
  return {
    runDir,
    cleanTrajectoryPath: join(runDir, 'logs', 'trajectory.clean.jsonl'),
    rawTrajectoryPath: join(runDir, 'logs', 'trajectory.raw.jsonl'),
    runSummaryPath: join(runDir, 'logs', 'run_summary.json'),
  }
}

function mergeSkillRevision(existing: SkillCandidate, revision: SkillCandidate): SkillCandidate {
  return {
    ...revision,
    evidence_runs: [...new Set([...existing.evidence_runs, ...revision.evidence_runs])],
    validation: {
      ...revision.validation,
      status: 'candidate',
      regressions: 0,
    },
  }
}

function exposedSkillIdsForFailedTask(report: SkillValidationReport, taskId: string): string[] {
  const explicit = report.skillRun?.exposureByTask?.[taskId]
  if (explicit && explicit.length > 0) return explicit
  const coverage = report.skillRun?.candidateCoverage ?? {}
  return Object.entries(coverage)
    .filter(([, taskIds]) => taskIds.includes(taskId))
    .map(([skillId]) => skillId)
}

async function loadCycleCandidateArtifact(
  config: SkillLearningConfig,
  cycleId: string,
  skillId: string,
): Promise<SkillCandidate | undefined> {
  try {
    const raw = JSON.parse(
      await readFile(join(config.paths.workDir, 'candidates', cycleId, `${skillId}.json`), 'utf8'),
    )
    return validateSkillCandidate(raw).candidate
  } catch {
    return undefined
  }
}

async function exposedSkillsForRefinement(
  config: SkillLearningConfig,
  cycleId: string,
  pool: Awaited<ReturnType<typeof loadSkillPool>>,
  exposedSkillIds: string[],
): Promise<SkillCandidate[]> {
  const skills: SkillCandidate[] = []
  const seen = new Set<string>()
  for (const skillId of exposedSkillIds) {
    const skill = pool.skills[skillId] ?? await loadCycleCandidateArtifact(config, cycleId, skillId)
    if (!skill || seen.has(skill.id)) continue
    skills.push(skill)
    seen.add(skill.id)
  }
  return skills
}

function pathTerms(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  const normalized = value.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return [normalized, parts.at(-1) ?? ''].filter(term => term.length >= 4)
}

async function loadProofForbiddenTerms(config: SkillLearningConfig): Promise<string[]> {
  const manifestPath = config.proof?.lockedBaselineManifestPath
  if (!manifestPath) return []
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { tasks?: Array<Record<string, unknown>> }
    const terms = new Set<string>()
    for (const task of manifest.tasks ?? []) {
      for (const key of ['runDir', 'summaryPath', 'trajectoryPath']) {
        for (const term of pathTerms(task[key])) terms.add(term)
      }
    }
    return [...terms]
  } catch {
    return []
  }
}

function runBasename(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1)
}

async function loadProofBaselineRunIds(config: SkillLearningConfig): Promise<Set<string>> {
  const manifestPath = config.proof?.lockedBaselineManifestPath
  const runIds = new Set<string>()
  if (!manifestPath) return runIds
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { tasks?: Array<Record<string, unknown>> }
    for (const task of manifest.tasks ?? []) {
      const runId = runBasename(task.runDir)
      if (runId) runIds.add(runId)
    }
  } catch {
    return new Set()
  }
  return runIds
}

async function staleProofCandidateIds(
  config: SkillLearningConfig,
  pool: Awaited<ReturnType<typeof loadSkillPool>>,
  currentCandidateIds: Set<string>,
): Promise<string[]> {
  const proofRunIds = await loadProofBaselineRunIds(config)
  if (proofRunIds.size === 0) return []
  const stale: string[] = []
  for (const skill of Object.values(pool.skills)) {
    if (currentCandidateIds.has(skill.id)) continue
    if (skill.validation.status !== 'candidate') continue
    stale.push(skill.id)
  }
  return stale.sort()
}

function policyRejectedCandidatePoolSkills(
  config: SkillLearningConfig,
  pool: Awaited<ReturnType<typeof loadSkillPool>>,
  forbiddenTerms: string[],
): Array<{ id: string; findings: string[] }> {
  const skills = Object.values(pool.skills)
  const rejected: Array<{ id: string; findings: string[] }> = []
  for (const skill of skills) {
    if (skill.validation.status !== 'candidate') continue
    const critique = critiqueSkillCandidate(skill, {
      existing: skills.filter(other => other.id !== skill.id),
      taskIds: [...config.tasks.train, ...config.tasks.valid],
      forbiddenTerms,
      mode: 'revision',
    })
    const policyFindings = critique.findings.filter(finding =>
      finding.includes('forbidden proof/source term')
      || finding.includes('read or match a reference implementation')
      || finding.includes('task-specific')
      || finding.includes('stale exact epoch or iteration constant'),
    )
    if (policyFindings.length > 0) rejected.push({ id: skill.id, findings: policyFindings })
  }
  return rejected.sort((a, b) => a.id.localeCompare(b.id))
}

export async function refineFailedCycleSkills(
  config: SkillLearningConfig,
  cycleId: string,
  options: RefineFailedCycleOptions = {},
): Promise<RefineFailedCycleResult> {
  const { report, source, staleReportsIgnored } = await loadLatestTrainReportForRefinement(config, cycleId)
  let pool = await loadSkillPool(config.paths.workDir)
  const forbiddenTerms = await loadProofForbiddenTerms(config)
  const baselineByTask = new Map(report.baseline.map(result => [result.taskId, result]))
  const failedTaskSelection = await skipAlreadyRecoveredTasks(
    config,
    cycleId,
    failedSkillTaskIds(report, config),
  )
  const failedTasks = failedTaskSelection.taskIds

  const revisionsDir = join(config.paths.workDir, 'revisions', cycleId)
  const reportDir = join(config.paths.workDir, 'reports', cycleId)
  await rm(revisionsDir, { recursive: true, force: true })
  await rm(join(reportDir, 'refine-summary.json'), { force: true })
  await mkdir(revisionsDir, { recursive: true })
  await mkdir(reportDir, { recursive: true })

  const revised: SkillCandidate[] = []
  const rejected: Array<{ taskId: string; id?: string; findings: string[] }> = []
  const skippedTasks: Array<{ taskId: string; reason: string }> = [...failedTaskSelection.skippedTasks]
  const entries: Array<Record<string, unknown>> = []
  const policyRejectedPoolSkills = policyRejectedCandidatePoolSkills(config, pool, forbiddenTerms)
  let poolChanged = false
  if (policyRejectedPoolSkills.length > 0) {
    const remaining = { ...pool.skills }
    for (const rejectedSkill of policyRejectedPoolSkills) delete remaining[rejectedSkill.id]
    pool = { ...pool, skills: remaining }
    poolChanged = true
  }

  for (const taskId of failedTasks) {
    const exposedSkillIds = exposedSkillIdsForFailedTask(report, taskId)
    const existingSkills = await exposedSkillsForRefinement(config, cycleId, pool, exposedSkillIds)
    const existingById = new Map(existingSkills.map(skill => [skill.id, skill]))
    if (existingSkills.length === 0) {
      skippedTasks.push({ taskId, reason: 'no exposed skills recorded for failed validation task' })
      entries.push({ taskId, status: 'skipped', reason: 'no exposed skills recorded for failed validation task' })
      continue
    }

    const evidence = {
      kind: 'validation-failure-refinement',
      cycleId,
      taskId,
      validationReportSource: source,
      baselineResult: baselineByTask.get(taskId),
      skillResult: report.skills.find(result => result.taskId === taskId),
      exposedSkillIds,
      existingSkills,
      validationArtifacts: await latestValidationRunArtifacts(config, cycleId, taskId),
      taskPaths: {
        taskDir: join(config.paths.tasksDir, taskId),
        stdCodeDir: join(config.paths.tasksDir, taskId, 'std_code'),
      },
      refinementInstructions: [
        'Revise only exposed existing skills that likely failed to prevent this validation failure.',
        'Submit complete schema_version 2 candidate objects using the same id as the skill being revised.',
        'Use validation-failure trajectories and std_code/reference implementations for abstract corrections only.',
        'Prefer adding missing diagnostic checks, runtime budget rules, and anti-patterns over task-specific constants.',
        'If no exposed skill should be changed, submit an explicit no-candidate result with evidence.',
      ],
    }

    let result
    try {
      result = await runLearningAgent({
        role: 'skill-writer',
        evidence,
        config,
        artifactContext: {
          cycleId,
          taskId,
          evidenceFile: `${taskId}-validation-failure-refinement.json`,
        },
        transport: options.transport,
      })
    } catch (error) {
      entries.push({
        taskId,
        status: 'generation_error',
        generationError: error instanceof Error ? error.message : String(error),
        acceptedIds: [],
        rejectedIds: [],
        exposedSkillIds,
      })
      continue
    }

    const acceptedIds: string[] = []
    const rejectedIds: string[] = []
    for (const candidate of result.candidates) {
      const existing = existingById.get(candidate.id)
      if (!existing || !exposedSkillIds.includes(candidate.id)) {
        rejected.push({
          taskId,
          id: candidate.id,
          findings: ['revision candidate must reuse one of the exposed skill ids for this failed task'],
        })
        rejectedIds.push(candidate.id)
        continue
      }
      const merged = mergeSkillRevision(existing, candidate)
      const critique = critiqueSkillCandidate(merged, {
        existing: Object.values(pool.skills).filter(skill => skill.id !== merged.id),
        taskIds: [...config.tasks.train, ...config.tasks.valid],
        forbiddenTerms,
        mode: 'revision',
      })
      if (!critique.approved) {
        rejected.push({ taskId, id: candidate.id, findings: critique.findings })
        rejectedIds.push(candidate.id)
        continue
      }
      pool = {
        ...pool,
        skills: {
          ...pool.skills,
          [merged.id]: merged,
        },
      }
      poolChanged = true
      revised.push(merged)
      acceptedIds.push(merged.id)
      await writeJson(join(revisionsDir, `${merged.id}.json`), {
        taskId,
        previous: existing,
        revised: merged,
        validationArtifacts: evidence.validationArtifacts,
      })
    }
    entries.push({
      taskId,
      status: result.submissionStatus,
      acceptedIds,
      rejectedIds,
      exposedSkillIds,
      rawContent: result.rawContent,
      noCandidateReason: result.noCandidateReason,
      generationError: result.generationError,
    })
  }

  if (poolChanged) {
    await writeSkillPool(config.paths.workDir, pool)
  }
  await writeJson(join(reportDir, 'refine-summary.json'), {
    cycleId,
    validationReportSource: source,
    staleReportsIgnored,
    failedTasks,
    revised: revised.map(skill => skill.id),
    rejected,
    policyRejectedPoolSkills,
    skippedTasks,
    entries,
  })

  return { revised, rejected, refinedTasks: failedTasks, skippedTasks, policyRejectedPoolSkills }
}

export async function learnCycleCandidates(
  config: SkillLearningConfig,
  cycleId: string,
  options: LearnCycleCandidatesOptions = {},
): Promise<SkillCandidate[]> {
  const evidenceDir = join(config.paths.workDir, 'evidence', cycleId)
  const candidateDir = join(config.paths.workDir, 'candidates', cycleId)
  const reportDir = join(config.paths.workDir, 'reports', cycleId)
  const traceDir = join(reportDir, 'learn-traces')
  const artifactDir = join(reportDir, 'agent-artifacts')
  await rm(candidateDir, { recursive: true, force: true })
  await rm(traceDir, { recursive: true, force: true })
  await rm(artifactDir, { recursive: true, force: true })
  await rm(join(reportDir, 'learn-summary.json'), { force: true })
  await mkdir(candidateDir, { recursive: true })
  const learned: SkillCandidate[] = []
  const learnedByTask = new Map<string, number>()
  const trainTasks = new Set(config.tasks.train)
  const summary: Array<Record<string, unknown>> = []

  const evidenceEntries = await readJsonFileEntries(evidenceDir)
  for (const [index, entry] of evidenceEntries.entries()) {
    const evidence = entry.value
    const evidenceKind = evidenceField(evidence, 'kind')
    const role = roleForEvidence(evidence)
    const taskId = evidenceField(evidence, 'taskId') ?? entry.name
    const tracePath = join(traceDir, `${String(index + 1).padStart(3, '0')}-${entry.name}`)
    if (evidenceKind === 'failure-only') {
      await writeJson(tracePath, {
        evidenceFile: entry.name,
        evidenceKind,
        taskId,
        role,
        skipped: true,
        skipReason: 'standalone failure-only evidence is no longer a candidate learning source',
        candidateIds: [],
        acceptedCandidateIds: [],
        skippedCandidateIds: [],
        perTaskLimit: config.limits.maxNewSkillsPerTask,
      })
      summary.push({
        evidenceFile: entry.name,
        evidenceKind,
        taskId,
        role,
        status: 'skipped',
        skipReason: 'standalone failure-only evidence is no longer a candidate learning source',
        generatedCandidateCount: 0,
        acceptedCandidateCount: 0,
        skippedCandidateCount: 0,
      })
      continue
    }
    if (!trainTasks.has(taskId)) {
      await writeJson(tracePath, {
        evidenceFile: entry.name,
        evidenceKind,
        taskId,
        role,
        skipped: true,
        skipReason: 'task is not configured as a train task',
        candidateIds: [],
        acceptedCandidateIds: [],
        skippedCandidateIds: [],
        perTaskLimit: config.limits.maxNewSkillsPerTask,
      })
      summary.push({
        evidenceFile: entry.name,
        evidenceKind,
        taskId,
        role,
        status: 'skipped',
        skipReason: 'task is not configured as a train task',
        generatedCandidateCount: 0,
        acceptedCandidateCount: 0,
        skippedCandidateCount: 0,
      })
      continue
    }
    let result
    const acceptedBeforeAgent = learnedByTask.get(taskId) ?? 0
    try {
      result = await runLearningAgent({
        role,
        evidence: withLearningBudget(evidence, taskId, acceptedBeforeAgent, config.limits.maxNewSkillsPerTask),
        config,
        artifactContext: {
          cycleId,
          taskId,
          evidenceFile: entry.name,
        },
        transport: options.transport,
      })
    } catch (error) {
      await writeJson(tracePath, {
        evidenceFile: entry.name,
        evidenceKind,
        taskId,
        role,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    const acceptedCandidateIds: string[] = []
    const skippedCandidateIds: string[] = []
    const evidenceRunCorrections: Array<{ id: string; from: string[]; to: string[] }> = []
    const allowedRunIds = evidenceRunIds(evidence)
    for (const candidate of result.candidates) {
      const grounded = groundCandidateEvidenceRuns(candidate, allowedRunIds)
      if (grounded.correction) evidenceRunCorrections.push(grounded.correction)
      const groundedCandidate = grounded.candidate
      const acceptedForTask = learnedByTask.get(taskId) ?? 0
      if (acceptedForTask >= config.limits.maxNewSkillsPerTask) {
        skippedCandidateIds.push(groundedCandidate.id)
        continue
      }
      learned.push(groundedCandidate)
      learnedByTask.set(taskId, acceptedForTask + 1)
      acceptedCandidateIds.push(groundedCandidate.id)
      await writeJson(join(candidateDir, `${groundedCandidate.id}.json`), groundedCandidate)
    }
    await writeJson(tracePath, {
      evidenceFile: entry.name,
      evidenceKind,
      taskId,
      role,
      submissionStatus: result.submissionStatus,
      noCandidateReason: result.noCandidateReason,
      noCandidateEvidence: result.noCandidateEvidence,
      generationError: result.generationError,
      remainingCandidateSlotsBeforeAgent: Math.max(0, config.limits.maxNewSkillsPerTask - acceptedBeforeAgent),
      candidateIds: result.candidates.map(candidate => candidate.id),
      acceptedCandidateIds,
      skippedCandidateIds,
      evidenceRunCorrections,
      perTaskLimit: config.limits.maxNewSkillsPerTask,
      rawContent: result.rawContent,
      toolResults: result.toolResults,
    })
    summary.push({
      evidenceFile: entry.name,
      evidenceKind,
      taskId,
      role,
      status: result.submissionStatus,
      noCandidateReason: result.noCandidateReason,
      generationError: result.generationError,
      generatedCandidateCount: result.candidates.length,
      acceptedCandidateCount: acceptedCandidateIds.length,
      skippedCandidateCount: skippedCandidateIds.length,
      perTaskLimit: config.limits.maxNewSkillsPerTask,
    })
  }

  await writeJson(join(reportDir, 'learn-summary.json'), {
    cycleId,
    evidenceCount: evidenceEntries.length,
    entries: summary,
  })
  return learned
}

export async function critiqueCycleCandidates(
  config: SkillLearningConfig,
  cycleId: string,
): Promise<{
  approved: SkillCandidate[]
  rejected: Array<{ id?: string; findings: string[] }>
  prunedStaleCandidateIds: string[]
}> {
  const candidateDir = join(config.paths.workDir, 'candidates', cycleId)
  const reportDir = join(config.paths.workDir, 'reports', cycleId)
  await mkdir(reportDir, { recursive: true })
  let pool = await loadSkillPool(config.paths.workDir)
  const approved: SkillCandidate[] = []
  const rejected: Array<{ id?: string; findings: string[] }> = []
  const forbiddenTerms = await loadProofForbiddenTerms(config)
  const currentCandidateIds = new Set<string>()
  let poolChanged = false

  for (const raw of await readJsonFiles(candidateDir)) {
    const validation = validateSkillCandidate(raw)
    if (!validation.candidate) {
      rejected.push({ findings: validation.errors })
      continue
    }
    currentCandidateIds.add(validation.candidate.id)
    const critique = critiqueSkillCandidate(validation.candidate, {
      existing: Object.values(pool.skills).filter(skill => skill.id !== validation.candidate!.id),
      taskIds: [...config.tasks.train, ...config.tasks.valid],
      forbiddenTerms,
    })
    if (!critique.approved) {
      rejected.push({ id: validation.candidate.id, findings: critique.findings })
      if (pool.skills[validation.candidate.id]) {
        const { [validation.candidate.id]: _removed, ...remaining } = pool.skills
        pool = { ...pool, skills: remaining }
        poolChanged = true
      }
      continue
    }
    approved.push(validation.candidate)
    pool = await addCandidateToPool(pool, validation.candidate)
    poolChanged = true
  }

  const prunedStaleCandidateIds = await staleProofCandidateIds(config, pool, currentCandidateIds)
  if (prunedStaleCandidateIds.length > 0) {
    const remaining = { ...pool.skills }
    for (const skillId of prunedStaleCandidateIds) delete remaining[skillId]
    pool = { ...pool, skills: remaining }
    poolChanged = true
  }

  pool = pruneSkillPool(pool, config.limits.maxPoolSize)
  if (poolChanged || approved.length > 0) {
    await writeSkillPool(config.paths.workDir, pool)
  }
  await writeJson(join(reportDir, 'critic.json'), {
    approved: approved.map(candidate => candidate.id),
    rejected,
    prunedStaleCandidateIds,
  })
  return { approved, rejected, prunedStaleCandidateIds }
}

export async function validateCycleTrain(
  config: SkillLearningConfig,
  cycleId: string,
  options: ValidateCycleOptions = {},
): Promise<SkillValidationReport> {
  const pool = await loadSkillPool(config.paths.workDir)
  const poolSkills = Object.values(pool.skills)
  const candidates = selectCandidatesForValidation(poolSkills)
  const active = selectActiveForValidation(poolSkills, config, candidates.length)
  const candidateSkillsDir = join(config.paths.workDir, 'validation', cycleId, 'candidate-skills', 'skills')

  if (candidates.length > 0) {
    await renderActiveSkills(candidateSkillsDir, candidates.map(asValidationActive), { cleanObsolete: true })
  }

  const allowedSkillNames = [...active.map(skill => skill.id), ...candidates.map(skill => skill.id)]
  const knownBaseline = await loadKnownTrainBaselineFromEvidence(config, cycleId)
  const exposure = buildTrainSkillExposure({
    taskIds: config.tasks.train,
    skillsDir: config.paths.activeSkillsDir,
    additionalSkillsDirs: candidates.length > 0 ? [candidateSkillsDir] : [],
    active,
    candidates,
    runTaskIds: await loadRunTaskIdsFromEvidence(config, cycleId),
  })
  return runSkillValidation({
    config,
    cycleId,
    phase: 'train',
    knownBaselineResults: knownBaseline?.results,
    previouslySuccessfulTaskIds: knownBaseline?.previouslySuccessfulTaskIds,
    previouslyFailedTaskIds: knownBaseline?.previouslyFailedTaskIds,
    additionalSkillsDirs: candidates.length > 0 ? [candidateSkillsDir] : [],
    allowedSkillNames: allowedSkillNames.length > 0 ? allowedSkillNames : undefined,
    skillOptionsByTaskId: exposure.skillOptionsByTaskId,
    exposureByTask: exposure.exposureByTask,
    candidateCoverage: exposure.candidateCoverage,
    activeSkillIdsUnderTest: active.map(skill => skill.id),
    candidateSkillIdsUnderTest: candidates.map(skill => skill.id),
    maxActiveSkills: allowedSkillNames.length > 0 ? allowedSkillNames.length : undefined,
    evaluate: options.evaluate,
  })
}

export async function validateFailedCycleTrain(
  config: SkillLearningConfig,
  cycleId: string,
  options: ValidateCycleOptions = {},
): Promise<SkillValidationReport> {
  const { report: sourceReport, source, staleReportsIgnored } = await loadLatestTrainReportForRefinement(config, cycleId)
  const failedTaskSelection = await skipAlreadyRecoveredTasks(
    config,
    cycleId,
    failedSkillTaskIds(sourceReport, config),
  )
  const failedTaskIds = failedTaskSelection.taskIds
  const pool = await loadSkillPool(config.paths.workDir)
  const poolSkills = Object.values(pool.skills)
  const candidates = selectCandidatesForValidation(poolSkills)
  const active = selectActiveForValidation(poolSkills, config, candidates.length)
  const candidateSkillsDir = join(config.paths.workDir, 'validation', cycleId, 'candidate-skills', 'skills')

  if (candidates.length > 0) {
    await renderActiveSkills(candidateSkillsDir, candidates.map(asValidationActive), { cleanObsolete: true })
  }

  const allowedSkillNames = [...active.map(skill => skill.id), ...candidates.map(skill => skill.id)]
  const knownBaseline = filterBaselineForTasks(sourceReport, failedTaskIds)
  const exposure = buildTrainSkillExposure({
    taskIds: failedTaskIds,
    skillsDir: config.paths.activeSkillsDir,
    additionalSkillsDirs: candidates.length > 0 ? [candidateSkillsDir] : [],
    active,
    candidates,
    runTaskIds: await loadRunTaskIdsFromEvidence(config, cycleId),
  })

  return runSkillValidation({
    config,
    cycleId,
    phase: 'train',
    taskIds: failedTaskIds,
    reportFileName: TRAIN_FAILED_REPORT_FILE,
    scope: {
      taskIds: failedTaskIds,
      source,
      reason: 'failed skills-run tasks from latest train validation report',
    },
    staleReportsIgnored: [
      ...staleReportsIgnored,
      ...failedTaskSelection.skippedTasks.map(skipped => ({
        source: skipped.source ?? source,
        reason: `${skipped.taskId}: ${skipped.reason}`,
      })),
    ],
    knownBaselineResults: knownBaseline?.results,
    previouslySuccessfulTaskIds: knownBaseline?.previouslySuccessfulTaskIds,
    previouslyFailedTaskIds: knownBaseline?.previouslyFailedTaskIds,
    additionalSkillsDirs: candidates.length > 0 ? [candidateSkillsDir] : [],
    allowedSkillNames: allowedSkillNames.length > 0 ? allowedSkillNames : undefined,
    skillOptionsByTaskId: exposure.skillOptionsByTaskId,
    exposureByTask: exposure.exposureByTask,
    candidateCoverage: exposure.candidateCoverage,
    activeSkillIdsUnderTest: active.map(skill => skill.id),
    candidateSkillIdsUnderTest: candidates.map(skill => skill.id),
    maxActiveSkills: allowedSkillNames.length > 0 ? allowedSkillNames.length : undefined,
    evaluate: options.evaluate,
  })
}

export async function validateCycleValid(
  config: SkillLearningConfig,
  cycleId: string,
  options: ValidateCycleOptions = {},
): Promise<SkillValidationReport> {
  const trainReport = await loadValidationReport(config, cycleId, 'train')
  const pool = await loadSkillPool(config.paths.workDir)
  const active = selectActiveForValidation(Object.values(pool.skills), config, 0)

  return runSkillValidation({
    config,
    cycleId,
    phase: 'valid',
    trainReport,
    allowedSkillNames: active.length > 0 ? active.map(skill => skill.id) : undefined,
    activeSkillIdsUnderTest: active.map(skill => skill.id),
    maxActiveSkills: active.length > 0 ? active.length : undefined,
    evaluate: options.evaluate,
  })
}

export async function activateValidatedSkills(config: SkillLearningConfig, cycleId: string): Promise<SkillCandidate[]> {
  const validation = await loadValidationReport(config, cycleId, 'train')
  if (!validation.gates.validAllowed) {
    if (!validation.gates.noRegression || validation.gates.activeNoRegression === false) {
      await quarantineActiveSkillsAfterRegression(config, cycleId)
    }
    throw new Error('train validation gates did not pass; refusing to activate skills')
  }
  const validatedCandidateIds = new Set(validation.skillRun?.candidateSkillIds ?? [])
  if (validatedCandidateIds.size === 0) return []

  let pool = await loadSkillPool(config.paths.workDir)
  const activated: SkillCandidate[] = []
  for (const skill of Object.values(pool.skills)) {
    if (activated.length >= config.limits.maxNewSkillsPerCycle) break
    if (skill.validation.status !== 'candidate') continue
    if (!validatedCandidateIds.has(skill.id)) continue
    const active = {
      ...skill,
      validation: {
        ...skill.validation,
        status: 'active' as const,
      },
    }
    pool = {
      ...pool,
      skills: {
        ...pool.skills,
        [skill.id]: active,
      },
    }
    activated.push(active)
  }
  pool = pruneSkillPool(pool, config.limits.maxPoolSize)
  await writeSkillPool(config.paths.workDir, pool)
  await renderActiveSkills(config.paths.activeSkillsDir, Object.values(pool.skills), { cleanObsolete: true })
  return activated
}

export async function quarantineActiveSkillsAfterRegression(
  config: SkillLearningConfig,
  cycleId: string,
): Promise<SkillCandidate[]> {
  const validation = await loadValidationReport(config, cycleId, 'train')
  if (validation.gates.noRegression && validation.gates.activeNoRegression !== false) return []

  let pool = await loadSkillPool(config.paths.workDir)
  const candidateIds = validation.skillRun?.candidateSkillIds ?? []
  const activeIds = validation.skillRun?.activeSkillIds ?? []
  const targetIds =
    validation.gates.activeNoRegression === false && activeIds.length > 0
      ? new Set(activeIds)
      : candidateIds.length > 0
        ? new Set(candidateIds)
        : activeIds.length > 0
          ? new Set(activeIds)
          : new Set<string>()
  if (targetIds.size === 0) {
    throw new Error('validation report lacks skillRun attribution; refusing broad quarantine')
  }
  const quarantined: SkillCandidate[] = []
  const quarantineDir = join(config.paths.workDir, 'quarantine', cycleId)
  await mkdir(quarantineDir, { recursive: true })

  for (const skill of Object.values(pool.skills)) {
    if (!targetIds.has(skill.id)) continue
    if (skill.validation.status !== 'active' && skill.validation.status !== 'candidate') continue
    const quarantinedSkill = {
      ...skill,
      validation: {
        ...skill.validation,
        status: 'quarantine' as const,
        regressions: skill.validation.regressions + 1,
      },
    }
    pool = {
      ...pool,
      skills: {
        ...pool.skills,
        [skill.id]: quarantinedSkill,
      },
    }
    quarantined.push(quarantinedSkill)
    await writeJson(join(quarantineDir, `${skill.id}.json`), {
      skill: quarantinedSkill,
      validation,
    })
  }

  await writeSkillPool(config.paths.workDir, pool)
  await renderActiveSkills(config.paths.activeSkillsDir, Object.values(pool.skills), { cleanObsolete: true })
  return quarantined
}

export async function writeCycleReport(config: SkillLearningConfig, cycleId: string): Promise<void> {
  const pool = await loadSkillPool(config.paths.workDir)
  const cycleDir = join(config.paths.workDir, 'cycles', cycleId)
  await mkdir(cycleDir, { recursive: true })
  await writeJson(join(cycleDir, 'report.json'), {
    cycleId,
    activeSkills: Object.values(pool.skills)
      .filter(skill => skill.validation.status === 'active')
      .map(skill => skill.id),
    candidateCount: Object.values(pool.skills).filter(skill => skill.validation.status === 'candidate').length,
    poolSize: Object.keys(pool.skills).length,
    latestPoolFile: basename(join(config.paths.workDir, 'pool.json')),
  })
}
