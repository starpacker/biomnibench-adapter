import { readFile } from 'fs/promises'
import type { EvaluationContextProfile } from '../harness/evaluation/types.js'

export type SkillLearningLlmProvider = 'openai-compatible' | 'openai' | 'anthropic'

export type ValidationTaskOverride = {
  maxRounds?: number
  timeoutSeconds?: number
  maxBashTimeoutMs?: number
}

export type SkillLearningConfig = {
  contextProfile?: EvaluationContextProfile
  runMemory?: boolean
  includeClaudeDefaultUserContext?: boolean
  proof?: {
    lockedBaselineManifestPath?: string
  }
  llm: {
    provider: SkillLearningLlmProvider
    baseUrlEnv: string
    apiKeyEnv: string
    model: string
    temperature: number
  }
  paths: {
    tasksDir: string
    runRoots: string[]
    activeSkillsDir: string
    workDir: string
  }
  limits: {
    maxNewSkillsPerCycle: number
    maxNewSkillsPerTask: number
    maxPoolSize: number
    maxActiveSkillsAppliedPerRun: number
    validationConcurrency: number
    validationMaxRounds: number
    validationTimeoutSeconds: number
    validationMaxBashTimeoutMs: number
    validationDisableGpu: boolean
    skipAlreadyRecoveredTasks: boolean
    validationTaskOverrides?: Record<string, ValidationTaskOverride>
  }
  tasks: {
    train: string[]
    valid: string[]
  }
  policy: {
    autoActivateAfterTrainValidation: boolean
    requireNoRegressionOnPreviouslySuccessful: boolean
    allowStdCodeForLearning: boolean
    allowStdCodeForApplication: boolean
    skillToolMode: 'native-only'
  }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  return value
}

function expectPositiveInteger(value: unknown, path: string): number {
  const parsed = expectNumber(value, path)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${path} must be a positive integer`)
  }
  return parsed
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function expectContextProfile(value: unknown, path: string): EvaluationContextProfile {
  const profile = expectString(value, path)
  if (
    profile !== 'eval-minimal' &&
    profile !== 'eval-safe-claude-parity' &&
    profile !== 'full-claude-unsafe'
  ) {
    throw new Error(`${path} must be eval-minimal, eval-safe-claude-parity, or full-claude-unsafe, got: ${profile}`)
  }
  if (profile === 'full-claude-unsafe') {
    throw new Error(`${path} full-claude-unsafe is not allowed in skill-learning configs; use direct CLI debugging with --allow-unsafe-context instead`)
  }
  return profile
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${path} must be an array of non-empty strings`)
  }
  return value
}

function parseValidationTaskOverrides(value: unknown, path: string): Record<string, ValidationTaskOverride> | undefined {
  if (value === undefined) return undefined
  const root = expectObject(value, path)
  const overrides: Record<string, ValidationTaskOverride> = {}
  for (const [taskId, rawOverride] of Object.entries(root)) {
    if (!taskId.trim()) throw new Error(`${path} task ids must be non-empty`)
    const override = expectObject(rawOverride, `${path}.${taskId}`)
    const parsed: ValidationTaskOverride = {}
    if (override.maxRounds !== undefined) {
      parsed.maxRounds = expectPositiveInteger(override.maxRounds, `${path}.${taskId}.maxRounds`)
    }
    if (override.timeoutSeconds !== undefined) {
      parsed.timeoutSeconds = expectPositiveInteger(override.timeoutSeconds, `${path}.${taskId}.timeoutSeconds`)
    }
    if (override.maxBashTimeoutMs !== undefined) {
      parsed.maxBashTimeoutMs = expectPositiveInteger(override.maxBashTimeoutMs, `${path}.${taskId}.maxBashTimeoutMs`)
    }
    overrides[taskId] = parsed
  }
  return overrides
}

