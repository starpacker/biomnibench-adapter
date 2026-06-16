import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SkillLearningConfig } from './config.js'
import {
  activateValidatedSkills,
  critiqueCycleCandidates,
  indexCycleEvidence,
  learnCycleCandidates,
  quarantineActiveSkillsAfterRegression,
  refineFailedCycleSkills,
  TRAIN_FAILED_REPORT_FILE,
  validateFailedCycleTrain,
  validateCycleTrain,
  writeCycleReport,
} from './skillLearningCycle.js'
import { writeValidationReport } from './validationRunner.js'
import type { SkillCandidate } from './skillCandidateSchema.js'

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
      maxNewSkillsPerCycle: 2,
      maxNewSkillsPerTask: 2,
      maxPoolSize: 10,
      maxActiveSkillsAppliedPerRun: 5,
      validationConcurrency: 3,
      validationMaxRounds: 5,
      validationTimeoutSeconds: 10800,
      validationMaxBashTimeoutMs: 120000,
      validationDisableGpu: false,
      skipAlreadyRecoveredTasks: false,
    },
    tasks: {
      train: ['train-task'],
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

function writeRun(root: string, taskId: string, runId: string, status: 'success' | 'failed'): void {
  const logsDir = join(root, 'runs', taskId, runId, 'logs')
  mkdirSync(logsDir, { recursive: true })
  const trajectoryPath = join(logsDir, 'trajectory.clean.jsonl')
  writeFileSync(
    trajectoryPath,
    [
      JSON.stringify({ kind: 'run_context', task_id: taskId, run_id: runId }),
      JSON.stringify({ kind: 'assistant_text', round: 1, text: `${status} analysis` }),
      JSON.stringify({ kind: 'judge_result', round: 1, status, reward: status === 'success' ? 1 : 0 }),
    ].join('\n') + '\n',
    'utf8',
  )
  writeFileSync(
    join(logsDir, 'run_summary.json'),
    JSON.stringify({ status, rounds: 1, reward: status === 'success' ? 1 : 0, trajectory_path: trajectoryPath }),
    'utf8',
  )
}

function writeSkillApplication(runDir: string, skillNames: string[]): void {
  const workspaceDir = join(runDir, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(
    join(workspaceDir, 'skill_application.json'),
    JSON.stringify({
      schema_version: 1,
      skills: skillNames.map(skill => ({
        skill,
        status: 'used',
        evidence_path: 'workspace/probe.log',
        reason: 'Checked the skill contract before submission.',
      })),
    }),
    'utf8',
  )
}

function poolSkill(id: string, status: SkillCandidate['validation']['status'] = 'candidate', successDelta = 0): SkillCandidate {
  return {
    schema_version: 2,
    id,
    namespace: 'computational-imaging',
    type: 'general',
    title: `${id} title`,
    trigger: 'Judge feedback identifies a concrete output mismatch.',
    domain_tags: ['general'],
    summary:
      'Use this skill when judge feedback identifies a concrete mismatch and the agent needs to turn that feedback into one small reusable debugging action rather than broad unrelated changes.',
    problem_signals: [
      'The output schema is valid but a metric or artifact-specific judge result remains below threshold.',
      'The previous attempt changed multiple decisions, leaving the next diagnosis ambiguous.',
    ],
    diagnostic_steps: [
      'Restate the feedback as one falsifiable hypothesis connected to a single artifact or metric.',
      'Inspect the smallest relevant generated output and public contract before editing solver logic.',
      'Apply one targeted change and rerun the narrowest available local check before another full evaluation.',
    ],
    math_physics_checks: [],
    tool_decision_rules: [
      'Use read/list tools on the failing output and contract before running expensive reconstruction commands.',
    ],
    validation_checks: [
      'Confirm that the targeted artifact or metric moves in the expected direction after the change.',
      'Verify output schema and finite-value constraints before finalizing the submission.',
    ],
    transfer_scope:
      'Applies across computational imaging debugging loops where public contracts and judge feedback guide the next step.',
    guidance: [
      'Convert feedback into one falsifiable hypothesis and validate the smallest related artifact.',
      'Keep the next change narrow enough that the judge result can be attributed to one decision.',
    ],
    anti_patterns: [
      'Do not change unrelated algorithms in the same round.',
      'Do not tune broad parameters before inspecting the specific output or metric named by feedback.',
    ],
    evidence_runs: ['run-1'],
    validation: { status, used_count: status === 'active' ? 1 : 0, success_delta: successDelta, regressions: 0 },
  }
}

describe('skill learning cycle', () => {
  test('indexes train evidence and ignores valid tasks for learning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-index-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(join(cfg.paths.tasksDir, 'train-task', 'std_code'), { recursive: true })
    writeFileSync(join(cfg.paths.tasksDir, 'train-task', 'std_code', 'solve.py'), 'print("ref")', 'utf8')
    writeRun(root, 'train-task', 'success-run', 'success')
    writeRun(root, 'train-task', 'failure-run', 'failed')
    writeRun(root, 'valid-task', 'valid-run', 'success')

    const packages = await indexCycleEvidence(cfg, 'cycle-1')

    expect(packages.map(pkg => pkg.kind).sort()).toEqual(['failure-vs-std-code', 'success', 'success-vs-failure'])
    expect(packages.some(pkg => String(pkg.kind) === 'failure-only')).toBe(false)
    expect(packages.some(pkg => pkg.kind === 'success-vs-failure')).toBe(true)
    expect(existsSync(join(cfg.paths.workDir, 'evidence', 'cycle-1', 'train-task-success-vs-failure.json'))).toBe(true)
    expect(existsSync(join(cfg.paths.workDir, 'evidence', 'cycle-1', 'train-task-failure-only.json'))).toBe(false)
  })

  test('learns candidates through the tool-capable subAgent and critic adds approved candidates to pool', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-learn-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(join(cfg.paths.workDir, 'evidence', 'cycle-2'), { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'evidence', 'cycle-2', 'train-task-success.json'),
      JSON.stringify({ kind: 'success', taskId: 'train-task', runIds: ['run-1'] }),
      'utf8',
    )

    await learnCycleCandidates(cfg, 'cycle-2', {
      transport: async () => ({
        content: JSON.stringify([poolSkill('ci-general-feedback-loop')]),
      }),
    })
    await critiqueCycleCandidates(cfg, 'cycle-2')

    const pool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(pool.skills['ci-general-feedback-loop'].validation.status).toBe('candidate')
  })

  test('critic rejects candidates that mention locked baseline run paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-proof-critic-'))
    roots.push(root)
    const cfg = config(root)
    const manifestPath = join(root, 'proof', 'baseline-failures.json')
    cfg.proof = { lockedBaselineManifestPath: manifestPath }
    mkdirSync(join(cfg.paths.workDir, 'candidates', 'cycle-proof-critic'), { recursive: true })
    mkdirSync(join(root, 'proof'), { recursive: true })
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        baselineRerun: false,
        tasks: [{ taskId: 'train-task', runDir: 'output/all_tasks/locked_failure_run_20260602' }],
      }),
      'utf8',
    )
    writeFileSync(
      join(cfg.paths.workDir, 'candidates', 'cycle-proof-critic', 'ci-general-leaky.json'),
      JSON.stringify({
        ...poolSkill('ci-general-leaky'),
        guidance: [
          'Inspect locked_failure_run_20260602 before attempting the reusable diagnostic loop.',
          'Keep the next change narrow enough that the judge result can be attributed to one decision.',
        ],
      }),
      'utf8',
    )

    const result = await critiqueCycleCandidates(cfg, 'cycle-proof-critic')

    expect(result.approved).toEqual([])
    expect(result.rejected[0].findings.join('\n')).toContain('locked_failure_run_20260602')
  })

  test('critic removes previously approved cycle candidates that become rejected after policy tightening', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-critic-clean-'))
    roots.push(root)
    const cfg = config(root)
    const leaky = {
      ...poolSkill('ci-general-leaky'),
      guidance: [
        'Before coding, read the reference implementation source code and match it exactly.',
        'Keep the next change narrow enough that the judge result can be attributed to one decision.',
      ],
    }
    mkdirSync(join(cfg.paths.workDir, 'candidates', 'cycle-critic-clean'), { recursive: true })
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({ version: 1, skills: { 'ci-general-leaky': leaky } }),
      'utf8',
    )
    writeFileSync(
      join(cfg.paths.workDir, 'candidates', 'cycle-critic-clean', 'ci-general-leaky.json'),
      JSON.stringify(leaky),
      'utf8',
    )

    const result = await critiqueCycleCandidates(cfg, 'cycle-critic-clean')

    expect(result.approved).toEqual([])
    const pool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(pool.skills['ci-general-leaky']).toBeUndefined()
  })

  test('critic prunes stale proof candidates that were not regenerated in the current cycle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-proof-stale-'))
    roots.push(root)
    const cfg = config(root)
    const manifestPath = join(root, 'baseline-failures.json')
    cfg.proof = { lockedBaselineManifestPath: manifestPath }
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(
      manifestPath,
      JSON.stringify({
        tasks: [{ taskId: 'task-a', runDir: join(root, 'runs', 'task-a-failed-run') }],
      }),
      'utf8',
    )
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'ci-stale-proof': { ...poolSkill('ci-stale-proof'), evidence_runs: ['task-a-failed-run'] },
          'ci-unrelated': { ...poolSkill('ci-unrelated'), evidence_runs: ['other-run'] },
        },
      }),
      'utf8',
    )
    const candidateDir = join(cfg.paths.workDir, 'candidates', 'cycle-proof-stale')
    mkdirSync(candidateDir, { recursive: true })
    writeFileSync(
      join(candidateDir, 'ci-current-proof.json'),
      JSON.stringify({ ...poolSkill('ci-current-proof'), evidence_runs: ['task-a-failed-run'] }),
      'utf8',
    )

    const result = await critiqueCycleCandidates(cfg, 'cycle-proof-stale')

    const pool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(result.approved.map(candidate => candidate.id)).toEqual(['ci-current-proof'])
    expect(result.prunedStaleCandidateIds).toEqual(['ci-stale-proof', 'ci-unrelated'])
    expect(pool.skills['ci-stale-proof']).toBeUndefined()
    expect(pool.skills['ci-current-proof']).toBeDefined()
    expect(pool.skills['ci-unrelated']).toBeUndefined()
  })

  test('writes learn traces for each evidence package even when no candidates parse', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-learn-trace-'))
    roots.push(root)
    const cfg = config(root)
    const evidenceDir = join(cfg.paths.workDir, 'evidence', 'cycle-trace')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, 'train-task-success.json'),
      JSON.stringify({ kind: 'success', taskId: 'train-task', runIds: ['run-1'] }),
      'utf8',
    )

    const learned = await learnCycleCandidates(cfg, 'cycle-trace', {
      transport: async () => ({
        content: 'I analyzed the run but did not return JSON.',
      }),
    })

    const trace = JSON.parse(
      readFileSync(
        join(cfg.paths.workDir, 'reports', 'cycle-trace', 'learn-traces', '001-train-task-success.json'),
        'utf8',
      ),
    )
    expect(learned).toEqual([])
    expect(trace).toMatchObject({
      evidenceFile: 'train-task-success.json',
      role: 'trajectory-analyst',
      submissionStatus: 'generation_error',
      candidateIds: [],
      generationError: expect.stringContaining('candidate output must be JSON'),
      rawContent: 'I analyzed the run but did not return JSON.',
      toolResults: [],
    })
    const summary = JSON.parse(readFileSync(join(cfg.paths.workDir, 'reports', 'cycle-trace', 'learn-summary.json'), 'utf8'))
    expect(summary).toMatchObject({
      cycleId: 'cycle-trace',
      evidenceCount: 1,
      entries: [
        {
          evidenceFile: 'train-task-success.json',
          status: 'generation_error',
        },
      ],
    })
  })

  test('cleans stale learn candidates and traces before writing current results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-learn-clean-'))
    roots.push(root)
    const cfg = config(root)
    const evidenceDir = join(cfg.paths.workDir, 'evidence', 'cycle-clean')
    const candidateDir = join(cfg.paths.workDir, 'candidates', 'cycle-clean')
    const traceDir = join(cfg.paths.workDir, 'reports', 'cycle-clean', 'learn-traces')
    const artifactDir = join(cfg.paths.workDir, 'reports', 'cycle-clean', 'agent-artifacts')
    const summaryPath = join(cfg.paths.workDir, 'reports', 'cycle-clean', 'learn-summary.json')
    mkdirSync(evidenceDir, { recursive: true })
    mkdirSync(candidateDir, { recursive: true })
    mkdirSync(traceDir, { recursive: true })
    mkdirSync(join(cfg.paths.workDir, 'reports', 'cycle-clean'), { recursive: true })
    mkdirSync(join(artifactDir, 'train-task'), { recursive: true })
    writeFileSync(join(candidateDir, 'stale-candidate.json'), '{}', 'utf8')
    writeFileSync(join(traceDir, '999-stale.json'), '{}', 'utf8')
    writeFileSync(summaryPath, '{"stale":true}', 'utf8')
    writeFileSync(join(artifactDir, 'train-task', 'stale.md'), 'stale', 'utf8')
    writeFileSync(
      join(evidenceDir, 'train-task-success.json'),
      JSON.stringify({ kind: 'success', taskId: 'train-task', runIds: ['run-1'] }),
      'utf8',
    )

    await learnCycleCandidates(cfg, 'cycle-clean', {
      transport: async () => ({ content: '[]' }),
    })

    expect(existsSync(join(candidateDir, 'stale-candidate.json'))).toBe(false)
    expect(existsSync(join(traceDir, '999-stale.json'))).toBe(false)
    expect(existsSync(join(artifactDir, 'train-task', 'stale.md'))).toBe(false)
    expect(existsSync(join(traceDir, '001-train-task-success.json'))).toBe(true)
    expect(JSON.parse(readFileSync(summaryPath, 'utf8'))).toMatchObject({ cycleId: 'cycle-clean', evidenceCount: 1 })
  })

  test('grounds learned candidate evidence runs to the source evidence package run ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-ground-runs-'))
    roots.push(root)
    const cfg = config(root)
    const evidenceDir = join(cfg.paths.workDir, 'evidence', 'cycle-ground-runs')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, 'task-a-failure-vs-std-code.json'),
      JSON.stringify({ kind: 'failure-vs-std-code', taskId: 'train-task', runIds: ['real-run-1', 'real-run-2'] }),
      'utf8',
    )

    await learnCycleCandidates(cfg, 'cycle-ground-runs', {
      transport: async () => ({
        content: JSON.stringify([{ ...poolSkill('ci-general-ground-runs'), evidence_runs: ['hallucinated-run'] }]),
      }),
    })

    const candidate = JSON.parse(
      readFileSync(join(cfg.paths.workDir, 'candidates', 'cycle-ground-runs', 'ci-general-ground-runs.json'), 'utf8'),
    )
    const trace = JSON.parse(
      readFileSync(
        join(cfg.paths.workDir, 'reports', 'cycle-ground-runs', 'learn-traces', '001-task-a-failure-vs-std-code.json'),
        'utf8',
      ),
    )
    expect(candidate.evidence_runs).toEqual(['real-run-1', 'real-run-2'])
    expect(trace.evidenceRunCorrections).toEqual([
      {
        id: 'ci-general-ground-runs',
        from: ['hallucinated-run'],
        to: ['real-run-1', 'real-run-2'],
      },
    ])
  })

  test('dispatches learning roles by evidence kind and respects max new skills per task while scanning every evidence package', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-roles-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      limits: { ...config(root).limits, maxNewSkillsPerTask: 2 },
      tasks: { train: ['task-a', 'task-b'], valid: ['task-valid'] },
    }
    const evidenceDir = join(cfg.paths.workDir, 'evidence', 'cycle-roles')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, 'task-a-success.json'), JSON.stringify({ kind: 'success', taskId: 'task-a' }), 'utf8')
    writeFileSync(join(evidenceDir, 'task-a-success-vs-failure.json'), JSON.stringify({ kind: 'success-vs-failure', taskId: 'task-a' }), 'utf8')
    writeFileSync(join(evidenceDir, 'task-a-failure-vs-std-code.json'), JSON.stringify({ kind: 'failure-vs-std-code', taskId: 'task-a' }), 'utf8')
    writeFileSync(join(evidenceDir, 'task-b-success.json'), JSON.stringify({ kind: 'success', taskId: 'task-b' }), 'utf8')
    writeFileSync(join(evidenceDir, 'task-valid-success.json'), JSON.stringify({ kind: 'success', taskId: 'task-valid' }), 'utf8')
    const systemPrompts: string[] = []
    const taskIdsSeen: string[] = []
    const remainingBudgetsSeen: number[] = []

    const learned = await learnCycleCandidates(cfg, 'cycle-roles', {
      transport: async request => {
        systemPrompts.push(request.messages[0].content)
        const requestEvidence = JSON.parse(request.messages[1].content)
        taskIdsSeen.push(requestEvidence.taskId)
        remainingBudgetsSeen.push(requestEvidence.skillLearningBudget.remainingCandidateSlotsForTask)
        const id = `ci-general-${systemPrompts.length}`
        return {
          content: JSON.stringify([{ ...poolSkill(id), title: `Candidate ${systemPrompts.length}` }]),
        }
      },
    })

    expect(systemPrompts.join('\n')).toContain('trajectory-analyst')
    expect(systemPrompts.join('\n')).toContain('success-failure-comparator')
    expect(systemPrompts.join('\n')).toContain('std-code-comparator')
    expect(taskIdsSeen).toEqual(['task-a', 'task-a', 'task-a', 'task-b'])
    expect(remainingBudgetsSeen).toEqual([2, 1, 0, 2])
    expect(learned.map(candidate => candidate.id)).toEqual(['ci-general-1', 'ci-general-2', 'ci-general-4'])
    expect(existsSync(join(cfg.paths.workDir, 'reports', 'cycle-roles', 'learn-traces', '001-task-a-failure-vs-std-code.json'))).toBe(true)
    expect(
      JSON.parse(
        readFileSync(
          join(cfg.paths.workDir, 'reports', 'cycle-roles', 'learn-traces', '005-task-valid-success.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({
      skipped: true,
      skipReason: 'task is not configured as a train task',
      taskId: 'task-valid',
    })
    expect(existsSync(join(cfg.paths.workDir, 'candidates', 'cycle-roles', 'ci-general-3.json'))).toBe(false)
  })

  test('validates candidate skills through a native overlay before activation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-validate-candidates-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'ci-general-active': poolSkill('ci-general-active', 'active', 2),
          'ci-general-candidate': poolSkill('ci-general-candidate', 'candidate', 1),
        },
      }),
      'utf8',
    )
    const seen: Array<{ label: string; skillOptions: unknown }> = []

    const report = await validateCycleTrain(cfg, 'cycle-validate', {
      evaluate: async request => {
        seen.push({ label: request.label, skillOptions: request.skillOptions })
        if (request.label === 'skills') {
          for (const taskId of request.taskIds) {
            const runDir = join(request.runsDir, `${taskId}_20260602_010101`)
            const logsDir = join(runDir, 'logs')
            mkdirSync(logsDir, { recursive: true })
            writeFileSync(join(logsDir, 'run_summary.json'), JSON.stringify({ status: 'success', reward: 1 }), 'utf8')
            writeFileSync(
              join(logsDir, 'trajectory.clean.jsonl'),
              `${JSON.stringify({ kind: 'tool_call', round: 1, tool: 'Skill', input: { name: 'ci-general-candidate' } })}\n`,
              'utf8',
            )
            writeSkillApplication(runDir, ['ci-general-active', 'ci-general-candidate'])
          }
        }
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen.map(item => item.label)).toEqual(['baseline', 'active', 'skills'])
    expect(report.skillRun?.candidateSkillIds).toEqual(['ci-general-candidate'])
    expect(report.skillRun?.activeSkillIds).toEqual(['ci-general-active'])
    expect(report.skillRun?.allowedSkillNames).toEqual(['ci-general-active', 'ci-general-candidate'])
    expect(report.skillRun?.additionalSkillsDirs[0]).toContain(join('output', 'skill-learning', 'validation', 'cycle-validate', 'candidate-skills', 'skills'))
    expect(existsSync(join(cfg.paths.workDir, 'validation', 'cycle-validate', 'candidate-skills', 'skills', 'ci-general-candidate', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(cfg.paths.workDir, 'validation', 'cycle-validate', 'candidate-skills', 'skills', 'ci-general-candidate', 'contract.json'))).toBe(true)

    await activateValidatedSkills(cfg, 'cycle-validate')
    const pool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(pool.skills['ci-general-candidate'].validation.status).toBe('active')
  })

  test('skips train baseline rerun when indexed evidence already provides outcomes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-known-baseline-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['known-success', 'known-failure'], valid: ['valid-task'] },
    }
    const evidenceDir = join(cfg.paths.workDir, 'evidence', 'cycle-known-baseline')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, 'known-success-success.json'),
      JSON.stringify({ kind: 'success', taskId: 'known-success', runIds: ['run-success'] }),
      'utf8',
    )
    writeFileSync(
      join(evidenceDir, 'known-failure-failure-vs-std-code.json'),
      JSON.stringify({ kind: 'failure-vs-std-code', taskId: 'known-failure', runIds: ['run-failure'] }),
      'utf8',
    )
    const seen: string[] = []

    const report = await validateCycleTrain(cfg, 'cycle-known-baseline', {
      evaluate: async request => {
        seen.push(request.label)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen).toEqual(['skills'])
    expect(report.baseline).toEqual([
      { taskId: 'known-success', status: 'success', reward: 1 },
      { taskId: 'known-failure', status: 'failed', reward: 0 },
    ])
    expect(report.gates.noRegression).toBe(true)
    expect(report.gates.innovation).toBe(true)
  })

  test('exposes task-origin domain candidates plus all general candidates during train validation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-task-exposure-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a', 'task-b'], valid: ['valid-task'] },
    }
    mkdirSync(cfg.paths.workDir, { recursive: true })
    const domainA = {
      ...poolSkill('task-a-domain', 'candidate', 1),
      type: 'domain',
      math_physics_checks: ['Check task-a domain physics before applying this skill.'],
      evidence_runs: ['task-a-run'],
    }
    const domainB = {
      ...poolSkill('task-b-domain', 'candidate', 1),
      type: 'domain',
      math_physics_checks: ['Check task-b domain physics before applying this skill.'],
      evidence_runs: ['task-b-run'],
    }
    const general = {
      ...poolSkill('shared-general', 'candidate', 1),
      type: 'general',
      evidence_runs: ['task-a-run'],
    }
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'task-a-domain': domainA,
          'task-b-domain': domainB,
          'shared-general': general,
        },
      }),
      'utf8',
    )
    const evidenceDir = join(cfg.paths.workDir, 'evidence', 'cycle-task-exposure')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, 'task-a-success.json'),
      JSON.stringify({ kind: 'success', taskId: 'task-a', runIds: ['task-a-run'] }),
      'utf8',
    )
    writeFileSync(
      join(evidenceDir, 'task-b-failure-vs-std-code.json'),
      JSON.stringify({ kind: 'failure-vs-std-code', taskId: 'task-b', runIds: ['task-b-run'] }),
      'utf8',
    )
    const seen = []

    const report = await validateCycleTrain(cfg, 'cycle-task-exposure', {
      evaluate: async request => {
        seen.push(request)
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen.map(request => request.label)).toEqual(['skills'])
    const skillsRequest = seen[0]
    expect(skillsRequest.skillOptionsByTaskId?.['task-a'].allowedSkillNames).toEqual([
      'shared-general',
      'task-a-domain',
    ])
    expect(skillsRequest.skillOptionsByTaskId?.['task-b'].allowedSkillNames).toEqual([
      'shared-general',
      'task-b-domain',
    ])
    expect(report.skillRun?.candidateSkillIds).toEqual([
      'shared-general',
      'task-a-domain',
      'task-b-domain',
    ])
    expect(report.skillRun?.exposureByTask).toEqual({
      'task-a': ['shared-general', 'task-a-domain'],
      'task-b': ['shared-general', 'task-b-domain'],
    })
  })

  test('validates only failed train skill-run tasks during refinement iteration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-validate-failed-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a', 'task-b', 'task-c'], valid: ['valid-task'] },
    }
    mkdirSync(cfg.paths.workDir, { recursive: true })
    const domainA = {
      ...poolSkill('task-a-domain', 'candidate', 1),
      type: 'domain',
      math_physics_checks: ['Check task-a domain physics before applying this skill.'],
      evidence_runs: ['task-a-run'],
    }
    const domainC = {
      ...poolSkill('task-c-domain', 'candidate', 1),
      type: 'domain',
      math_physics_checks: ['Check task-c domain physics before applying this skill.'],
      evidence_runs: ['task-c-run'],
    }
    const general = {
      ...poolSkill('shared-general', 'candidate', 1),
      type: 'general',
      evidence_runs: ['task-a-run'],
    }
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'task-a-domain': domainA,
          'task-c-domain': domainC,
          'shared-general': general,
        },
      }),
      'utf8',
    )
    const evidenceDir = join(cfg.paths.workDir, 'evidence', 'cycle-validate-failed')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, 'task-a-success.json'), JSON.stringify({ kind: 'success', taskId: 'task-a', runIds: ['task-a-run'] }), 'utf8')
    writeFileSync(join(evidenceDir, 'task-c-success.json'), JSON.stringify({ kind: 'success', taskId: 'task-c', runIds: ['task-c-run'] }), 'utf8')
    await writeValidationReport(cfg, {
      cycleId: 'cycle-validate-failed',
      phase: 'train',
      baseline: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'success', reward: 1 },
        { taskId: 'task-c', status: 'failed', reward: 0 },
      ],
      skills: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'success', reward: 1 },
        { taskId: 'task-c', status: 'timeout', reward: 0 },
      ],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [],
        allowedSkillNames: ['shared-general', 'task-a-domain', 'task-c-domain'],
        activeSkillIds: [],
        candidateSkillIds: ['shared-general', 'task-a-domain', 'task-c-domain'],
        exposureByTask: {
          'task-a': ['shared-general', 'task-a-domain'],
          'task-b': ['shared-general'],
          'task-c': ['shared-general', 'task-c-domain'],
        },
      },
      gates: {
        noRegression: true,
        activeNoRegression: true,
        innovation: false,
        trainPassed: false,
        validAllowed: false,
      },
    })
    const seen: Array<{ label: string; taskIds: string[] }> = []

    const report = await validateFailedCycleTrain(cfg, 'cycle-validate-failed', {
      evaluate: async request => {
        seen.push({ label: request.label, taskIds: request.taskIds })
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen).toEqual([{ label: 'skills', taskIds: ['task-a', 'task-c'] }])
    expect(report.scope).toEqual({
      taskIds: ['task-a', 'task-c'],
      source: 'train-report.json',
      reason: 'failed skills-run tasks from latest train validation report',
    })
    expect(report.skillRun?.exposureByTask).toEqual({
      'task-a': ['shared-general', 'task-a-domain'],
      'task-c': ['shared-general', 'task-c-domain'],
    })
    expect(existsSync(join(cfg.paths.workDir, 'validation', 'cycle-validate-failed', TRAIN_FAILED_REPORT_FILE))).toBe(true)
    expect(JSON.parse(readFileSync(join(cfg.paths.workDir, 'validation', 'cycle-validate-failed', 'train-report.json'), 'utf8')).skills)
      .toHaveLength(3)
  })

  test('filters validate-train-failed failed task ids to the current train config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-validate-failed-current-train-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a', 'task-c'], valid: ['valid-task'] },
    }
    await writeValidationReport(cfg, {
      cycleId: 'cycle-current-train',
      phase: 'train',
      baseline: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'failed', reward: 0 },
        { taskId: 'task-c', status: 'success', reward: 1 },
      ],
      skills: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'failed', reward: 0 },
        { taskId: 'task-c', status: 'success', reward: 1 },
      ],
      gates: {
        noRegression: true,
        activeNoRegression: true,
        innovation: false,
        trainPassed: false,
        validAllowed: false,
      },
    })
    const seen: Array<{ label: string; taskIds: string[] }> = []

    const report = await validateFailedCycleTrain(cfg, 'cycle-current-train', {
      evaluate: async request => {
        seen.push({ label: request.label, taskIds: request.taskIds })
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen).toEqual([{ label: 'skills', taskIds: ['task-a'] }])
    expect(report.scope).toEqual({
      taskIds: ['task-a'],
      source: 'train-report.json',
      reason: 'failed skills-run tasks from latest train validation report',
    })
    expect(report.baseline).toEqual([{ taskId: 'task-a', status: 'failed', reward: 0 }])
  })

  test('ignores stale train-failed report whose tasks are outside the current train config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-stale-failed-report-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a'], valid: ['valid-task'] },
    }
    await writeValidationReport(cfg, {
      cycleId: 'cycle-stale-report',
      phase: 'train',
      baseline: [{ taskId: 'task-a', status: 'failed', reward: 0 }],
      skills: [{ taskId: 'task-a', status: 'failed', reward: 0 }],
      gates: {
        noRegression: true,
        activeNoRegression: true,
        innovation: false,
        trainPassed: false,
        validAllowed: false,
      },
    })
    await writeValidationReport(cfg, {
      cycleId: 'cycle-stale-report',
      phase: 'train',
      scope: {
        taskIds: ['old-task'],
        source: 'train-report.json',
        reason: 'failed skills-run tasks from old config',
      },
      baseline: [{ taskId: 'old-task', status: 'failed', reward: 0 }],
      skills: [{ taskId: 'old-task', status: 'failed', reward: 0 }],
      gates: {
        noRegression: true,
        activeNoRegression: true,
        innovation: false,
        trainPassed: false,
        validAllowed: false,
      },
    }, TRAIN_FAILED_REPORT_FILE)
    const validationDir = join(cfg.paths.workDir, 'validation', 'cycle-stale-report')
    const now = Date.now() / 1000
    utimesSync(join(validationDir, 'train-report.json'), now - 60, now - 60)
    utimesSync(join(validationDir, TRAIN_FAILED_REPORT_FILE), now, now)
    const seen: Array<{ label: string; taskIds: string[] }> = []

    const report = await validateFailedCycleTrain(cfg, 'cycle-stale-report', {
      evaluate: async request => {
        seen.push({ label: request.label, taskIds: request.taskIds })
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen).toEqual([{ label: 'skills', taskIds: ['task-a'] }])
    expect(report.scope?.source).toBe('train-report.json')
    expect(report.scope?.taskIds).toEqual(['task-a'])
  })

  test('skips already recovered tasks during validate-train-failed when configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-skip-recovered-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      limits: { ...config(root).limits, skipAlreadyRecoveredTasks: true },
      tasks: { train: ['task-a', 'task-b'], valid: ['valid-task'] },
    }
    await writeValidationReport(cfg, {
      cycleId: 'cycle-skip-recovered',
      phase: 'train',
      scope: {
        taskIds: ['task-a', 'task-b'],
        source: 'train-report.json',
        reason: 'older failed-only validation recovered task-a',
      },
      baseline: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'failed', reward: 0 },
      ],
      skills: [
        { taskId: 'task-a', status: 'success', reward: 1 },
        { taskId: 'task-b', status: 'failed', reward: 0 },
      ],
      gates: {
        noRegression: true,
        activeNoRegression: true,
        innovation: true,
        trainPassed: false,
        validAllowed: false,
      },
    }, TRAIN_FAILED_REPORT_FILE)
    await writeValidationReport(cfg, {
      cycleId: 'cycle-skip-recovered',
      phase: 'train',
      baseline: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'failed', reward: 0 },
      ],
      skills: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'failed', reward: 0 },
      ],
      gates: {
        noRegression: true,
        activeNoRegression: true,
        innovation: false,
        trainPassed: false,
        validAllowed: false,
      },
    })
    const validationDir = join(cfg.paths.workDir, 'validation', 'cycle-skip-recovered')
    const now = Date.now() / 1000
    utimesSync(join(validationDir, TRAIN_FAILED_REPORT_FILE), now - 60, now - 60)
    utimesSync(join(validationDir, 'train-report.json'), now, now)
    const seen: Array<{ label: string; taskIds: string[] }> = []

    const report = await validateFailedCycleTrain(cfg, 'cycle-skip-recovered', {
      evaluate: async request => {
        seen.push({ label: request.label, taskIds: request.taskIds })
        return {
          ok: true,
          taskResults: request.taskIds.map(taskId => ({ taskId, status: 'success', reward: 1 })),
        }
      },
    })

    expect(seen).toEqual([{ label: 'skills', taskIds: ['task-b'] }])
    expect(report.scope?.taskIds).toEqual(['task-b'])
    expect(report.staleReportsIgnored).toContainEqual({
      source: 'train-failed-report.json',
      reason: 'task-a: already recovered in a compatible validation report',
    })
  })

  test('refines failed validation skills by revising exposed pool entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-refine-failed-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a', 'task-b'], valid: ['valid-task'] },
    }
    mkdirSync(cfg.paths.workDir, { recursive: true })
    const failingSkill = {
      ...poolSkill('task-a-domain', 'candidate', 0),
      type: 'domain',
      math_physics_checks: [
        'Check the physical model convention against public metadata and a cheap consistency probe before increasing iteration count.',
        'Confirm that the cheap forward or adjoint sanity check moves in the expected direction before long optimization.',
      ],
      evidence_runs: ['task-a-run'],
    }
    const unrelatedSkill = {
      ...poolSkill('shared-general', 'candidate', 0),
      type: 'general',
      evidence_runs: ['task-b-run'],
    }
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'task-a-domain': failingSkill,
          'shared-general': unrelatedSkill,
        },
      }),
      'utf8',
    )
    const runLogs = join(cfg.paths.workDir, 'validation', 'cycle-refine', 'train-skills-runs', 'task-a_20260529_010101', 'logs')
    mkdirSync(runLogs, { recursive: true })
    writeFileSync(join(runLogs, 'trajectory.clean.jsonl'), '{"kind":"run_finished","status":"failed"}\n', 'utf8')
    writeFileSync(join(runLogs, 'run_summary.json'), JSON.stringify({ status: 'failed', reward: 0, rounds: 5 }), 'utf8')
    await writeValidationReport(cfg, {
      cycleId: 'cycle-refine',
      phase: 'train',
      baseline: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'success', reward: 1 },
      ],
      skills: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-b', status: 'success', reward: 1 },
      ],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [],
        allowedSkillNames: ['task-a-domain', 'shared-general'],
        activeSkillIds: [],
        candidateSkillIds: ['task-a-domain', 'shared-general'],
        exposureByTask: {
          'task-a': ['task-a-domain'],
          'task-b': ['shared-general'],
        },
        candidateCoverage: {
          'task-a-domain': ['task-a'],
          'shared-general': ['task-b'],
        },
      },
      gates: {
        noRegression: true,
        activeNoRegression: true,
        innovation: false,
        trainPassed: false,
        validAllowed: false,
      },
    })
    const seenEvidence: unknown[] = []

    const refined = await refineFailedCycleSkills(cfg, 'cycle-refine', {
      transport: async request => {
        seenEvidence.push(JSON.parse(request.messages[1].content))
        return {
          content: JSON.stringify([
            {
              ...failingSkill,
              summary:
                'Use this revised skill when a reconstruction keeps failing or timing out after valid output generation and the agent must verify model conventions from public metadata and cheap probes before spending more time on optimization.',
              problem_signals: [
                'Judge metrics stay below threshold even though output format is valid and long optimization appears to reduce a proxy loss.',
                'The agent keeps increasing iterations or model size without first proving that the forward model convention matches public metadata and sanity probes.',
              ],
              diagnostic_steps: [
                'Before another long run, inspect public metadata, visible data shapes, coordinate descriptions, scaling notes, and operator-order assumptions.',
                'Run a cheap sanity check such as zero-model, identity propagation, or one-iteration forward consistency before full optimization.',
                'Set a hard wall-clock or iteration budget and stop when the cheap metric is not improving in the expected direction.',
              ],
              guidance: [
                'Prefer convention checks and cheap probes over simply increasing reconstruction iterations after a failed validation.',
                'Carry forward the public-data convention into the solver plan and record the exact sanity check that justified the expensive run.',
              ],
              anti_patterns: [
                'Do not extend GPU optimization just because proxy loss decreases while judge metrics remain failed.',
                'Do not treat a valid output schema as evidence that the physical forward model convention is correct.',
              ],
              validation: { ...failingSkill.validation, regressions: 2 },
            },
          ]),
        }
      },
    })

    expect(refined.revised.map(skill => skill.id)).toEqual(['task-a-domain'])
    expect(seenEvidence).toHaveLength(1)
    expect(seenEvidence[0]).toMatchObject({
      kind: 'validation-failure-refinement',
      taskId: 'task-a',
      exposedSkillIds: ['task-a-domain'],
    })
    const updatedPool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(updatedPool.skills['task-a-domain'].summary).toContain('revised skill')
    expect(updatedPool.skills['task-a-domain'].validation.regressions).toBe(0)
    expect(updatedPool.skills['shared-general'].summary).toBe(unrelatedSkill.summary)
    expect(existsSync(join(cfg.paths.workDir, 'revisions', 'cycle-refine', 'task-a-domain.json'))).toBe(true)
  })

  test('refine-failed records one task transport error and continues refining later failed tasks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-refine-continue-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a', 'task-c'], valid: [] },
    }
    mkdirSync(cfg.paths.workDir, { recursive: true })
    const skillA = { ...poolSkill('task-a-domain'), type: 'domain', evidence_runs: ['task-a-run'] }
    const skillC = {
      ...poolSkill('task-c-domain'),
      type: 'domain',
      evidence_runs: ['task-c-run'],
      math_physics_checks: [
        'Check the public geometry convention with a cheap forward-adjoint probe before optimization.',
        'Check that output scale and support match public metadata before a long run.',
      ],
    }
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({ version: 1, skills: { 'task-a-domain': skillA, 'task-c-domain': skillC } }),
      'utf8',
    )
    const staleRevisionDir = join(cfg.paths.workDir, 'revisions', 'cycle-refine-continue')
    mkdirSync(staleRevisionDir, { recursive: true })
    writeFileSync(join(staleRevisionDir, 'stale-skill.json'), '{}\n', 'utf8')
    const staleReportDir = join(cfg.paths.workDir, 'reports', 'cycle-refine-continue')
    mkdirSync(staleReportDir, { recursive: true })
    writeFileSync(join(staleReportDir, 'refine-summary.json'), '{"stale":true}\n', 'utf8')
    await writeValidationReport(cfg, {
      cycleId: 'cycle-refine-continue',
      phase: 'train',
      baseline: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-c', status: 'failed', reward: 0 },
      ],
      skills: [
        { taskId: 'task-a', status: 'failed', reward: 0 },
        { taskId: 'task-c', status: 'failed', reward: 0 },
      ],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [],
        allowedSkillNames: ['task-a-domain', 'task-c-domain'],
        activeSkillIds: [],
        candidateSkillIds: ['task-a-domain', 'task-c-domain'],
        exposureByTask: {
          'task-a': ['task-a-domain'],
          'task-c': ['task-c-domain'],
        },
      },
      gates: { noRegression: true, activeNoRegression: true, innovation: false, trainPassed: false, validAllowed: false },
    })

    const refined = await refineFailedCycleSkills(cfg, 'cycle-refine-continue', {
      transport: async request => {
        const evidence = JSON.parse(request.messages[1].content)
        if (evidence.taskId === 'task-a') throw new Error('The operation timed out.')
        return {
          content: JSON.stringify([
            {
              ...skillC,
              summary:
                'Use this revised skill when a reconstruction task repeatedly fails despite valid outputs and the agent needs to verify geometry, scale, and support with cheap probes before another long run.',
              problem_signals: [
                'Judge metrics fail repeatedly even though output files are valid and finite.',
                'The agent keeps changing long-run solvers without checking public geometry or scale conventions first.',
              ],
              diagnostic_steps: [
                'Inspect public geometry and output schema to identify required axes, support, and scale conventions.',
                'Run a cheap forward-adjoint or reconstruction probe on a tiny subset before any full optimization.',
                'Record the probe result and stop if geometry or scale is inconsistent with public metadata.',
              ],
              guidance: [
                'Use cheap convention probes before spending another full round on optimization.',
                'Revise one convention at a time and keep the previous best valid output as a fallback.',
              ],
              anti_patterns: [
                'Do not repeat a long optimization after a metric failure without a new cheap probe.',
                'Do not change geometry and scale in the same round without isolating which one failed.',
              ],
              validation: { ...skillC.validation, regressions: 1 },
            },
          ]),
        }
      },
    })

    const summary = JSON.parse(
      readFileSync(join(cfg.paths.workDir, 'reports', 'cycle-refine-continue', 'refine-summary.json'), 'utf8'),
    )
    expect(refined.revised.map(skill => skill.id)).toEqual(['task-c-domain'])
    expect(summary.entries).toMatchObject([
      { taskId: 'task-a', status: 'generation_error', generationError: 'The operation timed out.' },
      { taskId: 'task-c', status: 'submitted_candidates', acceptedIds: ['task-c-domain'] },
    ])
    expect(existsSync(join(staleRevisionDir, 'stale-skill.json'))).toBe(false)
    expect(existsSync(join(staleRevisionDir, 'task-c-domain.json'))).toBe(true)
  })

  test('refine-failed removes existing candidate skills rejected by the current critic policy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-refine-policy-prune-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a'], valid: [] },
    }
    mkdirSync(cfg.paths.workDir, { recursive: true })
    const badSkill = {
      ...poolSkill('bad-wave-policy'),
      math_physics_checks: [
        'Sub-stepping must conserve source energy under the chosen discretization before any long run starts.',
        'Reference implementations typically use a specific source injection convention, so copy that behavior.',
      ],
    }
    const goodSkill = {
      ...poolSkill('good-runtime-gate'),
      guidance: [
        'Use a cheap runtime probe and record the observed scaling before another long reconstruction attempt.',
        'Keep the next change narrow enough that validation can attribute the result to one decision.',
      ],
    }
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({ version: 1, skills: { 'bad-wave-policy': badSkill, 'good-runtime-gate': goodSkill } }),
      'utf8',
    )
    await writeValidationReport(cfg, {
      cycleId: 'cycle-refine-policy-prune',
      phase: 'train',
      baseline: [{ taskId: 'task-a', status: 'failed', reward: 0 }],
      skills: [{ taskId: 'task-a', status: 'failed', reward: 0 }],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [],
        allowedSkillNames: ['bad-wave-policy', 'good-runtime-gate'],
        activeSkillIds: [],
        candidateSkillIds: ['bad-wave-policy', 'good-runtime-gate'],
        exposureByTask: {
          'task-a': ['bad-wave-policy', 'good-runtime-gate'],
        },
      },
      gates: { noRegression: true, activeNoRegression: true, innovation: false, trainPassed: false, validAllowed: false },
    })

    const refined = await refineFailedCycleSkills(cfg, 'cycle-refine-policy-prune', {
      transport: async () => ({
        content: JSON.stringify([
          {
            ...goodSkill,
            summary:
              'Use this revised skill when repeated metric failures show that the agent needs a cheap runtime and output-quality gate before spending another full evaluation round on reconstruction.',
            problem_signals: [
              'The output schema is valid but the judge metrics remain below threshold after multiple long attempts.',
              'The agent keeps adding expensive iterations without recording a cheap probe that predicts useful metric movement.',
            ],
            diagnostic_steps: [
              'Run a tiny probe that exercises the same operator path and record wall-clock time, finite output checks, and a simple metric proxy.',
              'Estimate the full-run budget from the probe before selecting iteration counts or grid refinements.',
              'Stop and revise the model convention if the cheap probe does not improve the targeted public proxy.',
            ],
          },
        ]),
      }),
    })

    const updatedPool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(refined.policyRejectedPoolSkills.map(skill => skill.id)).toEqual(['bad-wave-policy'])
    expect(updatedPool.skills['bad-wave-policy']).toBeUndefined()
    expect(updatedPool.skills['good-runtime-gate'].summary).toContain('revised skill')
  })

  test('refine-failed can repair an exposed skill that was pruned but still exists as a cycle candidate artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-refine-missing-exposed-'))
    roots.push(root)
    const cfg = {
      ...config(root),
      tasks: { train: ['task-a'], valid: [] },
    }
    const cycleId = 'cycle-refine-missing-exposed'
    mkdirSync(cfg.paths.workDir, { recursive: true })
    const historicalSkill = {
      ...poolSkill('wave-runtime-probe'),
      type: 'domain',
      math_physics_checks: [
        'Compute the numerical stability condition before selecting a long optimization schedule.',
        'Do not justify a source injection convention by saying reference implementations typically do it that way.',
      ],
    }
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({ version: 1, skills: {} }),
      'utf8',
    )
    mkdirSync(join(cfg.paths.workDir, 'candidates', cycleId), { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'candidates', cycleId, 'wave-runtime-probe.json'),
      JSON.stringify(historicalSkill),
      'utf8',
    )
    await writeValidationReport(cfg, {
      cycleId,
      phase: 'train',
      baseline: [{ taskId: 'task-a', status: 'failed', reward: 0 }],
      skills: [{ taskId: 'task-a', status: 'failed', reward: 0 }],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [],
        allowedSkillNames: ['wave-runtime-probe'],
        activeSkillIds: [],
        candidateSkillIds: ['wave-runtime-probe'],
        exposureByTask: {
          'task-a': ['wave-runtime-probe'],
        },
      },
      gates: { noRegression: true, activeNoRegression: true, innovation: false, trainPassed: false, validAllowed: false },
    })

    const seenEvidence: unknown[] = []
    const refined = await refineFailedCycleSkills(cfg, cycleId, {
      transport: async request => {
        const evidence = JSON.parse(request.messages[1].content)
        seenEvidence.push(evidence)
        return {
          content: JSON.stringify([
            {
              ...historicalSkill,
              summary:
                'Use this revised skill when a wave-propagation reconstruction keeps failing and the agent must prove stability, finite output, and a useful forward-model probe before choosing any long optimization schedule.',
              problem_signals: [
                'A wave-based inversion produces valid output files but judge metrics fail after expensive optimization.',
                'The agent proposes longer optimization before showing a cheap forward-model residual or finite receiver trace probe.',
              ],
              diagnostic_steps: [
                'Compute the stability limit from public grid spacing, time step, dimension, and maximum velocity before implementation.',
                'Run a one-source, short-time forward probe and record finite receiver traces plus a rough residual against public observations if available.',
                'Only start a long optimization after the probe shows non-zero finite outputs and the residual can plausibly improve from parameter updates.',
              ],
              math_physics_checks: [
                'Verify that the chosen time step or sub-stepping ratio satisfies the stability bound with a safety margin.',
                'Verify source injection, receiver sampling, and boundary damping through a tiny forward probe before long optimization.',
              ],
              guidance: [
                'Treat a failed cheap forward probe as a model-convention bug, not as a reason to add more optimization epochs.',
                'Prefer repairing the forward model or reducing to a smaller probe over extending a long run with an unvalidated operator.',
              ],
              anti_patterns: [
                'Do not compensate for a failed forward-model probe by increasing epochs or learning rate.',
                'Do not rely on valid output shape as evidence that the propagation operator is correct.',
              ],
            },
          ]),
        }
      },
    })

    const updatedPool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(refined.revised.map(skill => skill.id)).toEqual(['wave-runtime-probe'])
    expect(seenEvidence).toHaveLength(1)
    expect(seenEvidence[0]).toMatchObject({
      existingSkills: [expect.objectContaining({ id: 'wave-runtime-probe' })],
    })
    expect(updatedPool.skills['wave-runtime-probe'].summary).toContain('revised skill')
    expect(JSON.stringify(updatedPool.skills['wave-runtime-probe'])).not.toContain('reference implementations')
  })

  test('activates candidates after train validation passes and renders native skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-activate-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'ci-general-feedback-loop': {
            id: 'ci-general-feedback-loop',
            namespace: 'computational-imaging',
            type: 'general',
            title: 'Use judge feedback as one hypothesis',
            trigger: 'Judge feedback identifies a concrete output mismatch.',
            domain_tags: ['general'],
            guidance: ['Convert feedback into one falsifiable hypothesis and validate the smallest related artifact.'],
            anti_patterns: ['Do not change unrelated algorithms in the same round.'],
            evidence_runs: ['run-1'],
            validation: { status: 'candidate', used_count: 0, success_delta: 0, regressions: 0 },
          },
        },
      }),
      'utf8',
    )
    await writeValidationReport(cfg, {
      cycleId: 'cycle-3',
      phase: 'train',
      baseline: [],
      skills: [],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [],
        allowedSkillNames: ['ci-general-feedback-loop'],
        activeSkillIds: [],
        candidateSkillIds: ['ci-general-feedback-loop'],
      },
      gates: { noRegression: true, innovation: true, trainPassed: true, validAllowed: true },
    })

    await activateValidatedSkills(cfg, 'cycle-3')
    await writeCycleReport(cfg, 'cycle-3')

    expect(existsSync(join(cfg.paths.activeSkillsDir, 'ci-general-feedback-loop', 'SKILL.md'))).toBe(true)
    expect(JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8')).skills['ci-general-feedback-loop'].validation.status).toBe('active')
    expect(existsSync(join(cfg.paths.workDir, 'cycles', 'cycle-3', 'report.json'))).toBe(true)
  })

  test('quarantines active skills and removes rendered files when train validation regresses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-quarantine-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'ci-general-active': {
            id: 'ci-general-active',
            namespace: 'computational-imaging',
            type: 'general',
            title: 'Active skill',
            trigger: 'Judge feedback identifies a concrete output mismatch.',
            domain_tags: ['general'],
            guidance: ['Convert feedback into one falsifiable hypothesis and validate the smallest related artifact.'],
            anti_patterns: ['Do not change unrelated algorithms in the same round.'],
            evidence_runs: ['run-1'],
            validation: { status: 'active', used_count: 1, success_delta: 1, regressions: 0 },
          },
        },
      }),
      'utf8',
    )
    await writeValidationReport(cfg, {
      cycleId: 'cycle-regression',
      phase: 'train',
      baseline: [{ taskId: 'train-task', status: 'success' }],
      skills: [{ taskId: 'train-task', status: 'failed' }],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [],
        allowedSkillNames: ['ci-general-active'],
        activeSkillIds: ['ci-general-active'],
        candidateSkillIds: [],
      },
      gates: { noRegression: false, innovation: false, trainPassed: false, validAllowed: false },
    })
    await activateValidatedSkills(cfg, 'cycle-regression').catch(() => undefined)
    expect(existsSync(join(cfg.paths.activeSkillsDir, 'ci-general-active'))).toBe(false)

    await quarantineActiveSkillsAfterRegression(cfg, 'cycle-regression')

    const pool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(pool.skills['ci-general-active'].validation.status).toBe('quarantine')
    expect(pool.skills['ci-general-active'].validation.regressions).toBe(1)
    expect(existsSync(join(cfg.paths.workDir, 'quarantine', 'cycle-regression', 'ci-general-active.json'))).toBe(true)
  })

  test('quarantines validated candidates instead of clearing unrelated active skills on candidate regression', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-candidate-quarantine-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'ci-general-active': poolSkill('ci-general-active', 'active', 2),
          'ci-general-candidate': poolSkill('ci-general-candidate', 'candidate', 1),
        },
      }),
      'utf8',
    )
    await writeValidationReport(cfg, {
      cycleId: 'cycle-candidate-regression',
      phase: 'train',
      baseline: [{ taskId: 'train-task', status: 'success' }],
      active: [{ taskId: 'train-task', status: 'success' }],
      skills: [{ taskId: 'train-task', status: 'failed' }],
      skillRun: {
        skillsDir: cfg.paths.activeSkillsDir,
        additionalSkillsDirs: [join(cfg.paths.workDir, 'validation', 'cycle-candidate-regression', 'candidate-skills', 'skills')],
        allowedSkillNames: ['ci-general-active', 'ci-general-candidate'],
        activeSkillIds: ['ci-general-active'],
        candidateSkillIds: ['ci-general-candidate'],
      },
      gates: {
        noRegression: false,
        activeNoRegression: true,
        innovation: false,
        trainPassed: false,
        validAllowed: false,
      },
    })

    await quarantineActiveSkillsAfterRegression(cfg, 'cycle-candidate-regression')

    const pool = JSON.parse(readFileSync(join(cfg.paths.workDir, 'pool.json'), 'utf8'))
    expect(pool.skills['ci-general-active'].validation.status).toBe('active')
    expect(pool.skills['ci-general-candidate'].validation.status).toBe('quarantine')
  })

  test('refuses broad quarantine when a regression report has no under-test attribution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-cycle-quarantine-no-attribution-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(
      join(cfg.paths.workDir, 'pool.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'ci-general-active': poolSkill('ci-general-active', 'active', 2),
        },
      }),
      'utf8',
    )
    await writeValidationReport(cfg, {
      cycleId: 'cycle-no-attribution',
      phase: 'train',
      baseline: [{ taskId: 'train-task', status: 'success' }],
      skills: [{ taskId: 'train-task', status: 'failed' }],
      gates: { noRegression: false, innovation: false, trainPassed: false, validAllowed: false },
    })

    await expect(quarantineActiveSkillsAfterRegression(cfg, 'cycle-no-attribution')).rejects.toThrow('lacks skillRun attribution')
  })
})
