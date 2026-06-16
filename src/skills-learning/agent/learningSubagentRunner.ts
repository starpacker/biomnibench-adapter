import { createHash } from 'crypto'
import { lstat, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { SkillLearningConfig } from '../config.js'
import { parseSkillCandidateList, type SkillCandidate } from '../skillCandidateSchema.js'
import { createLearningToolPolicy, type LearningToolPolicy } from './toolPolicy.js'

export type LearningAgentRole =
  | 'trajectory-analyst'
  | 'success-failure-comparator'
  | 'std-code-comparator'
  | 'skill-writer'
  | 'skill-critic'

export type LearningAgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: LearningAgentToolCall[]
}

export type LearningAgentToolCall = {
  id: string
  name: string
  arguments: unknown
}

export type LearningAgentToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type LearningAgentTransportRequest = {
  llm: SkillLearningConfig['llm']
  messages: LearningAgentMessage[]
  tools: LearningAgentToolDefinition[]
}

export type LearningAgentTransportResponse = {
  content?: string
  toolCalls?: LearningAgentToolCall[]
}

export type LearningAgentTransport = (
  request: LearningAgentTransportRequest,
) => Promise<LearningAgentTransportResponse>

export type RunLearningAgentInput = {
  role: LearningAgentRole
  evidence: unknown
  config: SkillLearningConfig
  artifactContext?: {
    cycleId: string
    taskId: string
    evidenceFile: string
  }
  toolPolicy?: LearningToolPolicy
  transport?: LearningAgentTransport
}

export type LearningToolResult = {
  tool: string
  ok: boolean
  content: string
}

export type RunLearningAgentResult = {
  role: LearningAgentRole
  candidates: SkillCandidate[]
  rawContent: string
  submissionStatus: 'submitted_candidates' | 'explicit_no_candidates' | 'generation_error'
  noCandidateReason?: string
  noCandidateEvidence?: string[]
  generationError?: string
  toolResults: LearningToolResult[]
}

const TOOL_DEFINITIONS: LearningAgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_text_file',
      description: 'Read a small text evidence file allowed by the learning tool policy.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List evidence files under an allowed directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, maxFiles: { type: 'number' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_learning_artifact',
      description:
        'Write intermediate analysis artifacts to reports/<cycle>/agent-artifacts/<taskId>. Use a filename only; paths are rejected.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Single filename only, e.g. analysis.md.' },
          artifactKind: { type: 'string', description: 'Short kind such as failure-analysis or comparison-notes.' },
          content: { type: 'string' },
        },
        required: ['filename', 'artifactKind', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_skill_candidates',
      description: 'Submit the final candidate skills using the exact required schema. Use this instead of prose, markdown, or write_learning_artifact for final candidates.',
      parameters: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                schema_version: { type: 'number', enum: [2] },
                id: { type: 'string', description: 'Lowercase path-safe slug, e.g. ci-general-feedback-hypothesis.' },
                namespace: { type: 'string', enum: ['computational-imaging'] },
                type: { type: 'string', enum: ['general', 'domain'] },
                title: { type: 'string' },
                trigger: { type: 'string' },
                domain_tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
                summary: { type: 'string' },
                problem_signals: { type: 'array', items: { type: 'string' }, minItems: 1 },
                diagnostic_steps: { type: 'array', items: { type: 'string' }, minItems: 3 },
                math_physics_checks: { type: 'array', items: { type: 'string' } },
                tool_decision_rules: { type: 'array', items: { type: 'string' }, minItems: 1 },
                validation_checks: { type: 'array', items: { type: 'string' }, minItems: 2 },
                transfer_scope: { type: 'string' },
                guidance: { type: 'array', items: { type: 'string' }, minItems: 1 },
                anti_patterns: { type: 'array', items: { type: 'string' }, minItems: 1 },
                evidence_runs: { type: 'array', items: { type: 'string' }, minItems: 1 },
                validation: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['candidate'] },
                    used_count: { type: 'number' },
                    success_delta: { type: 'number' },
                    regressions: { type: 'number' },
                  },
                  required: ['status', 'used_count', 'success_delta', 'regressions'],
                },
              },
              required: [
                'schema_version',
                'id',
                'namespace',
                'type',
                'title',
                'trigger',
                'domain_tags',
                'summary',
                'problem_signals',
                'diagnostic_steps',
                'tool_decision_rules',
                'validation_checks',
                'transfer_scope',
                'guidance',
                'anti_patterns',
                'evidence_runs',
                'validation',
              ],
            },
          },
          no_candidate_reason: {
            type: 'string',
            description: 'Required when candidates is empty; explain why no reusable skill is produced.',
          },
          no_candidate_evidence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Required when candidates is empty; evidence supporting the no-candidate decision.',
          },
        },
        required: ['candidates'],
      },
    },
  },
]

