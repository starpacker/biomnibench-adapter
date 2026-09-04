import { readFile } from 'fs/promises'
import { join } from 'path'
import { runEvaluationBatch } from './batchRunner.js'
import { DefaultJudgeRunner } from './judgeRunner.js'
import { runSourceTaskLoop } from './sourceTaskLoop.js'
import type { EvaluationThinkingMode, LoopStatus } from './types.js'

export type AgentRuntime = 'source'

export type EvaluationCliArgs = {
  taskId: string
  taskIds: string[]
  tasksDir: string
  runsDir: string
  maxRounds: number
  maxTurnsPerRound?: number
  timeoutSeconds: number
  concurrency: number
  workerTimeoutGraceSeconds?: number
  systemPromptPath?: string
  timestamp?: string
  verbose: boolean
  agentRuntime: AgentRuntime
  workerRun: boolean
  temperature: number
  thinking: EvaluationThinkingMode
  judgeFeedbackLevel?: string
  // Context options (passed by configRunner)
  networkPolicy?: string
  contextProfile?: string
  enableRunMemory: boolean
  resumeRun?: string
  disableContextEvents: boolean
  disableSkillReinject: boolean
  includeClaudeDefaultUserContext: boolean
  enableSlashCommands: boolean
  enableMcp: boolean
  enableAgentTool: boolean
  disableAutoCompact: boolean
}

function usage(): string {
  return [
    'Usage:',
    '  bun src/harness/evaluation/cli.ts --task <task_id> [options]',
    '',
    'Options:',
    '  --tasks-dir <path>          Task prototypes directory (default: tasks)',
    '  --runs-dir <path>           Run output directory (default: $AGENT_LOG_DIR/runs or output/runs)',
    '  --max-rounds <n>            Maximum judge rounds (default: 3)',
    '  --max-turns-per-round <n>   Optional QueryEngine turn cap per judge round (default: unlimited)',
    '  --timeout-seconds <n>       Whole-loop timeout (default: 1800)',
    '  --concurrency <n>           Maximum source workers to run at once (default: 3)',
    '  --worker-timeout-grace-seconds <n>  Worker shutdown grace after loop timeout (default: 60)',
    '  --agent-runtime source      Agent runtime; legacy subprocess runtime has been removed',
    '  --temperature <number>      Model temperature when thinking is disabled (default: 1)',
    '  --thinking disabled|adaptive  Thinking mode for source runtime (default: disabled)',
    '  --enable-skills             Enable native SkillTool for source runtime (default: disabled)',
    '  --skills-dir <path>         Native skills directory when skills are enabled (default: skills)',
    '  --skill-name <name>         Restrict native SkillTool to a specific skill name; repeatable',
    '  --max-active-skills <n>     Maximum native skills exposed to the run after filtering',
    '  --system-prompt <path>      Optional debug-only extra system prompt file (default: none)',
  '  --judge-feedback-level <level>  Judge feedback detail level (default: metric_full)',
  '  --network-policy <policy>   Network access policy (default: disabled)',
  '  --context-profile <profile> Context profile for evaluation (default: eval-minimal)',
  '  --enable-run-memory         Enable run memory across sessions',
  '  --resume-run <run>          Resume a previous run',
  '  --disable-context-events    Disable context event recording',
  '  --disable-skill-reinject    Disable skill re-injection each round',
  '  --include-claude-default-user-context  Include Claude default user context',
  '  --enable-slash-commands     Enable slash commands',
  '  --enable-mcp                Enable MCP clients',
  '  --enable-agent-tool         Enable agent tool',
  '  --disable-agent-tool        Disable agent tool',
  '  --disable-auto-compact      Disable auto-compact',
  '  --timestamp <value>         Stable timestamp/run suffix for reproducible tests',
    '  --quiet                     Do not print live run events to stderr',
  ].join('\n')
}

function readOption(args: string[], index: number, name: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value after ${name}`)
  }
  return value
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`)
  }
  return parsed
}

