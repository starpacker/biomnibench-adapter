import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as runnerModule from './learningSubagentRunner.js'
import { runLearningAgent } from './learningSubagentRunner.js'
import { createLearningToolPolicy } from './toolPolicy.js'
import type { SkillLearningConfig } from '../config.js'

const roots: string[] = []
const envKeys = [
  'SKILL_LEARNING_LLM_BASE_URL',
  'SKILL_LEARNING_LLM_API_KEY',
  'SKILL_LEARNING_LLM_MODEL',
  'SKILL_LEARNING_GATEWAY_PROTOCOL',
  'BASE_URL',
  'API_KEY',
  'MODEL_NAME',
  'GATEWAY_PROTOCOL',
] as const
const originalEnv = new Map<string, string | undefined>()
const originalFetch = globalThis.fetch

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const key of envKeys) {
    const value = originalEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
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
  }
}

function candidateJson(id = 'ci-general-feedback-hypothesis'): Record<string, unknown> {
  return {
    schema_version: 2,
    id,
    namespace: 'computational-imaging',
    type: 'general',
    title: 'Convert feedback into one hypothesis',
    trigger: 'Judge feedback identifies a concrete output mismatch.',
    domain_tags: ['general'],
    summary:
      'Use this skill when a valid computational imaging submission receives concrete judge feedback and the next useful move is to isolate one small hypothesis instead of rewriting multiple solver components.',
    problem_signals: [
      'The output schema is valid, but judge feedback names a concrete quality or metric mismatch.',
      'The previous attempt changed multiple unrelated choices, making the next debugging step ambiguous.',
    ],
    diagnostic_steps: [
      'Restate the feedback as one falsifiable hypothesis tied to a single artifact, metric, or model assumption.',
      'Inspect the smallest relevant public contract or generated output before editing algorithm code.',
      'Apply one targeted change and rerun the narrowest available check before another full task attempt.',
    ],
    math_physics_checks: [],
    tool_decision_rules: [
      'Use read/list tools for the failing artifact and contract before running expensive full reconstruction commands.',
    ],
    validation_checks: [
      'Check that the targeted artifact or metric moves in the expected direction after the single change.',
      'Confirm the output schema and finite-value constraints still pass before final submission.',
    ],
    transfer_scope:
      'Applies across computational imaging tasks where visible feedback and public contracts guide debugging without access to hidden targets.',
    guidance: [
      'Make one falsifiable change at a time and rerun the smallest relevant check.',
      'Record the hypothesis and local check result before spending another full evaluation round.',
    ],
    anti_patterns: [
      'Do not alter unrelated physics and IO handling in the same round.',
      'Do not tune parameters before inspecting the specific artifact or metric named by feedback.',
    ],
    evidence_runs: ['run-1'],
    validation: {
      status: 'candidate',
      used_count: 0,
      success_delta: 0,
      regressions: 0,
    },
  }
}