const MAX_INVALID_SKILL_SUBMISSIONS = 3
const MAX_INVALID_FINAL_RESPONSES = 2

function promptForRole(role: LearningAgentRole): string {
  const roleSpecific =
    role === 'trajectory-analyst'
      ? [
          'For trajectory evidence, learn only from run summaries, trajectories, public task context, and judge feedback.',
          'Do not list, read, cite, or ask for std_code/reference implementations in trajectory analysis; that comparison belongs only to std-code-comparator evidence.',
        ]
      : role === 'std-code-comparator'
        ? [
            'Use std_code/reference implementation access only as a teacher signal for abstract invariants, convention checks, and validation gates.',
            'Never turn reference implementation names, control flow, constants, or file paths into application guidance.',
          ]
        : []
  return [
    `You are the ${role} subAgent for computational-imaging skill learning.`,
    'Use the provided evidence and the restricted tools when more context is needed.',
    ...roleSpecific,
    'When finished, call submit_skill_candidates with candidate skills or an explicitly justified empty result.',
    'If candidates is empty, provide no_candidate_reason and no_candidate_evidence; never submit an unexplained empty array.',
    'If you cannot call submit_skill_candidates, return only a raw JSON array with the same schema; never use markdown fences or prose.',
    'Generate schema_version 2 candidates only.',
    'Candidate schema keys are exactly: schema_version, id, namespace, type, title, trigger, domain_tags, summary, problem_signals, diagnostic_steps, math_physics_checks, tool_decision_rules, validation_checks, transfer_scope, guidance, anti_patterns, evidence_runs, validation.',
    'For domain skills, include at least two math_physics_checks. For general skills, focus tool_decision_rules and diagnostic_steps on reusable agent behavior.',
    'Use validation exactly as {"status":"candidate","used_count":0,"success_delta":0,"regressions":0}.',
    'If the evidence includes skillLearningBudget, submit no more candidates than skillLearningBudget.remainingCandidateSlotsForTask; if it is 0, submit an empty result with a reason.',
    'If the evidence kind is validation-failure-refinement, revise only the exposed existing skills and reuse their exact ids; do not invent new ids.',
    'For validation-failure-refinement, inspect the latest run summary and clean trajectory before revising; identify the specific reusable failure mode that the exposed skill failed to prevent.',
    'When allowed reference implementations are present for learning, use them only to infer abstract invariants, convention checks, and validation gates; never copy implementation steps, code, paths, constants, or task identifiers.',
    'Do not preserve exact epoch or iteration counts from old evidence. Reusable skills must tell application agents to read current public task parameters and derive long-run counts from cheap timing and progress probes.',
    'Prefer actionable diagnostic gates that stop wasted long runs: cheap forward/model sanity checks, geometry and coordinate consistency, sampling and scaling checks, boundary/operator fidelity checks, finite-value checks, and wall-clock or iteration budgets.',
    'A revised skill should tell an application agent when to pause, what small probe to run first, what evidence justifies a long optimization, and when to submit the best valid output instead of open-ended exploration.',
    'Do not use legacy keys such as skill_name, name, description, domain, subdomain, code_snippet, or implementation.',
    'Do not write final candidates with write_learning_artifact; that tool is only for scoped intermediate notes.',
    'Do not include code, private answer values, std_code paths, .judge_private paths, or task-specific hacks.',
  ].join('\n')
}

function parseArguments(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    const parsed = JSON.parse(args)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {}
  return args as Record<string, unknown>
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}

