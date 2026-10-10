import type { Context } from 'koishi'
import { timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { Services } from 'koishi-plugin-yesimbot'

/**
 * 通用工具与共享类型。
 * 集中放：API 响应外壳、查询参数解析、服务可用性守卫、YesImBot 数据目录定位。
 * 所有对外 REST 响应统一使用 { ok, data, degraded, warnings } 外壳，前端据此渲染降级横幅。
 */

/** REST 响应统一外壳 */
export interface ApiEnvelope<T> {
  ok: boolean
  data: T
  /** 本次响应当中发生降级的环节列表（具体到字段） */
  degraded?: string[]
  /** 面向用户的补充说明（会在前端展示为提示条） */
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

/**
 * 解析数字参数并按 [min, max] 收敛取整。
 *
 * onum 只保证“有限数”，不放行范围约束：`?limit=-1` 在 SQLite 语义下等价于“不限量”，
 * `?limit=100000000` 则会一次性返回全表。所有来自查询串的数值都必须经过本函数。
 */
export function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 常量时间字符串比较，避免令牌校验被计时侧信道逐字符推断 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** 判断 yesimbot.world-state 服务是否已加载（可选注入，需运行时守卫） */
export function hasWorldState(ctx: Context): boolean {
  return !!ctx[Services.WorldState]
}

/** 判断 yesimbot.memory 服务是否已加载 */
export function hasMemory(ctx: Context): boolean {
  return !!ctx[Services.Memory]
}

/** 判断数据库服务是否已加载 */
export function hasDatabase(ctx: Context): boolean {
  return !!ctx.database
}

/** YesImBot 数据根目录：<koishi baseDir>/data/yesimbot */
export function yesimbotDataDir(ctx: Context): string {
  return join(ctx.baseDir, 'data', 'yesimbot')
}

/** 核心人格块目录：<baseDir>/data/yesimbot/memory/core */
export function coreMemoryDir(ctx: Context): string {
  return join(yesimbotDataDir(ctx), 'memory', 'core')
}

/** Agent 交互日志目录：<baseDir>/data/yesimbot/interactions */
export function interactionsDir(ctx: Context): string {
  return join(yesimbotDataDir(ctx), 'interactions')
}

/** 线程安全的 Promise.all 包装：任意一项失败不拖垮整体，返回 { ok } 结构 */
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

/** 把 "YYYY-MM-DD" 解析为指定时区的当天 UTC 边界 [start, end)（左闭右开；用当天正午计算偏移，DST 边缘误差极小，中国无 DST 精确） */
export function tzLocalDayBoundsUTC(timeZone: string, dateStr: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])

  const probe = Date.UTC(y, mo - 1, d, 12, 0, 0) // 当天正午 UTC 探针
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  // 目标时区"本地部件拼成假 UTC" - 真实 UTC = 时区偏移
  const asPartsUTCFake = (ms: number) => {
    const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute))
  }
  const offsetMs = asPartsUTCFake(probe) - probe
  const start = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - offsetMs)
  const end = new Date(start.getTime() + 86400000)
  return { start, end }
}