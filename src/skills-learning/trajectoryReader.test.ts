import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildRounds } from './roundBuilder.js'
import { readTrajectory } from './trajectoryReader.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('readTrajectory', () => {
  test('keeps known and unknown records with kind and round intact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trajectory-'))
    roots.push(root)
    const path = join(root, 'trajectory.clean.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ kind: 'run_context', task_id: 'task-a', run_id: 'run-1' }),
        JSON.stringify({ kind: 'tool_call', round: 1, tool: 'Bash', tool_use_id: 't1', input: { cmd: 'echo ok' } }),
        JSON.stringify({ kind: 'tool_result', round: 1, tool_use_id: 't1', ok: true, text: 'ok' }),
        JSON.stringify({ kind: 'judge_result', round: 1, status: 'success', reward: 1, feedback: { ok: true } }),
        JSON.stringify({ kind: 'new_future_kind', round: 1, extra: 42 }),
        JSON.stringify({ kind: 'run_finished', status: 'success', reward: 1 }),
      ].join('\n') + '\n',
      'utf8',
    )

    const records = await readTrajectory(path)

    expect(records.map(record => record.kind)).toEqual([
      'run_context',
      'tool_call',
      'tool_result',
      'judge_result',
      'new_future_kind',
      'run_finished',
    ])
    expect(records[4]).toMatchObject({ kind: 'new_future_kind', round: 1, extra: 42 })
  })

  test('reports bad JSON with file path and line number', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trajectory-bad-'))
    roots.push(root)
    const path = join(root, 'trajectory.clean.jsonl')
    writeFileSync(path, '{"kind":"run_context"}\nnot-json\n', 'utf8')

    await expect(readTrajectory(path)).rejects.toThrow(`${path}:2`)
  })

  test('rejects lines that exceed the configured line byte limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trajectory-line-limit-'))
    roots.push(root)
    const path = join(root, 'trajectory.clean.jsonl')
    writeFileSync(path, JSON.stringify({ kind: 'assistant_text', text: 'x'.repeat(20) }) + '\n', 'utf8')

    await expect(readTrajectory(path, { maxLineBytes: 10 })).rejects.toThrow(`${path}:1`)
  })

  test('rejects trajectories that exceed the configured record limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trajectory-record-limit-'))
    roots.push(root)
    const path = join(root, 'trajectory.clean.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ kind: 'assistant_text', round: 1, text: 'one' }),
        JSON.stringify({ kind: 'assistant_text', round: 1, text: 'two' }),
      ].join('\n') + '\n',
      'utf8',
    )

    await expect(readTrajectory(path, { maxRecords: 1 })).rejects.toThrow('record limit')
  })
})

describe('buildRounds', () => {
  test('groups assistant text, merged tools, validation, finalize, and judge results by round', () => {
    const rounds = buildRounds([
      { kind: 'assistant_text', round: 1, text: 'try tool' },
      { kind: 'tool_call', round: 1, tool: 'Bash', tool_use_id: 't1', input: { cmd: 'pytest' } },
      { kind: 'tool_result', round: 1, tool_use_id: 't1', ok: false, text: 'failed' },
      { kind: 'submission_validation_failed', round: 1, ok: false, normalized_files: [], issues: [{ code: 'missing_output_file' }] },
      { kind: 'finalize', round: 1, summary: 'done', files: ['outputs/a.npz'] },
      { kind: 'judge_result', round: 1, status: 'failed', reward: 0, feedback: 'no' },
    ])

    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({ round: 1, assistantText: ['try tool'] })
    expect(rounds[0].toolInvocations[0]).toMatchObject({
      tool: 'Bash',
      toolUseId: 't1',
      input: { cmd: 'pytest' },
      result: { ok: false, text: 'failed' },
    })
    expect(rounds[0].submissionValidations[0]).toMatchObject({ ok: false })
    expect(rounds[0].finalizes[0]).toMatchObject({ summary: 'done' })
    expect(rounds[0].judgeResults[0]).toMatchObject({ status: 'failed', reward: 0 })
  })

  test('does not merge tool results across rounds when tool_use_id repeats', () => {
    const rounds = buildRounds([
      { kind: 'tool_call', round: 1, tool: 'Bash', tool_use_id: 'repeat', input: { cmd: 'first' } },
      { kind: 'tool_call', round: 2, tool: 'Bash', tool_use_id: 'repeat', input: { cmd: 'second' } },
      { kind: 'tool_result', round: 2, tool_use_id: 'repeat', ok: true, text: 'second-result' },
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds[0].toolInvocations[0]).toMatchObject({
      toolUseId: 'repeat',
      input: { cmd: 'first' },
    })
    expect(rounds[0].toolInvocations[0].result).toBeUndefined()
    expect(rounds[1].toolInvocations[0]).toMatchObject({
      toolUseId: 'repeat',
      input: { cmd: 'second' },
      result: { ok: true, text: 'second-result' },
    })
  })

  test('keeps an unmatched repeated tool result in its own round', () => {
    const rounds = buildRounds([
      { kind: 'tool_call', round: 1, tool: 'Bash', tool_use_id: 'repeat', input: { cmd: 'first' } },
      { kind: 'tool_result', round: 2, tool_use_id: 'repeat', ok: false, text: 'round-two-result' },
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds[0].toolInvocations[0]).toMatchObject({
      toolUseId: 'repeat',
      input: { cmd: 'first' },
    })
    expect(rounds[0].toolInvocations[0].result).toBeUndefined()
    expect(rounds[1].toolInvocations[0]).toMatchObject({
      tool: 'unknown',
      toolUseId: 'repeat',
      result: { ok: false, text: 'round-two-result' },
    })
  })
})
