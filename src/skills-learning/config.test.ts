import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadSkillLearningConfig } from './config.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeConfig(root: string, overrides: Record<string, unknown> = {}): string {
  const config = {
    llm: {
      provider: 'openai-compatible',
      baseUrlEnv: 'SKILL_LEARNING_LLM_BASE_URL',
      apiKeyEnv: 'SKILL_LEARNING_LLM_API_KEY',
      model: 'test-model',
      temperature: 0.2,
    },
    paths: {
      tasksDir: 'tasks',
      runRoots: ['output/all_tasks'],
      activeSkillsDir: 'skills',
      workDir: 'output/skill-learning',
    },
    limits: {
      maxNewSkillsPerCycle: 3,
      maxNewSkillsPerTask: 3,
      maxPoolSize: 50,
      maxActiveSkillsAppliedPerRun: 5,
      validationConcurrency: 3,
    },
    tasks: {
      train: ['conventional_ptychography'],
      valid: ['xray_ptychography_tike'],
    },
    policy: {
      autoActivateAfterTrainValidation: true,
      requireNoRegressionOnPreviouslySuccessful: true,
      allowStdCodeForLearning: true,
      allowStdCodeForApplication: false,
      skillToolMode: 'native-only',
    },
    ...overrides,
  }
  const path = join(root, 'skill-learning.json')
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8')
  return path
}

