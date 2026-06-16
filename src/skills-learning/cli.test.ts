import { describe, expect, test } from 'bun:test'
import { runSkillLearningCli } from './cli.js'

describe('runSkillLearningCli', () => {
  test('cycle command calls stages in the required order', async () => {
    const calls: string[] = []

    await runSkillLearningCli(['cycle', '--config', 'config/skill-learning.json', '--cycle-id', 'cycle-test'], {
      index: async () => calls.push('index'),
      learn: async () => calls.push('learn'),
      critic: async () => calls.push('critic'),
      'refine-failed': async () => calls.push('refine-failed'),
      'validate-train-failed': async () => calls.push('validate-train-failed'),
      'validate-train': async () => calls.push('validate-train'),
      activate: async () => calls.push('activate'),
      'validate-valid': async () => calls.push('validate-valid'),
      report: async () => calls.push('report'),
    })

    expect(calls).toEqual([
      'index',
      'learn',
      'critic',
      'validate-train',
      'activate',
      'validate-valid',
      'report',
    ])
  })

  test('refine-failed command can be run as a standalone stage', async () => {
    const calls: string[] = []

    await runSkillLearningCli(['refine-failed', '--cycle-id', 'cycle-test'], {
      'refine-failed': async () => calls.push('refine-failed'),
    })

    expect(calls).toEqual(['refine-failed'])
  })

  test('validate-train-failed command can be run as a standalone stage', async () => {
    const calls: string[] = []

    await runSkillLearningCli(['validate-train-failed', '--cycle-id', 'cycle-test'], {
      'validate-train-failed': async () => calls.push('validate-train-failed'),
    })

    expect(calls).toEqual(['validate-train-failed'])
  })

  test('rejects unknown commands', async () => {
    await expect(runSkillLearningCli(['unknown'], {})).rejects.toThrow('Unknown skill-learning command')
  })
})