function parseTemperature(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1, got: ${value}`)
  }
  return parsed
}

export function parseEvaluationCliArgs(args: string[]): EvaluationCliArgs {
  let taskId = ''
  const taskIds: string[] = []
  let tasksDir = 'tasks'
  let runsDir = join(process.env.AGENT_LOG_DIR || 'output', 'runs')
  let maxRounds = 3
  let maxTurnsPerRound: number | undefined
  let timeoutSeconds = 1800
  let concurrency = 3
  let workerTimeoutGraceSeconds: number | undefined
  let systemPromptPath: string | undefined
  let timestamp: string | undefined
  let verbose = true
  let agentRuntime: AgentRuntime = 'source'
  let workerRun = false
  let temperature = 1
  let thinking: EvaluationThinkingMode = 'disabled'
  let judgeFeedbackLevel: string | undefined
  let networkPolicy: string | undefined
  let contextProfile: string | undefined
  let enableRunMemory = false
  let resumeRun: string | undefined
  let disableContextEvents = false
  let disableSkillReinject = false
  let includeClaudeDefaultUserContext = false
  let enableSlashCommands = false
  let enableMcp = false
  let enableAgentTool: boolean | undefined
  let disableAutoCompact = false
  const skillOptions: EvaluationSkillOptions = {
    enabled: false,
    skillsDir: 'skills',
    mode: 'native',
  }
  let skillsDirProvided = false
  let skillNameProvided = false

  function addTaskIds(value: string): void {
    for (const id of value.split(',').map(item => item.trim()).filter(Boolean)) {
      if (taskIds.length === 0) taskId = id
      taskIds.push(id)
    }
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      throw new Error(usage())
    }
    if (arg === '--task') {
      addTaskIds(readOption(args, index, arg))
      index++
      continue
    }
    if (arg === '--tasks-dir') {
      tasksDir = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--runs-dir') {
      runsDir = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--max-rounds') {
      maxRounds = parsePositiveInteger(readOption(args, index, arg), arg)
      index++
      continue
    }
    if (arg === '--max-turns-per-round') {
      maxTurnsPerRound = parsePositiveInteger(readOption(args, index, arg), arg)
      index++
      continue
    }
    if (arg === '--timeout-seconds') {
      timeoutSeconds = parsePositiveInteger(readOption(args, index, arg), arg)
      index++
      continue
    }
    if (arg === '--concurrency') {
      concurrency = parsePositiveInteger(readOption(args, index, arg), arg)
      index++
      continue
    }
    if (arg === '--worker-timeout-grace-seconds') {
      workerTimeoutGraceSeconds = parsePositiveInteger(readOption(args, index, arg), arg)
      index++
      continue
    }
    if (arg === '--agent-runtime') {
      const runtime = readOption(args, index, arg)
      if (runtime === 'legacy-subprocess') {
        throw new Error('legacy-subprocess has been removed; use --agent-runtime source')
      }
      if (runtime !== 'source') {
        throw new Error(`Unknown agent runtime: ${runtime}`)
      }
      agentRuntime = runtime
      index++
      continue
    }
    if (arg === '--temperature') {
      temperature = parseTemperature(readOption(args, index, arg), arg)
      index++
      continue
    }
    if (arg === '--thinking') {
      const value = readOption(args, index, arg)
      if (value !== 'disabled' && value !== 'adaptive') {
        throw new Error(`${arg} must be disabled or adaptive, got: ${value}`)
      }
      thinking = value
      index++
      continue
    }
    if (arg === '--enable-skills') {
      skillOptions.enabled = true
      continue
    }
    if (arg === '--skills-dir') {
      const dir = readOption(args, index, arg)
      if (!skillsDirProvided) {
        skillOptions.skillsDir = dir
      } else {
        skillOptions.additionalSkillsDirs = [...(skillOptions.additionalSkillsDirs ?? []), dir]
      }
      skillsDirProvided = true
      index++
      continue
    }
    if (arg === '--skill-name') {
      skillNameProvided = true
      skillOptions.allowedSkillNames = [...(skillOptions.allowedSkillNames ?? []), readOption(args, index, arg)]
      index++
      continue
    }
    if (arg === '--max-active-skills') {
      skillOptions.maxActiveSkills = parsePositiveInteger(readOption(args, index, arg), arg)
      index++
      continue
    }
    if (arg === '--system-prompt') {
      systemPromptPath = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--judge-feedback-level') {
      judgeFeedbackLevel = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--network-policy') {
      networkPolicy = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--context-profile') {
      contextProfile = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--enable-run-memory') {
      enableRunMemory = true
      continue
    }
    if (arg === '--resume-run') {
      resumeRun = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--disable-context-events') {
      disableContextEvents = true
      continue
    }
    if (arg === '--disable-skill-reinject') {
      disableSkillReinject = true
      continue
    }
    if (arg === '--include-claude-default-user-context') {
      includeClaudeDefaultUserContext = true
      continue
    }
    if (arg === '--enable-slash-commands') {
      enableSlashCommands = true
      continue
    }
    if (arg === '--enable-mcp') {
      enableMcp = true
      continue
    }
    if (arg === '--enable-agent-tool') {
      enableAgentTool = true
      continue
    }
    if (arg === '--disable-agent-tool') {
      enableAgentTool = false
      continue
    }
    if (arg === '--disable-auto-compact') {
      disableAutoCompact = true
      continue
    }
    if (arg === '--timestamp') {
      timestamp = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--quiet') {
      verbose = false
      continue
    }
    if (arg === '--worker-run') {
      workerRun = true
      continue
    }
    if (!arg.startsWith('--') && taskIds.length === 0) {
      addTaskIds(arg)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!taskId) {
    throw new Error(`Missing required --task.\n\n${usage()}`)
  }

  return {
    taskId,
    taskIds,
    tasksDir,
    runsDir,
    maxRounds,
    maxTurnsPerRound,
    timeoutSeconds,
    concurrency,
    workerTimeoutGraceSeconds,
    systemPromptPath,
    timestamp,
    verbose,
    agentRuntime,
    workerRun,
    temperature,
    thinking,
    judgeFeedbackLevel,
    networkPolicy,
    contextProfile,
    enableRunMemory,
    resumeRun,
    disableContextEvents,
    disableSkillReinject,
    includeClaudeDefaultUserContext,
    enableSlashCommands,
    enableMcp,
    enableAgentTool,
    disableAutoCompact,
    skillOptions,
  }
}

async function readSystemPrompt(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined
  return readFile(path, 'utf8')
}

export function exitCodeForLoopStatus(status: LoopStatus): number {
  return status === 'success' ? 0 : 1
}

async function main(): Promise<void> {
  const parsed = parseEvaluationCliArgs(process.argv.slice(2))
  if (parsed.taskIds.length > 1 && !parsed.workerRun) {
    const batch = await runEvaluationBatch({
      taskIds: parsed.taskIds,
      tasksDir: parsed.tasksDir,
      runsDir: parsed.runsDir,
      maxRounds: parsed.maxRounds,
      maxTurnsPerRound: parsed.maxTurnsPerRound,
      timeoutSeconds: parsed.timeoutSeconds,
      concurrency: parsed.concurrency,
      workerTimeoutGraceSeconds: parsed.workerTimeoutGraceSeconds,
      temperature: parsed.temperature,
      thinking: parsed.thinking,
      systemPromptPath: parsed.systemPromptPath,
      timestamp: parsed.timestamp,
      verbose: parsed.verbose,
    })
    process.stdout.write(`${JSON.stringify(batch, null, 2)}\n`)
    process.exitCode = batch.ok ? 0 : 1
    return
  }

  const systemPrompt = await readSystemPrompt(parsed.systemPromptPath)
  const result = await runSourceTaskLoop({
    taskId: parsed.taskId,
    tasksDir: parsed.tasksDir,
    runsDir: parsed.runsDir,
    maxRounds: parsed.maxRounds,
    maxTurnsPerRound: parsed.maxTurnsPerRound,
    timeoutSeconds: parsed.timeoutSeconds,
    timestamp: parsed.timestamp,
    systemPrompt,
    verbose: parsed.verbose,
    llmOptions: {
      temperature: parsed.temperature,
      thinking: parsed.thinking,
    },
    skillOptions: parsed.skillOptions,
    judgeFeedbackLevel: parsed.judgeFeedbackLevel,
    judge: new DefaultJudgeRunner(),
  })

  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.status,
        rounds: result.rounds,
        reward: result.reward,
        run_dir: result.run.runDir,
        trajectory_path: result.trajectoryPath,
        last_judge_status: result.lastJudgeResult?.status,
      },
      null,
      2,
    )}\n`,
  )
  process.exitCode = exitCodeForLoopStatus(result.status)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Usage:')) {
      process.stdout.write(`${message}\n`)
      process.exitCode = 0
    } else {
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    }
  }
  // Force exit: the agent SDK (QueryEngine sessions, log streams) sometimes
  // leaves dangling handles in the event loop, causing bun to hang for many
  // minutes after `run_finished`. We have already written all logs and set
  // process.exitCode, so it is safe to exit immediately.
  process.exit(process.exitCode ?? 0)
}