describe('loadSkillLearningConfig', () => {
  test('parses the committed non-sensitive default config', async () => {
    const config = await loadSkillLearningConfig('config/skill-learning.json')

    expect(config.policy.skillToolMode).toBe('native-only')
    expect(config.limits.maxNewSkillsPerTask).toBe(3)
    expect(config.limits.validationConcurrency).toBe(1)
    expect(config.limits.validationMaxRounds).toBe(5)
    expect(config.limits.validationTimeoutSeconds).toBe(10800)
    expect(config.limits.validationMaxBashTimeoutMs).toBe(120000)
    expect(config.limits.validationDisableGpu).toBe(false)
    expect(config.paths.activeSkillsDir).toBe('skills')
    expect(config.paths.workDir).toBe('output/skill-learning')
    expect(config.tasks.train).toContain('conventional_ptychography')
    expect(JSON.stringify(config)).not.toContain('sk-')
  })

  test('loads env indirection names without reading secret values', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-'))
    roots.push(root)
    const path = writeConfig(root)
    process.env.SKILL_LEARNING_LLM_API_KEY = 'should-not-be-copied'

    const config = await loadSkillLearningConfig(path)

    expect(config.llm.apiKeyEnv).toBe('SKILL_LEARNING_LLM_API_KEY')
    expect(JSON.stringify(config)).not.toContain('should-not-be-copied')
  })

  test('accepts Anthropic and OpenAI-compatible learning providers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-provider-'))
    roots.push(root)
    const anthropicPath = writeConfig(root, {
      llm: {
        provider: 'anthropic',
        baseUrlEnv: 'SKILL_LEARNING_LLM_BASE_URL',
        apiKeyEnv: 'SKILL_LEARNING_LLM_API_KEY',
        model: 'claude-learning-model',
        temperature: 0.2,
      },
    })

    const anthropicConfig = await loadSkillLearningConfig(anthropicPath)
    expect(anthropicConfig.llm.provider).toBe('anthropic')

    const openAiPath = writeConfig(root, {
      llm: {
        provider: 'openai',
        baseUrlEnv: 'SKILL_LEARNING_LLM_BASE_URL',
        apiKeyEnv: 'SKILL_LEARNING_LLM_API_KEY',
        model: 'openai-learning-model',
        temperature: 0.2,
      },
    })

    const openAiConfig = await loadSkillLearningConfig(openAiPath)
    expect(openAiConfig.llm.provider).toBe('openai')
  })

  test('defaults validation GPU access to enabled when omitted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-gpu-default-'))
    roots.push(root)
    const path = writeConfig(root)

    const config = await loadSkillLearningConfig(path)

    expect(config.limits.validationDisableGpu).toBe(false)
  })

  test('allows GPU validation to be explicitly disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-gpu-'))
    roots.push(root)
    const path = writeConfig(root, {
      limits: {
        maxNewSkillsPerCycle: 3,
        maxNewSkillsPerTask: 3,
        maxPoolSize: 50,
        maxActiveSkillsAppliedPerRun: 5,
        validationConcurrency: 1,
        validationDisableGpu: true,
      },
    })

    const config = await loadSkillLearningConfig(path)

    expect(config.limits.validationDisableGpu).toBe(true)
  })

  test('parses validation Bash timeout cap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-bash-timeout-'))
    roots.push(root)
    const path = writeConfig(root, {
      limits: {
        maxNewSkillsPerCycle: 3,
        maxNewSkillsPerTask: 3,
        maxPoolSize: 50,
        maxActiveSkillsAppliedPerRun: 5,
        validationConcurrency: 1,
        validationMaxBashTimeoutMs: 900000,
      },
    })

    const config = await loadSkillLearningConfig(path)

    expect(config.limits.validationMaxBashTimeoutMs).toBe(900000)
  })

  test('parses validation max rounds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-max-rounds-'))
    roots.push(root)
    const path = writeConfig(root, {
      limits: {
        maxNewSkillsPerCycle: 3,
        maxNewSkillsPerTask: 3,
        maxPoolSize: 50,
        maxActiveSkillsAppliedPerRun: 5,
        validationConcurrency: 1,
        validationMaxRounds: 2,
      },
    })

    const config = await loadSkillLearningConfig(path)

    expect(config.limits.validationMaxRounds).toBe(2)
  })

  test('parses skip-already-recovered and per-task validation overrides', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-validation-overrides-'))
    roots.push(root)
    const path = writeConfig(root, {
      limits: {
        maxNewSkillsPerCycle: 3,
        maxNewSkillsPerTask: 3,
        maxPoolSize: 50,
        maxActiveSkillsAppliedPerRun: 5,
        validationConcurrency: 1,
        skipAlreadyRecoveredTasks: true,
        validationTaskOverrides: {
          conventional_ptychography: {
            maxRounds: 2,
            timeoutSeconds: 600,
            maxBashTimeoutMs: 300000,
          },
        },
      },
    })

    const config = await loadSkillLearningConfig(path)

    expect(config.limits.skipAlreadyRecoveredTasks).toBe(true)
    expect(config.limits.validationTaskOverrides?.conventional_ptychography).toEqual({
      maxRounds: 2,
      timeoutSeconds: 600,
      maxBashTimeoutMs: 300000,
    })
  })

  test('parses validation context parity options', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-context-'))
    roots.push(root)
    const path = writeConfig(root, {
      contextProfile: 'eval-safe-claude-parity',
      runMemory: true,
      includeClaudeDefaultUserContext: true,
    })

    const config = await loadSkillLearningConfig(path)

    expect(config.contextProfile).toBe('eval-safe-claude-parity')
    expect(config.runMemory).toBe(true)
    expect(config.includeClaudeDefaultUserContext).toBe(true)
  })

  test('parses locked baseline proof manifest path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-proof-'))
    roots.push(root)
    const path = writeConfig(root, {
      proof: {
        lockedBaselineManifestPath: 'output/skill-learning-six-task-proof/proof/cycle-1/baseline-failures.json',
      },
    })

    const config = await loadSkillLearningConfig(path)

    expect(config.proof?.lockedBaselineManifestPath).toBe(
      'output/skill-learning-six-task-proof/proof/cycle-1/baseline-failures.json',
    )
  })

  test('rejects unknown validation context profiles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-context-bad-'))
    roots.push(root)
    const path = writeConfig(root, {
      contextProfile: 'unsafe-ish',
    })

    await expect(loadSkillLearningConfig(path)).rejects.toThrow('contextProfile')
  })

  test('rejects unsafe Claude context profile in skill-learning configs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-context-unsafe-'))
    roots.push(root)
    const path = writeConfig(root, {
      contextProfile: 'full-claude-unsafe',
    })

    await expect(loadSkillLearningConfig(path)).rejects.toThrow('full-claude-unsafe')
  })

  test('reports a clear error when llm env indirection is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-config-bad-'))
    roots.push(root)
    const path = writeConfig(root, {
      llm: {
        provider: 'openai-compatible',
        baseUrlEnv: '',
        apiKeyEnv: '',
        model: 'test-model',
        temperature: 0.2,
      },
    })

    await expect(loadSkillLearningConfig(path)).rejects.toThrow('llm.baseUrlEnv')
  })
})
