import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadValidationTaskResultsFromRunSummaries, runSkillValidation } from './validationRunner.js'
import type { SkillLearningConfig } from './config.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function config(root: string): SkillLearningConfig {
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
      train: ['previous-success', 'previous-failure'],
      valid: ['valid-task'],
    },
    policy: {
      autoActivateAfterTrainValidation: true,
      requireNoRegressionOnPreviouslySuccessful: true,
      allowStdCodeForLearning: true,
      allowStdCodeForApplication: false,
      skillToolMode: 'native-only',
    },
  }
}

function writeSkillApplication(runDir: string, skill = 'general-skill'): void {
  const workspaceDir = join(runDir, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(
    join(workspaceDir, 'skill_application.json'),
    JSON.stringify({
      schema_version: 1,
      skills: [
        {
          skill,
          status: 'used',
          evidence_path: 'workspace/probe.log',
          reason: 'Checked the cheap probe and submit-time contract.',
        },
      ],
    }),
    'utf8',
  )
}

describe('runSkillValidation', () => {
  test('prefers task run summaries over worker exit fallbacks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-summaries-'))
    roots.push(root)
    const runsDir = join(root, 'runs')
    const logsDir = join(runsDir, 'task_a_20260529_010101', 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(
      join(logsDir, 'run_summary.json'),
      JSON.stringify({ status: 'success', reward: 1, rounds: 2 }),
      'utf8',
    )

    const results = await loadValidationTaskResultsFromRunSummaries(
      ['task_a', 'task_b'],
      runsDir,
      [
        { taskId: 'task_a', status: 'failed', reward: 0 },
        { taskId: 'task_b', status: 'failed', reward: 0 },
      ],
    )

    expect(results).toEqual([
      { taskId: 'task_a', status: 'success', reward: 1 },
      { taskId: 'task_b', status: 'failed', reward: 0 },
    ])
  })

  test('uses native SkillTool flags for skills validation and no skills for baseline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-'))
    roots.push(root)
    const seen = []

    await runSkillValidation({
      config: config(root),
      cycleId: 'cycle-1',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({
      label: 'baseline',
      concurrency: 3,
      timeoutSeconds: 10800,
      env: {
        BASH_DEFAULT_TIMEOUT_MS: '120000',
        BASH_MAX_TIMEOUT_MS: '120000',
        SOURCE_EVAL_MAX_BASH_TIMEOUT_MS: '120000',
      },
      skillOptions: { enabled: false },
    })
    expect(seen[1]).toMatchObject({
      label: 'skills',
      concurrency: 3,
      env: {
        BASH_DEFAULT_TIMEOUT_MS: '120000',
        BASH_MAX_TIMEOUT_MS: '120000',
        SOURCE_EVAL_MAX_BASH_TIMEOUT_MS: '120000',
      },
      skillOptions: {
        enabled: true,
        mode: 'native',
        skillsDir: join(root, 'skills'),
      },
    })
  })

  test('passes Bash timeout caps always and GPU safe-mode only when validationDisableGpu is true', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-gpu-safe-mode-'))
    roots.push(root)
    const cfg = config(root)
    cfg.limits.validationDisableGpu = true
    const seen = []

    await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-gpu-safe-mode',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen[0].env).toMatchObject({
      CUDA_VISIBLE_DEVICES: '',
      BASH_MAX_TIMEOUT_MS: '120000',
      SOURCE_EVAL_MAX_BASH_TIMEOUT_MS: '120000',
    })
    expect(seen[1].env).toMatchObject({
      CUDA_VISIBLE_DEVICES: '',
      BASH_MAX_TIMEOUT_MS: '120000',
      SOURCE_EVAL_MAX_BASH_TIMEOUT_MS: '120000',
    })
  })

  test('passes configured Bash timeout cap to validation evaluation runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-bash-cap-'))
    roots.push(root)
    const cfg = config(root)
    cfg.limits.validationMaxBashTimeoutMs = 900000
    const seen = []

    await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-bash-cap',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen[0].env).toMatchObject({
      BASH_DEFAULT_TIMEOUT_MS: '900000',
      BASH_MAX_TIMEOUT_MS: '900000',
      SOURCE_EVAL_MAX_BASH_TIMEOUT_MS: '900000',
    })
  })

  test('passes configured max rounds to validation evaluation runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-max-rounds-'))
    roots.push(root)
    const cfg = config(root)
    cfg.limits.validationMaxRounds = 2
    const seen = []

    await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-max-rounds',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen.map(request => request.maxRounds)).toEqual([2, 2])
  })

  test('passes per-task validation overrides to evaluation runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-task-overrides-'))
    roots.push(root)
    const cfg = config(root)
    cfg.limits.validationTaskOverrides = {
      'previous-failure': {
        maxRounds: 2,
        timeoutSeconds: 600,
        maxBashTimeoutMs: 300000,
      },
    }
    const seen = []

    await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-task-overrides',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen[0].maxRoundsByTaskId).toEqual({ 'previous-failure': 2 })
    expect(seen[0].timeoutSecondsByTaskId).toEqual({ 'previous-failure': 600 })
    expect(seen[0].workerEnvByTaskId?.['previous-failure']).toMatchObject({
      BASH_DEFAULT_TIMEOUT_MS: '300000',
      BASH_MAX_TIMEOUT_MS: '300000',
      SOURCE_EVAL_MAX_BASH_TIMEOUT_MS: '300000',
    })
    expect(seen[1].maxRoundsByTaskId).toEqual({ 'previous-failure': 2 })
  })

  test('passes configured context parity options to validation evaluation runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-context-'))
    roots.push(root)
    const cfg = config(root)
    cfg.contextProfile = 'eval-safe-claude-parity'
    cfg.runMemory = true
    cfg.includeClaudeDefaultUserContext = true
    const seen = []

    await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-context',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen).toHaveLength(2)
    expect(seen[0].contextOptions).toMatchObject({
      profile: 'eval-safe-claude-parity',
      runMemory: true,
      includeClaudeDefaultUserContext: true,
    })
    expect(seen[1].contextOptions).toMatchObject({
      profile: 'eval-safe-claude-parity',
      runMemory: true,
      includeClaudeDefaultUserContext: true,
    })
  })

  test('computes no-regression and innovation gates and writes a report', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-report-'))
    roots.push(root)
    const cfg = config(root)

    const report = await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-2',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => ({
        ok: true,
        taskResults: request.taskIds.map(taskId => ({
          taskId,
          status: request.label === 'skills' ? 'success' : taskId === 'previous-success' ? 'success' : 'failed',
          reward: request.label === 'skills' ? 1 : taskId === 'previous-success' ? 1 : 0,
        })),
      }),
    })

    expect(report.gates.noRegression).toBe(true)
    expect(report.gates.innovation).toBe(true)
    expect(report.gates.validAllowed).toBe(true)
    const reportPath = join(cfg.paths.workDir, 'validation', 'cycle-2', 'train-report.json')
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({ cycleId: 'cycle-2', phase: 'train' })
  })

  test('does not pass train gates when successful skills runs never call Skill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-skill-call-gate-'))
    roots.push(root)
    const cfg = config(root)

    const report = await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-skill-call-gate',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      allowedSkillNames: ['general-skill'],
      evaluate: async request => {
        if (request.label === 'skills') {
          for (const taskId of request.taskIds) {
            const logsDir = join(request.runsDir, `${taskId}_20260602_010101`, 'logs')
            mkdirSync(logsDir, { recursive: true })
            writeFileSync(
              join(logsDir, 'run_summary.json'),
              JSON.stringify({ status: 'success', reward: 1, rounds: 1 }),
              'utf8',
            )
            writeFileSync(
              join(logsDir, 'trajectory.clean.jsonl'),
              `${JSON.stringify({ kind: 'tool_call', round: 1, tool: 'Read', input: { file_path: 'public/README.md' } })}\n`,
              'utf8',
            )
          }
        }
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({
            taskId,
            status: request.label === 'baseline' && taskId === 'previous-failure' ? 'failed' : 'success',
            reward: request.label === 'baseline' && taskId === 'previous-failure' ? 0 : 1,
          })),
        }
      },
    })

    expect(report.gates.noRegression).toBe(true)
    expect(report.gates.innovation).toBe(true)
    expect(report.gates.skillToolUsage).toBe(false)
    expect(report.gates.trainPassed).toBe(false)
    expect(report.gates.validAllowed).toBe(false)
  })

  test('does not pass train gates when Skill is called but skill_application is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-contract-gate-'))
    roots.push(root)
    const cfg = config(root)

    const report = await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-contract-gate',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      allowedSkillNames: ['general-skill'],
      evaluate: async request => {
        if (request.label === 'skills') {
          for (const taskId of request.taskIds) {
            const logsDir = join(request.runsDir, `${taskId}_20260602_010101`, 'logs')
            mkdirSync(logsDir, { recursive: true })
            writeFileSync(
              join(logsDir, 'run_summary.json'),
              JSON.stringify({ status: 'success', reward: 1, rounds: 1 }),
              'utf8',
            )
            writeFileSync(
              join(logsDir, 'trajectory.clean.jsonl'),
              `${JSON.stringify({ kind: 'tool_call', round: 1, tool: 'Skill', input: { name: 'general-skill' } })}\n`,
              'utf8',
            )
          }
        }
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({
            taskId,
            status: request.label === 'baseline' && taskId === 'previous-failure' ? 'failed' : 'success',
            reward: request.label === 'baseline' && taskId === 'previous-failure' ? 0 : 1,
          })),
        }
      },
    })

    expect(report.gates.skillToolUsage).toBe(true)
    expect(report.gates.skillContractUsage).toBe(false)
    expect(report.gates.trainPassed).toBe(false)
    expect(report.gates.validAllowed).toBe(false)
    expect(report.skillRun?.contractUsageByTask?.['previous-failure']).toBe(false)
    expect(report.skillRun?.contractViolationsByTask?.['previous-failure']).toEqual([
      expect.objectContaining({ code: 'missing_skill_application' }),
    ])
  })

  test('passes contract usage gate when skill_application is valid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-contract-pass-'))
    roots.push(root)
    const cfg = config(root)

    const report = await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-contract-pass',
      phase: 'train',
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      allowedSkillNames: ['general-skill'],
      evaluate: async request => {
        if (request.label === 'skills') {
          for (const taskId of request.taskIds) {
            const runDir = join(request.runsDir, `${taskId}_20260602_010101`)
            const logsDir = join(runDir, 'logs')
            mkdirSync(logsDir, { recursive: true })
            writeFileSync(
              join(logsDir, 'run_summary.json'),
              JSON.stringify({ status: 'success', reward: 1, rounds: 1 }),
              'utf8',
            )
            writeFileSync(
              join(logsDir, 'trajectory.clean.jsonl'),
              `${JSON.stringify({ kind: 'tool_call', round: 1, tool: 'Skill', input: { name: 'general-skill' } })}\n`,
              'utf8',
            )
            writeSkillApplication(runDir)
          }
        }
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({
            taskId,
            status: request.label === 'baseline' && taskId === 'previous-failure' ? 'failed' : 'success',
            reward: request.label === 'baseline' && taskId === 'previous-failure' ? 0 : 1,
          })),
        }
      },
    })

    expect(report.gates.skillToolUsage).toBe(true)
    expect(report.gates.skillContractUsage).toBe(true)
    expect(report.gates.trainPassed).toBe(true)
    expect(report.gates.validAllowed).toBe(true)
    expect(report.skillRun?.contractUsageByTask?.['previous-failure']).toBe(true)
    expect(report.skillRun?.contractViolationsByTask?.['previous-failure']).toEqual([])
  })

  test('uses known baseline results without rerunning no-skill validation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-known-baseline-'))
    roots.push(root)
    const seen = []

    const report = await runSkillValidation({
      config: config(root),
      cycleId: 'cycle-known-baseline',
      phase: 'train',
      knownBaselineResults: [
        { taskId: 'previous-success', status: 'success', reward: 1 },
        { taskId: 'previous-failure', status: 'failed', reward: 0 },
      ],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen.map(request => request.label)).toEqual(['skills'])
    expect(report.baseline).toEqual([
      { taskId: 'previous-success', status: 'success', reward: 1 },
      { taskId: 'previous-failure', status: 'failed', reward: 0 },
    ])
    expect(report.gates.noRegression).toBe(true)
    expect(report.gates.innovation).toBe(true)
  })

  test('reruns baseline instead of reusing known baseline when context parity is enabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-known-baseline-context-'))
    roots.push(root)
    const cfg = config(root)
    cfg.contextProfile = 'eval-safe-claude-parity'
    cfg.runMemory = true
    const seen = []

    const report = await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-known-baseline-context',
      phase: 'train',
      knownBaselineResults: [
        { taskId: 'previous-success', status: 'success', reward: 1 },
        { taskId: 'previous-failure', status: 'failed', reward: 0 },
      ],
      previouslySuccessfulTaskIds: ['previous-success'],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: request.label !== 'baseline',
          taskResults: request.taskIds.map(taskId => ({
            taskId,
            status: request.label === 'baseline' ? 'failed' : 'success',
            reward: request.label === 'baseline' ? 0 : 1,
          })),
        }
      },
    })

    expect(seen.map(request => request.label)).toEqual(['baseline', 'skills'])
    expect(report.baseline.every(result => result.status === 'failed')).toBe(true)
    expect(report.context).toEqual({
      profile: 'eval-safe-claude-parity',
      runMemory: true,
      knownBaselineReused: false,
    })
  })

  test('uses locked proof baseline manifest without rerunning baseline even with context parity enabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-locked-baseline-'))
    roots.push(root)
    const cfg = config(root)
    cfg.contextProfile = 'eval-safe-claude-parity'
    cfg.runMemory = true
    const manifestPath = join(root, 'proof', 'baseline-failures.json')
    mkdirSync(join(root, 'proof'), { recursive: true })
    for (const taskId of cfg.tasks.train) {
      const logsDir = join(root, 'locked-baseline', `${taskId}_old`, 'logs')
      mkdirSync(logsDir, { recursive: true })
      writeFileSync(join(logsDir, 'trajectory.clean.jsonl'), `${JSON.stringify({ kind: 'run_context', task_id: taskId })}\n`, 'utf8')
    }
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        baselineRerun: false,
        tasks: cfg.tasks.train.map(taskId => ({
          taskId,
          status: 'failed',
          reward: 0,
          rounds: 5,
          runDir: join(root, 'locked-baseline', `${taskId}_old`),
          summaryPath: join(root, 'locked-baseline', `${taskId}_old`, 'logs', 'run_summary.json'),
          trajectoryPath: join(root, 'locked-baseline', `${taskId}_old`, 'logs', 'trajectory.clean.jsonl'),
          skillToolCalls: 0,
        })),
      }),
      'utf8',
    )
    cfg.proof = { lockedBaselineManifestPath: manifestPath }
    const seen = []

    const report = await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-locked-baseline',
      phase: 'train',
      allowedSkillNames: ['proof-skill'],
      evaluate: async request => {
        seen.push(request)
        for (const taskId of request.taskIds) {
          const runDir = join(request.runsDir, `${taskId}_20260602_010101`)
          const logsDir = join(runDir, 'logs')
          mkdirSync(logsDir, { recursive: true })
          writeFileSync(join(logsDir, 'run_summary.json'), JSON.stringify({ status: 'success', reward: 1, rounds: 1 }), 'utf8')
          writeFileSync(
            join(logsDir, 'trajectory.clean.jsonl'),
            `${JSON.stringify({ kind: 'tool_call', round: 1, tool: 'Skill', input: { name: 'proof-skill' } })}\n`,
            'utf8',
          )
          writeSkillApplication(runDir, 'proof-skill')
        }
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen.map(request => request.label)).toEqual(['skills'])
    expect(report.baseline).toEqual(cfg.tasks.train.map(taskId => ({ taskId, status: 'failed', reward: 0 })))
    expect(report.proof).toMatchObject({
      baselineSource: 'locked-manifest',
      baselineRerun: false,
      allFailedRecovered: true,
      recoveredByTask: {
        'previous-failure': true,
        'previous-success': true,
      },
    })
    expect(report.gates.allFailedRecovered).toBe(true)
    expect(report.gates.trainPassed).toBe(true)
  })

  test('rejects locked proof baseline manifest entries that are not failed no-skill runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-bad-locked-baseline-'))
    roots.push(root)
    const cfg = config(root)
    const manifestPath = join(root, 'proof', 'baseline-failures.json')
    mkdirSync(join(root, 'proof'), { recursive: true })
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        baselineRerun: false,
        tasks: [
          { taskId: 'previous-success', status: 'success', reward: 1, rounds: 1, skillToolCalls: 0 },
          { taskId: 'previous-failure', status: 'failed', reward: 0, rounds: 5, skillToolCalls: 0 },
        ],
      }),
      'utf8',
    )
    cfg.proof = { lockedBaselineManifestPath: manifestPath }
    const seen = []

    await expect(
      runSkillValidation({
        config: cfg,
        cycleId: 'cycle-bad-locked-baseline',
        phase: 'train',
        evaluate: async request => {
          seen.push(request)
          return { ok: true, taskResults: [] }
        },
      }),
    ).rejects.toThrow('locked baseline')
    expect(seen).toEqual([])
  })

  test('supports task overrides and custom report files for partial validation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-partial-'))
    roots.push(root)
    const cfg = config(root)
    const seen = []

    const report = await runSkillValidation({
      config: cfg,
      cycleId: 'cycle-partial',
      phase: 'train',
      taskIds: ['previous-failure'],
      reportFileName: 'train-failed-report.json',
      scope: {
        taskIds: ['previous-failure'],
        source: 'train-report.json',
        reason: 'failed skills-run tasks from latest train validation report',
      },
      knownBaselineResults: [{ taskId: 'previous-failure', status: 'failed', reward: 0 }],
      previouslyFailedTaskIds: ['previous-failure'],
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen.map(request => ({ label: request.label, taskIds: request.taskIds }))).toEqual([
      { label: 'skills', taskIds: ['previous-failure'] },
    ])
    expect(report.scope?.taskIds).toEqual(['previous-failure'])
    expect(existsSync(join(cfg.paths.workDir, 'validation', 'cycle-partial', 'train-failed-report.json'))).toBe(true)
    expect(existsSync(join(cfg.paths.workDir, 'validation', 'cycle-partial', 'train-report.json'))).toBe(false)
  })

  test('blocks valid phase when train gates did not pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-validation-valid-'))
    roots.push(root)

    await expect(
      runSkillValidation({
        config: config(root),
        cycleId: 'cycle-3',
        phase: 'valid',
        trainReport: {
          cycleId: 'cycle-3',
          phase: 'train',
          baseline: [],
          skills: [],
          gates: {
            noRegression: false,
            innovation: false,
            trainPassed: false,
            validAllowed: false,
          },
        },
        evaluate: async () => ({ ok: true, taskResults: [] }),
      }),
    ).rejects.toThrow('train validation must pass before valid')
  })
})
