import type { Context } from 'koishi'
import { join } from 'node:path'
import { Services } from 'koishi-plugin-yesimbot'

/** REST 响应统一外壳 */
export interface ApiEnvelope<T> {
  ok: boolean
  data: T
  degraded?: string[]
  warnings?: string[]
  error?: string
}

/** koa-router 查询参数可能是 string | string[] | undefined，统一取首个字符串 */
export function qs(value: unknown): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return typeof value === 'string' ? value : ''
}

/** 解析数字参数，非法时回退到默认值 */
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
