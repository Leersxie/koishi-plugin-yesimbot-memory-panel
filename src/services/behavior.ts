import type { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { coreMemoryDir, yesimbotDataDir } from './common'

/**
 * 行为学习器数据读取（只读视图）。
 *
 * 行为学习器插件的关键文件都在共享的 <baseDir>/data/yesimbot/ 下，
 * 本面板不依赖该插件被加载，直接读文件即可展示（零插件间依赖）：
 * - behavior.md            → <baseDir>/data/yesimbot/memory/core/behavior.md（核心记忆块）
 * - behavior.pending.json  → <baseDir>/data/yesimbot/memory/behavior.pending.json（待确认候选）
 * - behavior.stats.json    → <baseDir>/data/yesimbot/memory/behavior.stats.json（采纳/跳过统计）
 *
 * 所有读取失败都降级为空数据 + warnings，不抛错。
 */

/** 行为层标签页的整体返回结构 */
export interface BehaviorPanelData {
  /** behavior.md 原始内容（可能极长，前端自行截断展示） */
  behaviorRaw: string
  /** 待确认候选列表（pending.candidates） */
  candidates: Array<{
    id: string
    category: string
    text: string
    evidence: string
    time: string
    confidence: number
    createdAt: number
    channelCid: string
  }>
  /** 提炼轮次与 hash 基线 */
  round: number
  /** 统计摘要（stats 文件，可能不存在） */
  stats: null | {
    totalRounds: number
    totalCandidates: number
    adopted: number
    skipped: number
    duplicated: number
    byCategory: Record<string, { adopted: number; skipped: number; total: number }>
  }
}

async function readJson<T>(path: string): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: JSON.parse(await fs.readFile(path, 'utf8')) as T }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export async function getBehaviorData(ctx: Context): Promise<BehaviorPanelData> {
  const warnings: string[] = []
  const coreDir = coreMemoryDir(ctx)
  const dataDir = yesimbotDataDir(ctx)

  // behavior.md
  let behaviorRaw = ''
  try {
    behaviorRaw = await fs.readFile(join(coreDir, 'behavior.md'), 'utf8')
  } catch {
    warnings.push('behavior.md 不存在或不可读（行为学习器可能尚未初始化）。')
  }

  // pending
  let candidates: BehaviorPanelData['candidates'] = []
  let round = 0
  const pending = await readJson<{ round: number; candidates: BehaviorPanelData['candidates'] }>(join(dataDir, 'memory', 'behavior.pending.json'))
  if (pending.ok) {
    round = pending.value.round ?? 0
    candidates = Array.isArray(pending.value.candidates) ? pending.value.candidates : []
  } else {
    warnings.push('behavior.pending.json 不可读（无待确认候选）。')
  }

  // stats
  let stats: BehaviorPanelData['stats'] = null
  const statsRes = await readJson<NonNullable<BehaviorPanelData['stats']>>(join(dataDir, 'memory', 'behavior.stats.json'))
  if (statsRes.ok) stats = statsRes.value

  return { behaviorRaw, candidates, round, stats }
}