describe('runLearningAgent', () => {
  test('defaults to llm-probe env names and uses Anthropic messages when GATEWAY_PROTOCOL is anthropic', async () => {
    for (const key of envKeys) originalEnv.set(key, process.env[key])
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-anthropic-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.runRoots[0], { recursive: true })
    writeFileSync(join(cfg.paths.runRoots[0], 'safe.txt'), 'safe evidence', 'utf8')
    process.env.BASE_URL = 'https://gateway.example'
    process.env.API_KEY = 'test-key'
    process.env.MODEL_NAME = 'task-solver-model'
    process.env.GATEWAY_PROTOCOL = 'anthropic'
    const requests: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')),
        headers: init?.headers,
      })
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'read_text_file',
                input: { path: join(cfg.paths.runRoots[0], 'safe.txt') },
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '[]' }] }), { status: 200 })
    }) as typeof fetch

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
    })

    expect(result.candidates).toEqual([])
    expect(requests).toHaveLength(2)
    expect(requests[0].url).toBe('https://gateway.example/v1/messages')
    expect(JSON.stringify(requests[0].headers)).toContain('anthropic-version')
    expect(JSON.stringify(requests[0].headers)).toContain('x-api-key')
    expect(requests[0].body).toMatchObject({
      model: 'task-solver-model',
      system: expect.stringContaining('trajectory-analyst'),
    })
    expect((requests[0].body as { tools?: Array<Record<string, unknown>> }).tools?.[0]).toMatchObject({
      name: 'read_text_file',
      input_schema: expect.any(Object),
    })
    expect(JSON.stringify(requests[1].body)).toContain('tool_result')
  })

  test('defaults learning model from MODEL_NAME and lets SKILL_LEARNING_LLM_MODEL override it', async () => {
    for (const key of envKeys) originalEnv.set(key, process.env[key])
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-model-env-'))
    roots.push(root)
    const cfg = config(root)
    process.env.SKILL_LEARNING_LLM_BASE_URL = 'https://gateway.example'
    process.env.SKILL_LEARNING_LLM_API_KEY = 'test-key'
    process.env.MODEL_NAME = 'task-solver-model'
    const models: string[] = []

    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      models.push(body.model ?? '')
      return new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 })
    }) as typeof fetch

    await runLearningAgent({
      role: 'skill-writer',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
    })
    expect(models).toEqual(['task-solver-model'])

    process.env.SKILL_LEARNING_LLM_MODEL = 'explicit-learning-model'
    models.length = 0
    await runLearningAgent({
      role: 'skill-writer',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
    })

    expect(models).toEqual(['explicit-learning-model'])
  })

  test('does not fall back to config model when API env is set without local model env', async () => {
    for (const key of envKeys) originalEnv.set(key, process.env[key])
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-missing-model-env-'))
    roots.push(root)
    const cfg = config(root)
    process.env.SKILL_LEARNING_LLM_BASE_URL = 'https://gateway.example'
    process.env.SKILL_LEARNING_LLM_API_KEY = 'test-key'
    delete process.env.SKILL_LEARNING_LLM_MODEL
    delete process.env.MODEL_NAME

    await expect(
      runLearningAgent({
        role: 'skill-writer',
        evidence: { kind: 'success', taskId: 'task-a' },
        config: cfg,
      }),
    ).rejects.toThrow('Missing LLM model env')
  })

  test('explicit skill-learning protocol overrides generic GATEWAY_PROTOCOL', async () => {
    for (const key of envKeys) originalEnv.set(key, process.env[key])
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-protocol-env-'))
    roots.push(root)
    const cfg = config(root)
    process.env.BASE_URL = 'https://task-gateway.example'
    process.env.API_KEY = 'task-key'
    process.env.GATEWAY_PROTOCOL = 'anthropic'
    process.env.SKILL_LEARNING_LLM_BASE_URL = 'https://learning-gateway.example'
    process.env.SKILL_LEARNING_LLM_API_KEY = 'learning-key'
    process.env.SKILL_LEARNING_LLM_MODEL = 'learning-model'
    process.env.SKILL_LEARNING_GATEWAY_PROTOCOL = 'openai-compatible'
    const requests: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')),
        headers: init?.headers,
      })
      return new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 })
    }) as typeof fetch

    await runLearningAgent({
      role: 'skill-writer',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://learning-gateway.example/v1/chat/completions')
    expect(requests[0].body).toMatchObject({ model: 'learning-model' })
    expect(JSON.stringify(requests[0].headers)).toContain('Bearer learning-key')
  })

  test('defaults to OpenAI-compatible transport when no protocol is configured', async () => {
    for (const key of envKeys) originalEnv.set(key, process.env[key])
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-openai-default-'))
    roots.push(root)
    const cfg = config(root)
    process.env.BASE_URL = 'https://gateway.example/v1'
    process.env.API_KEY = 'test-key'
    process.env.MODEL_NAME = 'task-solver-model'
    const urls: string[] = []

    globalThis.fetch = (async (url, _init) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 })
    }) as typeof fetch

    await runLearningAgent({
      role: 'skill-writer',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
    })

    expect(urls).toEqual(['https://gateway.example/v1/chat/completions'])
  })

  test('uses a tool-capable subAgent request instead of exporting naked completion helpers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-'))
    roots.push(root)
    const cfg = config(root)
    const seenToolCounts: number[] = []

    const result = await runLearningAgent({
      role: 'skill-writer',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async request => {
        seenToolCounts.push(request.tools.length)
        return {
          content: JSON.stringify([candidateJson()]),
        }
      },
    })

    expect(seenToolCounts).toEqual([4])
    expect(Object.keys(runnerModule).some(name => /completion/i.test(name))).toBe(false)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].id).toBe('ci-general-feedback-hypothesis')
  })

  test('accepts final skill candidates through a structured submit tool', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-submit-'))
    roots.push(root)
    const cfg = config(root)

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async () => ({
        toolCalls: [
          {
            id: 'submit-1',
            name: 'submit_skill_candidates',
            arguments: {
              candidates: [candidateJson()],
            },
          },
        ],
      }),
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].id).toBe('ci-general-feedback-hypothesis')
    expect(result.toolResults.at(-1)).toMatchObject({
      tool: 'submit_skill_candidates',
      ok: true,
    })
  })

  test('accepts explicit empty submissions only when a reusable no-candidate reason is provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-empty-submit-'))
    roots.push(root)
    const cfg = config(root)
    let attempts = 0

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async request => {
        attempts++
        if (request.messages.at(-1)?.role === 'tool') {
          return {
            toolCalls: [
              {
                id: 'submit-2',
                name: 'submit_skill_candidates',
                arguments: {
                  candidates: [],
                  no_candidate_reason:
                    'The available evidence did not reveal a transferable skill beyond existing debugging and physics checks.',
                  no_candidate_evidence: ['All concrete observations were task-specific or already covered.'],
                },
              },
            ],
          }
        }
        return {
          toolCalls: [
            {
              id: 'submit-1',
              name: 'submit_skill_candidates',
              arguments: { candidates: [] },
            },
          ],
        }
      },
    })

    expect(attempts).toBe(2)
    expect(result.candidates).toEqual([])
    expect(result.submissionStatus).toBe('explicit_no_candidates')
    expect(result.noCandidateReason).toContain('transferable skill')
    expect(result.toolResults[0]).toMatchObject({
      tool: 'submit_skill_candidates',
      ok: false,
    })
  })

  test('marks prose final responses as generation errors instead of silently returning zero candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-generation-error-'))
    roots.push(root)
    const cfg = config(root)

    const result = await runLearningAgent({
      role: 'std-code-comparator',
      evidence: { kind: 'failure-vs-std-code', taskId: 'task-a' },
      config: cfg,
      transport: async () => ({ content: 'I need to see what task you want me to help with.' }),
    })

    expect(result.candidates).toEqual([])
    expect(result.submissionStatus).toBe('generation_error')
    expect(result.generationError).toContain('candidate output must be JSON')
  })

  test('reprompts invalid prose final responses before accepting structured candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-final-retry-'))
    roots.push(root)
    const cfg = config(root)
    let attempts = 0

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async () => {
        attempts++
        if (attempts === 1) return { content: "I'm Claude, an AI assistant made by Anthropic." }
        return {
          toolCalls: [
            {
              id: 'submit-1',
              name: 'submit_skill_candidates',
              arguments: { candidates: [candidateJson('ci-general-final-retry')] },
            },
          ],
        }
      },
    })

    expect(attempts).toBe(2)
    expect(result.submissionStatus).toBe('submitted_candidates')
    expect(result.candidates.map(candidate => candidate.id)).toEqual(['ci-general-final-retry'])
  })

  test('reprompts contradictory no-candidate claims after successful evidence tool use', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-no-candidate-retry-'))
    roots.push(root)
    const cfg = config(root)
    let step = 0

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      artifactContext: {
        cycleId: 'cycle-1',
        evidenceFile: 'task-a-success.json',
        taskId: 'task-a',
      },
      transport: async request => {
        const last = request.messages.at(-1)
        if (last?.role === 'tool' && String(last.content).includes('no-candidate claim contradicts')) {
          return {
            toolCalls: [
              {
                id: 'submit-2',
                name: 'submit_skill_candidates',
                arguments: { candidates: [candidateJson('ci-general-contradiction-retry')] },
              },
            ],
          }
        }
        if (last?.role === 'tool') {
          return {
            toolCalls: [
              {
                id: 'submit-1',
                name: 'submit_skill_candidates',
                arguments: {
                  candidates: [],
                  no_candidate_reason:
                    'Cannot access trajectory evidence, so no reusable skill can be produced for this task.',
                  no_candidate_evidence: ['The evidence files were unavailable for inspection.'],
                },
              },
            ],
          }
        }
        step++
        return {
          toolCalls: [
            {
              id: `artifact-${step}`,
              name: 'write_learning_artifact',
              arguments: {
                filename: 'analysis.md',
                artifactKind: 'failure-analysis',
                content: 'Failure pattern: the solver repeated long scaling experiments without a cheap operator check.',
              },
            },
          ],
        }
      },
    })

    expect(result.submissionStatus).toBe('submitted_candidates')
    expect(result.candidates.map(candidate => candidate.id)).toEqual(['ci-general-contradiction-retry'])
    expect(result.toolResults.some(item => item.content.includes('no-candidate claim contradicts'))).toBe(true)
  })

  test('returns generation_error after repeated invalid submit attempts without limiting normal tool rounds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-invalid-submit-'))
    roots.push(root)
    const cfg = config(root)
    let attempts = 0

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async () => {
        attempts++
        return {
          toolCalls: [
            {
              id: `submit-${attempts}`,
              name: 'submit_skill_candidates',
              arguments: { candidates: [] },
            },
          ],
        }
      },
    })

    expect(attempts).toBe(3)
    expect(result.candidates).toEqual([])
    expect(result.submissionStatus).toBe('generation_error')
    expect(result.generationError).toContain('empty candidate submission requires')
  })

  test('records malformed submit arguments as generation_error instead of throwing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-malformed-submit-'))
    roots.push(root)
    const cfg = config(root)

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async () => ({
        toolCalls: [
          {
            id: 'submit-1',
            name: 'submit_skill_candidates',
            arguments: '{"candidates": [',
          },
        ],
      }),
    })

    expect(result.candidates).toEqual([])
    expect(result.submissionStatus).toBe('generation_error')
    expect(result.generationError).toContain('invalid submit_skill_candidates arguments')
  })

  test('writes intermediate artifacts only under reports/<cycle>/agent-artifacts/<taskId> with metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-artifact-'))
    roots.push(root)
    const cfg = config(root)

    await runLearningAgent({
      role: 'std-code-comparator',
      evidence: { kind: 'failure-vs-std-code', taskId: 'task-a' },
      config: cfg,
      artifactContext: {
        cycleId: 'cycle-1',
        evidenceFile: '001-task-a-failure-vs-std-code.json',
        taskId: 'task-a',
      },
      transport: async request => {
        if (request.messages.at(-1)?.role === 'tool') {
          return {
            toolCalls: [
              {
                id: 'submit-1',
                name: 'submit_skill_candidates',
                arguments: {
                  candidates: [],
                  no_candidate_reason:
                    'The intermediate analysis did not identify a reusable skill distinct from current candidates.',
                  no_candidate_evidence: ['The written artifact was only supporting analysis.'],
                },
              },
            ],
          }
        }
        return {
          toolCalls: [
            {
              id: 'artifact-1',
              name: 'write_learning_artifact',
              arguments: {
                filename: 'analysis.md',
                artifactKind: 'failure-analysis',
                content: '# Analysis\n\nReusable observations go here.',
              },
            },
          ],
        }
      },
    })

    const artifactPath = join(
      cfg.paths.workDir,
      'reports',
      'cycle-1',
      'agent-artifacts',
      'task-a',
      'analysis.md',
    )
    const metadataPath = `${artifactPath}.metadata.json`
    expect(existsSync(artifactPath)).toBe(true)
    expect(existsSync(metadataPath)).toBe(true)
    expect(existsSync(join(cfg.paths.workDir, 'analysis.md'))).toBe(false)
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    expect(metadata).toMatchObject({
      cycleId: 'cycle-1',
      taskId: 'task-a',
      evidenceFile: '001-task-a-failure-vs-std-code.json',
      role: 'std-code-comparator',
      model: 'test-model',
      toolCallId: 'artifact-1',
      artifactKind: 'failure-analysis',
    })
    expect(metadata.timestamp).toEqual(expect.any(String))
    expect(metadata.contentSha256).toEqual(expect.any(String))
  })

  test('rejects path-based artifact writes so subAgents cannot create root scratch files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-artifact-deny-'))
    roots.push(root)
    const cfg = config(root)
    const deniedResults: string[] = []

    await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      artifactContext: {
        cycleId: 'cycle-1',
        evidenceFile: '001-task-a-success.json',
        taskId: 'task-a',
      },
      transport: async request => {
        const last = request.messages.at(-1)
        if (last?.role === 'tool') {
          deniedResults.push(last.content)
          return {
            toolCalls: [
              {
                id: 'submit-1',
                name: 'submit_skill_candidates',
                arguments: {
                  candidates: [],
                  no_candidate_reason:
                    'The denied artifact write was not necessary to produce a reusable skill for this evidence.',
                  no_candidate_evidence: ['The attempted path-based write was rejected by policy.'],
                },
              },
            ],
          }
        }
        return {
          toolCalls: [
            {
              id: 'artifact-1',
              name: 'write_learning_artifact',
              arguments: { path: join(cfg.paths.workDir, 'root.md'), content: 'bad' },
            },
          ],
        }
      },
    })

    expect(deniedResults[0]).toContain('filename')
    expect(existsSync(join(cfg.paths.workDir, 'root.md'))).toBe(false)
  })

  test('executes requested tools through toolPolicy before continuing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-policy-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.runRoots[0], { recursive: true })
    mkdirSync(cfg.paths.workDir, { recursive: true })
    writeFileSync(join(cfg.paths.runRoots[0], 'safe.txt'), 'safe evidence', 'utf8')
    const policy = createLearningToolPolicy(cfg)
    const toolMessages: string[] = []

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      toolPolicy: policy,
      transport: async request => {
        const last = request.messages.at(-1)
        if (last?.role === 'tool') {
          toolMessages.push(String(last.content))
          return { content: '[]' }
        }
        return {
          toolCalls: [
            {
              id: 'call-1',
              name: 'read_text_file',
              arguments: { path: join(root, 'secrets.txt') },
            },
          ],
        }
      },
    })

    expect(result.candidates).toEqual([])
    expect(toolMessages[0]).toContain('denied')
    expect(toolMessages[0]).toContain('read_text_file')
  })

  test('allows std-code comparator to read std_code while trajectory analyst remains std-code denied', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-role-std-code-'))
    roots.push(root)
    const cfg = config(root)
    const stdCodePath = join(cfg.paths.tasksDir, 'task-a', 'std_code', 'solve.py')
    mkdirSync(join(cfg.paths.tasksDir, 'task-a', 'std_code'), { recursive: true })
    writeFileSync(stdCodePath, 'reference implementation marker', 'utf8')

    async function attempt(role: 'trajectory-analyst' | 'std-code-comparator') {
      const toolMessages: string[] = []
      const result = await runLearningAgent({
        role,
        evidence: { kind: role === 'trajectory-analyst' ? 'success' : 'failure-vs-std-code', taskId: 'task-a' },
        config: cfg,
        transport: async request => {
          const last = request.messages.at(-1)
          if (last?.role === 'tool') {
            toolMessages.push(String(last.content))
            return {
              toolCalls: [
                {
                  id: 'submit-1',
                  name: 'submit_skill_candidates',
                  arguments: {
                    candidates: [],
                    no_candidate_reason:
                      'This test checks tool access policy rather than producing a reusable candidate skill.',
                    no_candidate_evidence: ['The tool result was recorded for role-specific std_code access.'],
                  },
                },
              ],
            }
          }
          return {
            toolCalls: [
              {
                id: 'read-1',
                name: 'read_text_file',
                arguments: { path: stdCodePath },
              },
            ],
          }
        },
      })
      expect(result.submissionStatus).toBe('explicit_no_candidates')
      return toolMessages[0]
    }

    expect(await attempt('trajectory-analyst')).toContain('denied read_text_file')
    expect(await attempt('std-code-comparator')).toContain('reference implementation marker')
  })

  test('continues tool use until the model returns final candidate JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-unlimited-tools-'))
    roots.push(root)
    const cfg = config(root)
    mkdirSync(cfg.paths.runRoots[0], { recursive: true })
    writeFileSync(join(cfg.paths.runRoots[0], 'safe.txt'), 'safe evidence', 'utf8')
    let requests = 0

    const result = await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async request => {
        requests++
        if (request.messages.at(-1)?.role === 'tool' && requests <= 7) {
          return {
            toolCalls: [
              {
                id: `call-${requests}`,
                name: 'read_text_file',
                arguments: { path: join(cfg.paths.runRoots[0], 'safe.txt') },
              },
            ],
          }
        }
        if (requests <= 6) {
          return {
            toolCalls: [
              {
                id: `call-${requests}`,
                name: 'read_text_file',
                arguments: { path: join(cfg.paths.runRoots[0], 'safe.txt') },
              },
            ],
          }
        }
        return { content: '[]' }
      },
    })

    expect(result.candidates).toEqual([])
    expect(result.toolResults.length).toBeGreaterThan(4)
  })

  test('list_files does not traverse symlinked directories outside allowed roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-agent-list-policy-'))
    roots.push(root)
    const cfg = config(root)
    const outsideDir = join(root, 'outside')
    mkdirSync(cfg.paths.runRoots[0], { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'secret.txt'), 'outside', 'utf8')
    symlinkSync(outsideDir, join(cfg.paths.runRoots[0], 'linked-outside'), 'junction')
    const toolMessages: string[] = []

    await runLearningAgent({
      role: 'trajectory-analyst',
      evidence: { kind: 'success', taskId: 'task-a' },
      config: cfg,
      transport: async request => {
        const last = request.messages.at(-1)
        if (last?.role === 'tool') {
          toolMessages.push(String(last.content))
          return { content: '[]' }
        }
        return {
          toolCalls: [
            {
              id: 'call-1',
              name: 'list_files',
              arguments: { path: cfg.paths.runRoots[0] },
            },
          ],
        }
      },
    })

    expect(toolMessages[0]).not.toContain('secret.txt')
    expect(toolMessages[0]).not.toContain('linked-outside')
  })
})
