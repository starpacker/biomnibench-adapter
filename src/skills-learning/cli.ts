import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { loadSkillLearningConfig } from './config.js'
import {
  activateValidatedSkills,
  critiqueCycleCandidates,
  indexCycleEvidence,
  learnCycleCandidates,
  quarantineActiveSkillsAfterRegression,
  refineFailedCycleSkills,
  validateFailedCycleTrain,
  validateCycleTrain,
  validateCycleValid,
  writeCycleReport,
} from './skillLearningCycle.js'

export type SkillLearningCommand =
  | 'index'
  | 'learn'
  | 'critic'
  | 'refine-failed'
  | 'validate-train-failed'
  | 'validate-train'
  | 'activate'
  | 'validate-valid'
  | 'cycle'
  | 'report'

export type SkillLearningCliOptions = {
  configPath: string
  cycleId: string
}

export type SkillLearningCliHandlers = Partial<Record<SkillLearningCommand, (options: SkillLearningCliOptions) => Promise<unknown>>>

function usage(): string {
  return [
    'Usage: bun src/skills-learning/cli.ts <command> [options]',
    '',
    'Commands: index, learn, critic, refine-failed, validate-train-failed, validate-train, activate, validate-valid, cycle, report',
    'Options:',
    '  --config <path>     Config path (default: config/skill-learning.json)',
    '  --cycle-id <id>     Cycle id (default: timestamp)',
  ].join('\n')
}

function readOption(args: string[], index: number, name: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value after ${name}`)
  return value
}

export function parseSkillLearningCliArgs(args: string[]): {
  command: SkillLearningCommand
  options: SkillLearningCliOptions
} {
  const command = args[0] as SkillLearningCommand | undefined
  if (!command || command === '--help' || command === '-h') throw new Error(usage())
  const known = new Set(['index', 'learn', 'critic', 'refine-failed', 'validate-train-failed', 'validate-train', 'activate', 'validate-valid', 'cycle', 'report'])
  if (!known.has(command)) throw new Error(`Unknown skill-learning command: ${command}`)

  let configPath = 'config/skill-learning.json'
  let cycleId = `cycle-${new Date().toISOString().replace(/[:.]/g, '-')}`
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--config') {
      configPath = readOption(args, index, arg)
      index++
      continue
    }
    if (arg === '--cycle-id') {
      cycleId = readOption(args, index, arg)
      index++
      continue
    }
    throw new Error(`Unknown skill-learning option: ${arg}`)
  }

  return { command, options: { configPath, cycleId } }
}

async function defaultIndex(options: SkillLearningCliOptions): Promise<void> {
  const config = await loadSkillLearningConfig(options.configPath)
  const packages = await indexCycleEvidence(config, options.cycleId)
  const dir = join(config.paths.workDir, 'cycles', options.cycleId)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'index.json'),
    `${JSON.stringify({ cycleId: options.cycleId, evidencePackages: packages.length }, null, 2)}\n`,
    'utf8',
  )
}

async function defaultArtifact(options: SkillLearningCliOptions, name: string, payload: unknown): Promise<void> {
  const config = await loadSkillLearningConfig(options.configPath)
  const dir = join(config.paths.workDir, 'cycles', options.cycleId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function defaultValidateTrain(options: SkillLearningCliOptions): Promise<void> {
  const config = await loadSkillLearningConfig(options.configPath)
  const report = await validateCycleTrain(config, options.cycleId)
  if (!report.gates.noRegression || report.gates.activeNoRegression === false) {
    await quarantineActiveSkillsAfterRegression(config, options.cycleId)
  }
}

async function defaultValidateTrainFailed(options: SkillLearningCliOptions): Promise<void> {
  const config = await loadSkillLearningConfig(options.configPath)
  await validateFailedCycleTrain(config, options.cycleId)
}

async function defaultValidateValid(options: SkillLearningCliOptions): Promise<void> {
  const config = await loadSkillLearningConfig(options.configPath)
  await validateCycleValid(config, options.cycleId)
}

function defaultHandlers(): Record<SkillLearningCommand, (options: SkillLearningCliOptions) => Promise<unknown>> {
  return {
    index: defaultIndex,
    learn: async options => {
      const config = await loadSkillLearningConfig(options.configPath)
      const candidates = await learnCycleCandidates(config, options.cycleId)
      await defaultArtifact(options, 'learn', { cycleId: options.cycleId, candidates: candidates.map(candidate => candidate.id) })
    },
    critic: async options => {
      const config = await loadSkillLearningConfig(options.configPath)
      const result = await critiqueCycleCandidates(config, options.cycleId)
      await defaultArtifact(options, 'critic', {
        cycleId: options.cycleId,
        approved: result.approved.map(candidate => candidate.id),
        rejected: result.rejected,
      })
    },
    'refine-failed': async options => {
      const config = await loadSkillLearningConfig(options.configPath)
      const result = await refineFailedCycleSkills(config, options.cycleId)
      await defaultArtifact(options, 'refine-failed', {
        cycleId: options.cycleId,
        revised: result.revised.map(skill => skill.id),
        rejected: result.rejected,
        skippedTasks: result.skippedTasks,
      })
    },
    'validate-train-failed': defaultValidateTrainFailed,
    'validate-train': defaultValidateTrain,
    activate: async options => {
      const config = await loadSkillLearningConfig(options.configPath)
      const activated = await activateValidatedSkills(config, options.cycleId)
      await defaultArtifact(options, 'activate', { cycleId: options.cycleId, activated: activated.map(skill => skill.id) })
    },
    'validate-valid': defaultValidateValid,
    report: async options => {
      const config = await loadSkillLearningConfig(options.configPath)
      await writeCycleReport(config, options.cycleId)
    },
    cycle: async () => undefined,
  }
}

export async function runSkillLearningCli(args: string[], handlers: SkillLearningCliHandlers = {}): Promise<void> {
  const parsed = parseSkillLearningCliArgs(args)
  const merged = { ...defaultHandlers(), ...handlers }
  const sequence: SkillLearningCommand[] =
    parsed.command === 'cycle'
      ? ['index', 'learn', 'critic', 'validate-train', 'activate', 'validate-valid', 'report']
      : [parsed.command]

  for (const command of sequence) {
    await merged[command](parsed.options)
  }
}

if (import.meta.main) {
  try {
    await runSkillLearningCli(process.argv.slice(2))
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
}
