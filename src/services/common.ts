import type { Context } from 'koishi'
import { join } from 'node:path'
import { Services } from 'koishi-plugin-yesimbot'

export interface ApiEnvelope<T> {
  ok: boolean
  data: T
  degraded?: string[]
  warnings?: string[]
  error?: string
}

export function qs(value: unknown): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return typeof value === 'string' ? value : ''
}

export function onum(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function hasWorldState(ctx: Context): boolean {
  return !!ctx[Services.WorldState]
}

export function hasMemory(ctx: Context): boolean {
  return !!ctx[Services.Memory]
}

export function hasDatabase(ctx: Context): boolean {
  return !!ctx.database
}

export function yesimbotDataDir(ctx: Context): string {
  return join(ctx.baseDir, 'data', 'yesimbot')
}

export function coreMemoryDir(ctx: Context): string {
  return join(yesimbotDataDir(ctx), 'memory', 'core')
}

export function interactionsDir(ctx: Context): string {
  return join(yesimbotDataDir(ctx), 'interactions')
}

export async function settle<T>(tasks: Promise<T>[]): Promise<Array<{ ok: true; value: T } | { ok: false; error: string }>> {
  return Promise.all(
    tasks.map((task) =>
      task.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error: (error as Error).message }),
      ),
    ),
  )
}

export function tzLocalDayBoundsUTC(timeZone: string, dateStr: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const probe = Date.UTC(y, mo - 1, d, 12, 0, 0)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const asPartsUTCFake = (ms: number) => {
    const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute))
  }
  const offsetMs = asPartsUTCFake(probe) - probe
  const start = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - offsetMs)
  const end = new Date(start.getTime() + 86400000)
  return { start, end }
}
