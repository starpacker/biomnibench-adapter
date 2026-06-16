import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createLearningToolPolicy } from './toolPolicy.js'
import type { SkillLearningConfig } from '../config.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function config(root: string, allowStdCodeForLearning = true): SkillLearningConfig {
  return {
    llm: {
      provider: 'openai-compatible',
      baseUrlEnv: 'SKILL_LEARNING_LLM_BASE_URL',
      apiKeyEnv: 'SKILL_LEARNING_LLM_API_KEY',
      model: 'test-model',
      temperature: 0,
    },
    paths: {
      tasksDir: join(root, 'tasks'),
      runRoots: [join(root, 'runs')],
      activeSkillsDir: join(root, 'skills'),
      workDir: join(root, 'output', 'skill-learning'),
    },
    limits: {
      maxNewSkillsPerCycle: 3,
      maxNewSkillsPerTask: 3,
      maxPoolSize: 50,
      maxActiveSkillsAppliedPerRun: 5,
      validationConcurrency: 3,
      validationMaxRounds: 5,
      validationTimeoutSeconds: 10800,
      validationMaxBashTimeoutMs: 120000,
      validationDisableGpu: false,
      skipAlreadyRecoveredTasks: false,
    },
    tasks: {
      train: ['conventional_ptychography'],
      valid: ['xray_ptychography_tike'],
    },
    policy: {
      autoActivateAfterTrainValidation: true,
      requireNoRegressionOnPreviouslySuccessful: true,
      allowStdCodeForLearning,
      allowStdCodeForApplication: false,
      skillToolMode: 'native-only',
    },
  }
}

describe('createLearningToolPolicy', () => {
  test('allows learning reads from std_code only when explicitly configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-tool-policy-'))
    roots.push(root)
    const stdCodePath = join(root, 'tasks', 'task-a', 'std_code', 'solve.py')

    expect(createLearningToolPolicy(config(root, true)).canRead(stdCodePath).allowed).toBe(true)
    expect(createLearningToolPolicy(config(root, false)).canRead(stdCodePath)).toMatchObject({
      allowed: false,
      reason: 'std_code reads are disabled for learning',
    })
  })

  test('denies writes through symlinked workDir paths that escape output/skill-learning', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-tool-policy-link-'))
    roots.push(root)
    const cfg = config(root)
    const outsideDir = join(root, 'outside')
    mkdirSync(cfg.paths.workDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'existing.txt'), 'outside', 'utf8')
    symlinkSync(outsideDir, join(cfg.paths.workDir, 'linked-outside'), 'junction')

    expect(createLearningToolPolicy(cfg).canWrite(join(cfg.paths.workDir, 'linked-outside', 'new.txt'))).toMatchObject({
      allowed: false,
    })
  })

  test('allows writes only to scoped agent artifact paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-tool-policy-artifacts-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.workDir, { recursive: true })
    const policy = createLearningToolPolicy(cfg)

    expect(policy.canWrite(join(cfg.paths.workDir, 'analysis.md'))).toMatchObject({
      allowed: false,
      reason: 'writes are limited to reports/<cycle>/agent-artifacts/<taskId>',
    })
    expect(
      policy.canWrite(join(cfg.paths.workDir, 'reports', 'cycle-1', 'agent-artifacts', 'task-a', 'analysis.md')),
    ).toMatchObject({
      allowed: true,
    })
  })
})