async function listFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = []

  async function walk(path: string): Promise<void> {
    if (files.length >= maxFiles) return
    let info
    try {
      info = await lstat(path)
    } catch {
      return
    }
    if (info.isSymbolicLink()) return
    if (info.isFile()) {
      files.push(path)
      return
    }
    if (!info.isDirectory()) return
    for (const entry of await readdir(path, { withFileTypes: true })) {
      await walk(join(path, entry.name))
    }
  }

  await walk(root)
  return files.sort()
}

async function executeToolCall(
  call: LearningAgentToolCall,
  policy: LearningToolPolicy,
  input: RunLearningAgentInput,
): Promise<LearningToolResult> {
  try {
    const args = parseArguments(call.arguments)
    if (call.name === 'read_text_file') {
      const path = String(args.path ?? '')
      const decision = policy.canRead(path)
      if (!decision.allowed) {
        return { tool: call.name, ok: false, content: `denied read_text_file: ${decision.reason}` }
      }
      const content = await readFile(decision.resolvedPath, 'utf8')
      return { tool: call.name, ok: true, content: content.slice(0, 100_000) }
    }

    if (call.name === 'list_files') {
      const path = String(args.path ?? '')
      const maxFiles = typeof args.maxFiles === 'number' ? Math.max(1, Math.min(500, args.maxFiles)) : 200
      const decision = policy.canRead(path)
      if (!decision.allowed) return { tool: call.name, ok: false, content: `denied list_files: ${decision.reason}` }
      return { tool: call.name, ok: true, content: JSON.stringify(await listFiles(decision.resolvedPath, maxFiles)) }
    }

    if (call.name === 'write_learning_artifact') {
      if ('path' in args) {
        return {
          tool: call.name,
          ok: false,
          content: 'write_learning_artifact requires filename, artifactKind, and content; path is not accepted',
        }
      }
      if (!input.artifactContext) {
        return {
          tool: call.name,
          ok: false,
          content: 'write_learning_artifact requires artifact context from the learning cycle',
        }
      }
      const filename = String(args.filename ?? '')
      const artifactKind = String(args.artifactKind ?? '')
      const content = String(args.content ?? '')
      if (!filename || basename(filename) !== filename || filename.includes('..')) {
        return { tool: call.name, ok: false, content: 'filename must be a single safe file name' }
      }
      if (!artifactKind.trim()) {
        return { tool: call.name, ok: false, content: 'artifactKind must be a non-empty string' }
      }
      const taskId = input.artifactContext.taskId
      if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
        return { tool: call.name, ok: false, content: 'artifact context taskId is not path-safe' }
      }
      const artifactPath = join(
        input.config.paths.workDir,
        'reports',
        input.artifactContext.cycleId,
        'agent-artifacts',
        taskId,
        filename,
      )
      const decision = policy.canWrite(artifactPath)
      if (!decision.allowed) {
        return { tool: call.name, ok: false, content: `denied write_learning_artifact: ${decision.reason}` }
      }
      await mkdir(dirname(decision.resolvedPath), { recursive: true })
      await writeFile(decision.resolvedPath, content, 'utf8')
      await writeFile(
        `${decision.resolvedPath}.metadata.json`,
        `${JSON.stringify(
          {
            cycleId: input.artifactContext.cycleId,
            taskId,
            evidenceFile: input.artifactContext.evidenceFile,
            role: input.role,
            model: configuredModel(input.config.llm),
            timestamp: new Date().toISOString(),
            toolCallId: call.id,
            artifactName: filename,
            artifactKind,
            contentSha256: createHash('sha256').update(content).digest('hex'),
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
      return { tool: call.name, ok: true, content: `wrote ${decision.resolvedPath}` }
    }

    return { tool: call.name, ok: false, content: `unknown tool: ${call.name}` }
  } catch (error) {
    return { tool: call.name, ok: false, content: error instanceof Error ? error.message : String(error) }
  }
}

function submitSkillCandidates(call: LearningAgentToolCall): {
  ok: boolean
  result: LearningToolResult
  candidates: SkillCandidate[]
  rawContent: string
  submissionStatus?: RunLearningAgentResult['submissionStatus']
  noCandidateReason?: string
  noCandidateEvidence?: string[]
} {
  let args
  try {
    args = parseArguments(call.arguments)
  } catch (error) {
    return {
      ok: false,
      result: {
        tool: call.name,
        ok: false,
        content: `invalid submit_skill_candidates arguments: ${error instanceof Error ? error.message : String(error)}`,
      },
      candidates: [],
      rawContent: safeStringify(call.arguments),
    }
  }
  const rawCandidates = args.candidates ?? []
  const rawContent = JSON.stringify(
    Array.isArray(rawCandidates) && rawCandidates.length === 0
      ? {
          candidates: rawCandidates,
          no_candidate_reason: args.no_candidate_reason,
          no_candidate_evidence: args.no_candidate_evidence,
        }
      : rawCandidates,
    null,
    2,
  )
  if (Array.isArray(rawCandidates) && rawCandidates.length === 0) {
    const reason = typeof args.no_candidate_reason === 'string' ? args.no_candidate_reason.trim() : ''
    const evidence = Array.isArray(args.no_candidate_evidence)
      ? args.no_candidate_evidence.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : []
    if (reason.length < 40 || evidence.length === 0) {
      return {
        ok: false,
        result: {
          tool: call.name,
          ok: false,
          content:
            'empty candidate submission requires no_candidate_reason with at least 40 characters and non-empty no_candidate_evidence',
        },
        candidates: [],
        rawContent,
      }
    }
    return {
      ok: true,
      result: {
        tool: call.name,
        ok: true,
        content: 'submitted explicit no-candidate result',
      },
      candidates: [],
      rawContent,
      submissionStatus: 'explicit_no_candidates',
      noCandidateReason: reason,
      noCandidateEvidence: evidence,
    }
  }
  const parsed = parseSkillCandidateList(rawContent, { requireSchemaVersion: 2 })
  if (!parsed.ok) {
    return {
      ok: false,
      result: {
        tool: call.name,
        ok: false,
        content: `invalid candidate submission: ${parsed.errors.join('; ')}`,
      },
      candidates: [],
      rawContent,
    }
  }
  return {
    ok: true,
    result: {
      tool: call.name,
      ok: true,
      content: `submitted ${parsed.candidates.length} candidate skill(s)`,
    },
    candidates: parsed.candidates,
    rawContent,
    submissionStatus: 'submitted_candidates',
  }
}

function contradictoryNoCandidateReason(
  submission: ReturnType<typeof submitSkillCandidates>,
  priorToolResults: LearningToolResult[],
): string | undefined {
  if (!submission.ok || submission.candidates.length > 0) return undefined
  const reasonText = `${submission.noCandidateReason ?? ''} ${(submission.noCandidateEvidence ?? []).join(' ')}`.toLowerCase()
  if (!/(cannot|can't|unable|without|no).{0,40}(access|evidence|trajectory|failure data)|denied/.test(reasonText)) {
    return undefined
  }
  const successfulEvidenceTool = priorToolResults.find(
    result => result.ok && (result.tool === 'read_text_file' || result.tool === 'write_learning_artifact'),
  )
  if (!successfulEvidenceTool) return undefined
  return [
    'no-candidate claim contradicts successful evidence tool use',
    `a previous ${successfulEvidenceTool.tool} call succeeded, so do not claim evidence was inaccessible`,
    'use the embedded evidence and successful tool results to submit transferable candidates, or provide a non-access-related no-candidate reason',
  ].join('; ')
}

function completionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

function messagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/messages')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value?.trim() ? value : undefined
}

function configuredModel(llm: SkillLearningConfig['llm']): string {
  return envValue('SKILL_LEARNING_LLM_MODEL') ?? envValue('MODEL_NAME') ?? llm.model
}

function configuredTransportModel(llm: SkillLearningConfig['llm']): string {
  const envModel = envValue('SKILL_LEARNING_LLM_MODEL') ?? envValue('MODEL_NAME')
  if (envModel) return envModel
  const hasApiEnv = Boolean(
    envValue(llm.baseUrlEnv) ??
      envValue('BASE_URL') ??
      envValue(llm.apiKeyEnv) ??
      envValue('API_KEY'),
  )
  if (hasApiEnv) {
    throw new Error(
      'Missing LLM model env: SKILL_LEARNING_LLM_MODEL or MODEL_NAME. Use scripts/run-skill-learning.ps1 so config/llm-probe.local.ps1 is loaded.',
    )
  }
  return llm.model
}

function configuredBaseUrl(llm: SkillLearningConfig['llm']): string | undefined {
  return envValue(llm.baseUrlEnv) ?? envValue('BASE_URL')
}

function configuredApiKey(llm: SkillLearningConfig['llm']): string | undefined {
  return envValue(llm.apiKeyEnv) ?? envValue('API_KEY')
}

function configuredProtocol(llm: SkillLearningConfig['llm']): 'anthropic' | 'openai-compatible' {
  const rawProtocol = envValue('SKILL_LEARNING_GATEWAY_PROTOCOL') ?? envValue('GATEWAY_PROTOCOL') ?? llm.provider
  const protocol = rawProtocol.toLowerCase()
  if (protocol === 'anthropic') return 'anthropic'
  if (protocol === 'openai' || protocol === 'openai-compatible') return 'openai-compatible'
  throw new Error(
    `Unsupported learning gateway protocol "${rawProtocol}". Use anthropic, openai, or openai-compatible.`,
  )
}

function modelName(request: LearningAgentTransportRequest): string {
  return configuredTransportModel(request.llm)
}

async function openAiCompatibleTransport(
  request: LearningAgentTransportRequest,
  baseUrl: string,
  apiKey: string,
): Promise<LearningAgentTransportResponse> {
  const response = await fetch(completionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName(request),
      temperature: request.llm.temperature,
      messages: request.messages,
      tools: request.tools,
      tool_choice: 'auto',
    }),
  })
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`)
  }
  const payload = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string
        tool_calls?: Array<{
          id?: string
          function?: { name?: string; arguments?: string }
        }>
      }
    }>
  }
  const message = payload.choices?.[0]?.message
  return {
    content: message?.content ?? '',
    toolCalls: message?.tool_calls?.map((toolCall, index) => ({
      id: toolCall.id ?? `tool-${index}`,
      name: toolCall.function?.name ?? 'unknown',
      arguments: toolCall.function?.arguments ?? '{}',
    })),
  }
}

