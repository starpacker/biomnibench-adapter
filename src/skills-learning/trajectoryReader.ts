import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import type { TrajectoryRecord } from './types.js'

export type ReadTrajectoryOptions = {
  maxBytes?: number
  maxLineBytes?: number
  maxRecords?: number
}

export async function readTrajectory(
  path: string,
  options: ReadTrajectoryOptions = {},
): Promise<TrajectoryRecord[]> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  const records: TrajectoryRecord[] = []
  let lineNumber = 0
  let bytesRead = 0

  try {
    for await (const rawLine of lines) {
      lineNumber += 1
      const lineBytes = Buffer.byteLength(rawLine, 'utf8')
      bytesRead += lineBytes + 1
      if (options.maxBytes !== undefined && bytesRead > options.maxBytes) {
        throw new Error(`${path}:${lineNumber}: trajectory exceeds byte limit ${options.maxBytes}`)
      }
      if (options.maxLineBytes !== undefined && lineBytes > options.maxLineBytes) {
        throw new Error(`${path}:${lineNumber}: line exceeds byte limit ${options.maxLineBytes}`)
      }
      const line = rawLine.trim()
      if (!line) continue

      try {
        const parsed = JSON.parse(line)
        if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') {
          records.push(parsed)
        } else {
          records.push({ kind: 'unknown', value: parsed })
        }
      } catch (error) {
        throw new Error(`${path}:${lineNumber}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (options.maxRecords !== undefined && records.length > options.maxRecords) {
        throw new Error(`${path}:${lineNumber}: trajectory exceeds record limit ${options.maxRecords}`)
      }
    }
  } finally {
    lines.close()
    stream.destroy()
  }

  return records
}
