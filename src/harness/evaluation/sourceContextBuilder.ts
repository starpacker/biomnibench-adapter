import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'
import type { JudgeResult, RuntimeInfo, TaskRun } from './types.js'
import { isBioMniBenchTask } from './biomnibenchAdapter.js'

type OutputSchema = {
  submission?: {
    path_template?: string
  }
  path_template?: string
  arrays?: Array<{
    key?: string
    shape?: unknown
    dtype?: unknown
  }>
  validation?: {
    finite_only?: boolean
  }
}

type CasesConfig = {
  cases?: Array<{
    id?: string
    input_dir?: string
    params?: string
    expected_output?: string
    description?: string
  }>
}

type CompactJudgeFeedback = {
  format: string
  reasons: string[]
  failedMetrics: string[]
  passedMetrics: string[]
  message?: string
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(stripUtf8Bom(await readFile(path, 'utf8'))) as T
  } catch {
    return undefined
  }
}

function roundPlanPath(round: number): string {
  return `workspace/plans/round_${String(round).padStart(2, '0')}.md`
}

function shouldSkipPublicPath(relativePath: string): boolean {
  const parts = relativePath.replace(/\\/g, '/').split('/')
  return parts.includes('.venv') || parts.includes('.venv-posix')
}

async function collectPublicFiles(
  publicDir: string,
  currentDir = publicDir,
): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name)
    const relativePath = relative(publicDir, absolutePath).replace(/\\/g, '/')
    if (shouldSkipPublicPath(relativePath)) continue
    if (entry.isDirectory()) {
      files.push(...(await collectPublicFiles(publicDir, absolutePath)))
      continue
    }
    if (entry.isFile()) files.push(relativePath)
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function formatPublicFiles(files: string[]): string {
  if (files.length === 0) return '(No public files found.)'
  return files.map(file => `- ${file}`).join('\n')
}

function formatShape(shape: unknown): string {
  return Array.isArray(shape) ? `[${shape.join(',')}]` : 'unspecified'
}

function formatDtype(dtype: unknown): string {
  if (Array.isArray(dtype)) return dtype.map(String).join('|')
  if (typeof dtype === 'string') return dtype
  return 'unspecified'
}

function buildOutputContract(schema: OutputSchema | undefined): string {
  if (!schema) {
    return 'Output schema summary unavailable. Read public/output_schema.json if needed.'
  }
  const pattern =
    schema.submission?.path_template ?? schema.path_template ?? 'outputs/{case_id}.npz'
  const lines = [`Required file pattern: ${pattern}`, 'Required arrays:']
  const arrays = schema.arrays ?? []
  if (arrays.length === 0) {
    lines.push('- (No array requirements found in output_schema.json.)')
  } else {
    const finite = schema.validation?.finite_only === false ? '' : ', finite'
    for (const item of arrays) {
      lines.push(
        `- ${item.key ?? '(unnamed)'}: shape ${formatShape(item.shape)}, dtype ${formatDtype(item.dtype)}${finite}`,
      )
    }
  }
  return lines.join('\n')
}