function anthropicTools(tools: LearningAgentToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }))
}

function anthropicSystem(messages: LearningAgentMessage[]): string {
  return messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
}

function anthropicMessages(messages: LearningAgentMessage[]): Array<Record<string, unknown>> {
  const converted: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      converted.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.tool_call_id ?? '',
            content: message.content,
          },
        ],
      })
      continue
    }
    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      const content: Array<Record<string, unknown>> = []
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const call of message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseArguments(call.arguments),
        })
      }
      converted.push({ role: 'assistant', content })
      continue
    }
    converted.push({ role: message.role, content: message.content })
  }
  return converted
}

async function anthropicCompatibleTransport(
  request: LearningAgentTransportRequest,
  baseUrl: string,
  apiKey: string,
): Promise<LearningAgentTransportResponse> {
  const response = await fetch(messagesUrl(baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelName(request),
      max_tokens: 8192,
      temperature: request.llm.temperature,
      system: anthropicSystem(request.messages),
      messages: anthropicMessages(request.messages),
      tools: anthropicTools(request.tools),
    }),
  })
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`)
  }
  const payload = await response.json() as {
    content?: Array<{
      type?: string
      text?: string
      id?: string
      name?: string
      input?: unknown
    }>
  }
  const content = payload.content ?? []
  return {
    content: content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n'),
    toolCalls: content
      .filter(item => item.type === 'tool_use')
      .map((item, index) => ({
        id: item.id ?? `tool-${index}`,
        name: item.name ?? 'unknown',
        arguments: item.input ?? {},
      })),
  }
}

async function defaultTransport(request: LearningAgentTransportRequest): Promise<LearningAgentTransportResponse> {
  const baseUrl = configuredBaseUrl(request.llm)
  const apiKey = configuredApiKey(request.llm)
  if (!baseUrl) throw new Error(`Missing LLM base URL env: ${request.llm.baseUrlEnv} or BASE_URL`)
  if (!apiKey) throw new Error(`Missing LLM API key env: ${request.llm.apiKeyEnv} or API_KEY`)
  if (configuredProtocol(request.llm) === 'anthropic') {
    return anthropicCompatibleTransport(request, baseUrl, apiKey)
  }
  return openAiCompatibleTransport(request, baseUrl, apiKey)
}

export async function runLearningAgent(input: RunLearningAgentInput): Promise<RunLearningAgentResult> {
  const policy =
    input.toolPolicy ??
    createLearningToolPolicy(input.config, {
      allowStdCodeReads: input.role === 'std-code-comparator' || input.role === 'skill-writer',
    })
  const transport = input.transport ?? defaultTransport
  const messages: LearningAgentMessage[] = [
    { role: 'system', content: promptForRole(input.role) },
    { role: 'user', content: JSON.stringify(input.evidence, null, 2) },
  ]
  const toolResults: LearningToolResult[] = []
  let invalidSubmitAttempts = 0
  let invalidFinalResponses = 0
  for (;;) {
    const response = await transport({
      llm: input.config.llm,
      messages: [...messages],
      tools: TOOL_DEFINITIONS,
    })
    const toolCalls = response.toolCalls ?? []
    if (toolCalls.length === 0) {
      const rawContent = response.content ?? ''
      const parsed = parseSkillCandidateList(rawContent, { requireSchemaVersion: 2 })
      if (!parsed.ok || parsed.candidates.length === 0) {
        const generationError =
          parsed.ok && parsed.candidates.length === 0
            ? 'empty raw JSON array is not an explicit no-candidate submission'
            : parsed.errors.join('; ')
        if (parsed.ok && parsed.candidates.length === 0) {
          return {
            role: input.role,
            candidates: [],
            rawContent,
            submissionStatus: 'generation_error',
            generationError,
            toolResults,
          }
        }
        invalidFinalResponses++
        if (invalidFinalResponses <= MAX_INVALID_FINAL_RESPONSES) {
          messages.push({ role: 'assistant', content: rawContent })
          messages.push({
            role: 'user',
            content: [
              `Your previous final response was invalid: ${generationError}`,
              'Finish by calling submit_skill_candidates with schema_version 2 candidates, or submit an explicit empty result with no_candidate_reason and no_candidate_evidence.',
              'If tool calls are unavailable, return only a raw JSON array of candidate objects. Do not return prose, markdown, or an identity statement.',
            ].join('\n'),
          })
          continue
        }
        return {
          role: input.role,
          candidates: [],
          rawContent,
          submissionStatus: 'generation_error',
          generationError,
          toolResults,
        }
      }
      return {
        role: input.role,
        candidates: parsed.candidates,
        rawContent,
        submissionStatus: 'submitted_candidates',
        toolResults,
      }
    }

    messages.push({ role: 'assistant', content: response.content ?? '', tool_calls: toolCalls })
    for (const call of toolCalls) {
      if (call.name === 'submit_skill_candidates') {
        const submission = submitSkillCandidates(call)
        const contradictoryReason = contradictoryNoCandidateReason(submission, toolResults)
        if (contradictoryReason) {
          const result = { tool: call.name, ok: false, content: contradictoryReason }
          toolResults.push(result)
          invalidSubmitAttempts++
          if (invalidSubmitAttempts >= MAX_INVALID_SKILL_SUBMISSIONS) {
            return {
              role: input.role,
              candidates: [],
              rawContent: submission.rawContent,
              submissionStatus: 'generation_error',
              generationError: result.content,
              toolResults,
            }
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          })
          continue
        }
        toolResults.push(submission.result)
        if (submission.ok) {
          return {
            role: input.role,
            candidates: submission.candidates,
            rawContent: submission.rawContent,
            submissionStatus: submission.submissionStatus ?? 'submitted_candidates',
            noCandidateReason: submission.noCandidateReason,
            noCandidateEvidence: submission.noCandidateEvidence,
            toolResults,
          }
        }
        invalidSubmitAttempts++
        if (invalidSubmitAttempts >= MAX_INVALID_SKILL_SUBMISSIONS) {
          return {
            role: input.role,
            candidates: [],
            rawContent: submission.rawContent,
            submissionStatus: 'generation_error',
            generationError: submission.result.content,
            toolResults,
          }
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(submission.result),
        })
        continue
      }
      const result = await executeToolCall(call, policy, input)
      toolResults.push(result)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      })
    }
  }
}
