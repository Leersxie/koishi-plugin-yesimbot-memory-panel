import type { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { coreMemoryDir, yesimbotDataDir } from './common'

/**
 * 行为学习器数据读取（只读视图）。
 * 直接读共享 data 目录，零插件间依赖；面板不依赖该插件被加载。
 */

export interface BehaviorPanelData {
  behaviorRaw: string
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
  round: number
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

  let behaviorRaw = ''
  try {
    behaviorRaw = await fs.readFile(join(coreDir, 'behavior.md'), 'utf8')
  } catch {
    warnings.push('behavior.md 不存在或不可读（行为学习器可能尚未初始化）。')
  }

  let candidates: BehaviorPanelData['candidates'] = []
  let round = 0
  const pending = await readJson<{ round: number; candidates: BehaviorPanelData['candidates'] }>(join(dataDir, 'memory', 'behavior.pending.json'))
  if (pending.ok) {
    round = pending.value.round ?? 0
    candidates = Array.isArray(pending.value.candidates) ? pending.value.candidates : []
  } else {
    warnings.push('behavior.pending.json 不可读（无待确认候选）。')
  }

  let stats: BehaviorPanelData['stats'] = null
  const statsRes = await readJson<NonNullable<BehaviorPanelData['stats']>>(join(dataDir, 'memory', 'behavior.stats.json'))
  if (statsRes.ok) stats = statsRes.value

  return { behaviorRaw, candidates, round, stats }
}