function buildVisibleCases(cases: CasesConfig | undefined): string {
  const items = cases?.cases ?? []
  if (items.length === 0) return '(No visible cases listed.)'
  return items
    .map(item =>
      [
        `- ${item.id ?? '(unknown_case)'}:`,
        item.input_dir ? `  input_dir: ${item.input_dir}` : undefined,
        item.params ? `  params: ${item.params}` : undefined,
        item.expected_output ? `  expected_output: ${item.expected_output}` : undefined,
        item.description ? `  description: ${item.description}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n')
}

export function buildSourceSystemPrompt(extra?: string): string {
  return [
    'You are an autonomous solver inside a source-native evaluation harness.',
    '',
    'Goal: produce valid final submission files for the current public task.',
    '',
    'Use only run-local paths:',
    '- public/: read-only public task data.',
    '- workspace/: writable scratch, plans, and solver code.',
    '- outputs/: writable final submission files.',
    '- logs/agent/: optional notes.',
    '',
    'Do not access private judge data, original task directories, other runs, parent directories, home directories, or system secrets.',
    '',
    'Use the provided Python runtime. Do not install packages or create/repair environments.',
    '',
    'Planning discipline:',
    '- You may inspect necessary public files before planning.',
    '- For each judge round, once you understand the task and any judge feedback, write a detailed, task-specific plan before implementation, long computation, or submission.',
    '- Write the round plan to workspace/plans/round_NN.md and copy the current round plan to workspace/plan.md.',
    '- The plan should be as detailed as needed: include task understanding, public data observations, assumptions, algorithm strategy, validation strategy, risks, and concrete execution steps.',
    '- Avoid generic filler. Every plan section should contain information specific to this task or this judge feedback.',
    '- Do not use TodoWrite; plans must be file artifacts.',
    '',
    'Round closure discipline:',
    '- Judge feedback is more valuable than private speculation. Prefer submitting a valid best attempt over running open-ended experiments.',
    '- In each judge round, run only a small set of focused experiments, then select the best solver, regenerate outputs/, validate the file format, and call finalize_submission.',
    '- If you believe outputs/ already contains files matching the output contract, submit the best available valid output instead of continuing unbounded exploration.',
    '',
    'Experiment discipline:',
    '- Put non-trivial Python experiments in workspace/experiments/*.py or workspace/*.py.',
    '- Do not put long Python programs in Bash python -c; Bash should run scripts or short validation commands.',
    '',
    'When final output files exist under outputs/, call finalize_submission. A text answer is not a submission.',
    extra?.trim(),
  ]
    .filter(Boolean)
    .join('\n')
}

export async function buildInitialSourcePrompt(input: {
  taskRun: TaskRun
  runtime: RuntimeInfo
  userTask: string
  maxRounds: number
}): Promise<string> {
  const { taskRun, runtime, userTask, maxRounds } = input

  // BioMniBench tasks have free-form output (trace.md + answer.txt) instead
  // of array-based submissions; use a tailored prompt that omits schema/cases.
  if (isBioMniBenchTask(taskRun.taskDir)) {
    const publicFiles = await collectPublicFiles(taskRun.publicDir)
    return [
      '<run_context>',
      `task_id: ${taskRun.taskId}`,
      'cwd: run root',
      `python: ${runtime.displayPath}`,
      `max_judge_rounds: ${maxRounds}`,
      'submission_dir: outputs/',
      'current_plan_file: workspace/plan.md',
      `round_plan_file: ${roundPlanPath(1)}`,
      '</run_context>',
      '',
      '<public_files>',
      formatPublicFiles(publicFiles),
      '</public_files>',
      '',
      '<task_statement>',
      userTask.trim() || '(No README.md content was found; inspect public/.)',
      '</task_statement>',
      '',
      '<output_contract>',
      'This is a BioMniBench data analysis task. The judge is an LLM that scores',
      'your work against a rubric. You MUST produce exactly two files:',
      '  - outputs/trace.md      Detailed analysis trace: code you ran, intermediate',
      '                          results, plots described in text, reasoning.',
      '  - outputs/answer.txt    Concise final answer to the task question.',
      'Both files are evaluated by an LLM judge against a hidden rubric. Be specific,',
      'show numerical results, and reference the data you actually computed.',
      '</output_contract>',
      '',
      '<visible_cases>',
      'No discrete cases. Data files are in public/data/ and public/visible_data/.',
      'Read public/README.md for the full task description and data dictionary.',
      '</visible_cases>',
      '',
      '<workflow>',
      '1. Read public/README.md carefully for the task question, data files, and any constraints.',
      '2. Inspect public/data/ and public/visible_data/ to understand the actual file formats.',
      '3. Write a detailed task-specific plan to ' + roundPlanPath(1) + ' and refresh workspace/plan.md.',
      '4. Write Python solver code under workspace/ or workspace/experiments/.',
      '5. IMPORTANT: cwd is run root. Use public/data/ etc., NOT ../public/data/.',
      '6. The shared Python env already has pandas, numpy, scipy, scanpy, anndata, sklearn, statsmodels, matplotlib, seaborn, openpyxl. Do NOT install packages.',
      '7. After computing your answer, write outputs/trace.md (analysis trace) and outputs/answer.txt (final answer).',
      '8. Call finalize_submission. The judge will score against a rubric.',
      '</workflow>',
    ].join('\n')
  }

  const [publicFiles, schema, cases] = await Promise.all([
    collectPublicFiles(taskRun.publicDir),
    readJsonIfExists<OutputSchema>(join(taskRun.publicDir, 'output_schema.json')),
    readJsonIfExists<CasesConfig>(join(taskRun.publicDir, 'visible_data', 'cases.json')),
  ])

  return [
    '<run_context>',
    `task_id: ${taskRun.taskId}`,
    'cwd: run root',
    `python: ${runtime.displayPath}`,
    `max_judge_rounds: ${maxRounds}`,
    'submission_dir: outputs/',
    'current_plan_file: workspace/plan.md',
    `round_plan_file: ${roundPlanPath(1)}`,
    '</run_context>',
    '',
    '<public_files>',
    formatPublicFiles(publicFiles),
    '</public_files>',
    '',
    '<task_statement>',
    userTask.trim() || '(No README.md content was found; inspect public/.)',
    '</task_statement>',
    '',
    '<output_contract>',
    buildOutputContract(schema),
    '</output_contract>',
    '',
    '<visible_cases>',
    buildVisibleCases(cases),
    '</visible_cases>',
    '',
    '<workflow>',
    '1. Use <output_contract> and <visible_cases> as the submission contract. Inspect relevant public case input files for raw keys, shapes, dtypes, finite status, and value ranges before choosing a solver; do not assume array structure.',
    `2. Once you understand the task, write ${roundPlanPath(1)} and refresh workspace/plan.md.`,
    '3. Write solver code under workspace/ and longer experiments under workspace/experiments/.',
    '4. IMPORTANT: Your cwd is run root. Always use paths relative to run root. Data files are at public/workdir/, NOT ../public/workdir/. When writing code in workspace/, use public/workdir/ for data paths.',
    '5. Use Bash for short commands or to run scripts; do not use long inline python -c programs.',
    '6. Run a bounded set of focused experiments, then choose the best current solver.',
    '7. Write final submission files under outputs/ and run a quick local format check against <output_contract>.',
    '8. Call finalize_submission. The judge feedback is more valuable than private speculation.',
    '</workflow>',
  ].join('\n')
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function compactJudgeFeedback(judgeResult: JudgeResult): CompactJudgeFeedback {
  const raw = judgeResult.raw as
    | {
        cases?: Array<{
          reason?: unknown
          format?: { status?: unknown }
          metrics?: Array<{ name?: unknown; status?: unknown }>
        }>
      }
    | undefined
  const cases = raw && typeof raw === 'object' && Array.isArray(raw.cases) ? raw.cases : []
  if (cases.length === 0) {
    return {
      format: 'unknown',
      reasons: [],
      failedMetrics: [],
      passedMetrics: [],
      message: judgeResult.feedback || '(no feedback)',
    }
  }

  const formatStatuses = unique(
    cases.map(item => String(item.format?.status ?? 'unknown')),
  )
  const reasons = unique(cases.map(item => String(item.reason ?? '')).filter(Boolean))
  const metrics = cases.flatMap(item => item.metrics ?? [])
  return {
    format: formatStatuses.length === 1 ? formatStatuses[0] : formatStatuses.join('|'),
    reasons,
    failedMetrics: unique(
      metrics
        .filter(item => item.status === 'fail')
        .map(item => String(item.name ?? '(unnamed_metric)')),
    ),
    passedMetrics: unique(
      metrics
        .filter(item => item.status === 'pass')
        .map(item => String(item.name ?? '(unnamed_metric)')),
    ),
  }
}

function formatList(label: string, values: string[]): string[] {
  if (values.length === 0) return [`${label}: []`]
  return [`${label}:`, ...values.map(value => `- ${value}`)]
}

export function buildJudgeFeedbackPrompt(input: {
  round: number
  maxRounds: number
  judgeResult: JudgeResult
}): string {
  const { round, maxRounds, judgeResult } = input
  const nextRound = round + 1
  const compact = compactJudgeFeedback(judgeResult)
  return [
    '<judge_feedback>',
    `round: ${round}/${maxRounds}`,
    `status: ${judgeResult.status}`,
    `reward: ${judgeResult.reward}`,
    `format: ${compact.format}`,
    `reason: ${compact.reasons.join('|') || 'none'}`,
    ...formatList('failed_metrics', compact.failedMetrics),
    ...formatList('passed_metrics', compact.passedMetrics),
    ...(compact.message ? [`message: ${compact.message}`] : []),
    '</judge_feedback>',
    '',
    '<workflow>',
    `Before modifying code for this feedback, understand the feedback, then write ${roundPlanPath(nextRound)} and refresh workspace/plan.md.`,
    'Make one focused fix or a small bounded experiment set, validate again, regenerate outputs, then submit the best current output to the judge with finalize_submission.',
    'Before finalize_submission, revalidate outputs against the same contract.',
    'Use workspace/experiments/*.py for longer probes; do not put long Python programs in Bash python -c.',
    '</workflow>',
  ].join('\n')
}

export function buildNoFinalizeRecoveryPrompt(input: {
  round: number
  maxRounds: number
}): string {
  return [
    '<no_finalize_recovery>',
    `round: ${input.round}/${input.maxRounds}`,
    'Your previous turn ended without finalize_submission.',
    'Do not start new open-ended research or long experiments.',
    'If you believe outputs/ contains valid final files, call finalize_submission now with a concise summary.',
    'If outputs/ is missing or invalid, make only the shortest necessary format fix, then call finalize_submission.',
    'If you cannot create a valid output, briefly explain the blocker and stop.',
    '</no_finalize_recovery>',
  ].join('\n')
}

export function activeSkillsPromptBlock(skillNames: string[] = []): string {
  const visibleNames = [...new Set(skillNames.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
  return [
    '<active_skills>',
    'The native Skill tool is enabled for this run.',
    'At the start of each judge round, before writing the round plan or solver code, call the Skill tool to inspect relevant active skills and incorporate any applicable reusable guidance.',
    'Use retrieved skill guidance as abstract process advice only; do not infer or request hidden task materials from it.',
    'In the round plan, include a section named "Applied skills checklist" before implementation.',
    'That checklist must name each applicable skill, list the abstract items you will apply, state the anti-patterns you are avoiding, and define the cheap probe, stop condition, expected runtime, and log path before any long run.',
    'Before finalize_submission, write workspace/skill_application.json with schema_version: 1 and a skills array.',
    'Each exposed skill entry must include skill, status, evidence_path, and reason; status must be used, not_applicable, or blocked_but_overridden.',
    'Use evidence_path for a run-local public/workspace/logs artifact that proves the contract item was checked; do not put private paths, reference-solution paths, hidden data, or task-specific leaked constants in this file.',
    ...(visibleNames.length > 0
      ? ['Allowed active skill names:', ...visibleNames.map(name => `- ${name}`)]
      : ['Available active skills are discoverable through the Skill tool.']),
    '</active_skills>',
  ].join('\n')
}