export function parseSkillLearningConfig(raw: unknown): SkillLearningConfig {
  const root = expectObject(raw, 'config')
  const llm = expectObject(root.llm, 'llm')
  const paths = expectObject(root.paths, 'paths')
  const limits = expectObject(root.limits, 'limits')
  const tasks = expectObject(root.tasks, 'tasks')
  const policy = expectObject(root.policy, 'policy')
  const provider = expectString(llm.provider, 'llm.provider')
  if (provider !== 'openai-compatible' && provider !== 'openai' && provider !== 'anthropic') {
    throw new Error(`llm.provider must be openai-compatible, openai, or anthropic, got: ${provider}`)
  }
  const skillToolMode = expectString(policy.skillToolMode, 'policy.skillToolMode')
  if (skillToolMode !== 'native-only') {
    throw new Error(`policy.skillToolMode must be native-only, got: ${skillToolMode}`)
  }

  const maxNewSkillsPerCycle = expectPositiveInteger(limits.maxNewSkillsPerCycle, 'limits.maxNewSkillsPerCycle')

  return {
    contextProfile:
      root.contextProfile === undefined ? undefined : expectContextProfile(root.contextProfile, 'contextProfile'),
    runMemory: root.runMemory === undefined ? undefined : expectBoolean(root.runMemory, 'runMemory'),
    includeClaudeDefaultUserContext:
      root.includeClaudeDefaultUserContext === undefined
        ? undefined
        : expectBoolean(root.includeClaudeDefaultUserContext, 'includeClaudeDefaultUserContext'),
    proof: root.proof === undefined
      ? undefined
      : {
          lockedBaselineManifestPath:
            expectObject(root.proof, 'proof').lockedBaselineManifestPath === undefined
              ? undefined
              : expectString(
                  expectObject(root.proof, 'proof').lockedBaselineManifestPath,
                  'proof.lockedBaselineManifestPath',
                ),
        },
    llm: {
      provider,
      baseUrlEnv: expectString(llm.baseUrlEnv, 'llm.baseUrlEnv'),
      apiKeyEnv: expectString(llm.apiKeyEnv, 'llm.apiKeyEnv'),
      model: expectString(llm.model, 'llm.model'),
      temperature: expectNumber(llm.temperature, 'llm.temperature'),
    },
    paths: {
      tasksDir: expectString(paths.tasksDir, 'paths.tasksDir'),
      runRoots: expectStringArray(paths.runRoots, 'paths.runRoots'),
      activeSkillsDir: expectString(paths.activeSkillsDir, 'paths.activeSkillsDir'),
      workDir: expectString(paths.workDir, 'paths.workDir'),
    },
    limits: {
      maxNewSkillsPerCycle,
      maxNewSkillsPerTask:
        limits.maxNewSkillsPerTask === undefined
          ? maxNewSkillsPerCycle
          : expectPositiveInteger(limits.maxNewSkillsPerTask, 'limits.maxNewSkillsPerTask'),
      maxPoolSize: expectPositiveInteger(limits.maxPoolSize, 'limits.maxPoolSize'),
      maxActiveSkillsAppliedPerRun: expectPositiveInteger(
        limits.maxActiveSkillsAppliedPerRun,
        'limits.maxActiveSkillsAppliedPerRun',
      ),
      validationConcurrency:
        limits.validationConcurrency === undefined
          ? 3
          : expectPositiveInteger(limits.validationConcurrency, 'limits.validationConcurrency'),
      validationMaxRounds:
        limits.validationMaxRounds === undefined
          ? 5
          : expectPositiveInteger(limits.validationMaxRounds, 'limits.validationMaxRounds'),
      validationTimeoutSeconds:
        limits.validationTimeoutSeconds === undefined
          ? 10800
          : expectPositiveInteger(limits.validationTimeoutSeconds, 'limits.validationTimeoutSeconds'),
      validationMaxBashTimeoutMs:
        limits.validationMaxBashTimeoutMs === undefined
          ? 120000
          : expectPositiveInteger(limits.validationMaxBashTimeoutMs, 'limits.validationMaxBashTimeoutMs'),
      validationDisableGpu:
        limits.validationDisableGpu === undefined
          ? false
          : expectBoolean(limits.validationDisableGpu, 'limits.validationDisableGpu'),
      skipAlreadyRecoveredTasks:
        limits.skipAlreadyRecoveredTasks === undefined
          ? false
          : expectBoolean(limits.skipAlreadyRecoveredTasks, 'limits.skipAlreadyRecoveredTasks'),
      validationTaskOverrides: parseValidationTaskOverrides(
        limits.validationTaskOverrides,
        'limits.validationTaskOverrides',
      ),
    },
    tasks: {
      train: expectStringArray(tasks.train, 'tasks.train'),
      valid: expectStringArray(tasks.valid, 'tasks.valid'),
    },
    policy: {
      autoActivateAfterTrainValidation: expectBoolean(
        policy.autoActivateAfterTrainValidation,
        'policy.autoActivateAfterTrainValidation',
      ),
      requireNoRegressionOnPreviouslySuccessful: expectBoolean(
        policy.requireNoRegressionOnPreviouslySuccessful,
        'policy.requireNoRegressionOnPreviouslySuccessful',
      ),
      allowStdCodeForLearning: expectBoolean(policy.allowStdCodeForLearning, 'policy.allowStdCodeForLearning'),
      allowStdCodeForApplication: expectBoolean(policy.allowStdCodeForApplication, 'policy.allowStdCodeForApplication'),
      skillToolMode,
    },
  }
}

export async function loadSkillLearningConfig(path = 'config/skill-learning.json'): Promise<SkillLearningConfig> {
  return parseSkillLearningConfig(JSON.parse(await readFile(path, 'utf8')))
}
