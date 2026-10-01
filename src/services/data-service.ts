import type { Context } from 'koishi'
import { TableName } from 'koishi-plugin-yesimbot'
import type { Config } from '../config'
import { hasDatabase, hasWorldState, settle } from './common'
import { getBlocks, type BlockResult } from './blocks'
import { getL1, listChannels } from './l1'
import { searchL2, listL2 } from './l2'
import { listDates, listL3 } from './l3'

export interface TableStat {
  name: string
  rows: number
  size: number | null
  error?: string
}

export interface OverviewResult {
  tables: TableStat[]
  byChannel: Array<{ key: string; messages: number; l2: number; l3: number }>
  l2Dim: number | null
  totalDiaries: number
  degraded: string[]
  warnings: string[]
}

export interface PreviewPart {
  source: string
  count: number
  items: unknown[]
}

export interface PreviewResult {
  simulated: boolean
  parts: {
    blocks: PreviewPart
    l1: PreviewPart
    l2: PreviewPart
  }
  degraded: string[]
  warnings: string[]
}

export interface CleanupResult {
  table: string
  removed: number
  skipped: number
  degraded: string[]
  warnings: string[]
}

type TableKey = typeof TableName.Messages | typeof TableName.L2Chunks | typeof TableName.L3Diaries

const MEMORY_TABLES: TableKey[] = [TableName.Messages, TableName.L2Chunks, TableName.L3Diaries]
const CLEANABLE: Record<string, TableKey> = {
  messages: TableName.Messages,
  l2_chunks: TableName.L2Chunks,
  l3_diaries: TableName.L3Diaries,
}

const MSG_DEGRADED_BANNER = '以下内容为本地模拟，非 YesImBot 实际注入结果，仅供参考。'

export class MemoryPanelService {
  constructor(
    public readonly ctx: Context,
    public readonly config: Config,
  ) {}

  private async l2Dim(): Promise<number | null> {
    try {
      const one = await this.ctx.database?.get(TableName.L2Chunks, {}, { fields: ['embedding'], limit: 1 })
      return one?.[0]?.embedding?.length ?? null
    } catch {
      return null
    }
  }

  async overview(): Promise<OverviewResult> {
    const degraded: string[] = []
    const warnings: string[] = []
    if (!hasDatabase(this.ctx)) {
      return { tables: [], byChannel: [], l2Dim: null, totalDiaries: 0, degraded: ['overview'], warnings: ['无数据库服务，无法体检。'] }
    }
    const db = this.ctx.database!
    const statResults = await settle(MEMORY_TABLES.map((name) => db.get(name, {}, { fields: ['id'] })))
    const tables: TableStat[] = statResults.map((r, index) => {
      const name = MEMORY_TABLES[index]!
      return r.ok ? { name, rows: r.value.length, size: null } : { name, rows: 0, size: null, error: r.error }
    })
    let rawStats: Record<string, { rows?: number; size?: number }> | null = null
    try {
      const stats = await (db as unknown as { stats?: () => Promise<Record<string, { rows?: number; size?: number }>> }).stats?.()
      rawStats = stats ?? null
    } catch {
      rawStats = null
    }
    if (rawStats) {
      for (const stat of tables) {
        stat.size = rawStats[stat.name]?.size ?? null
      }
    }
    const [msgs, l2, l3] = await settle([
      db.get(TableName.Messages, {}, { fields: ['platform', 'channelId'] }),
      db.get(TableName.L2Chunks, {}, { fields: ['platform', 'channelId'] }),
      db.get(TableName.L3Diaries, {}, { fields: ['platform', 'channelId'] }),
    ])
    const byChannel = new Map<string, { messages: number; l2: number; l3: number }>()
    const addCount = (rows: Array<{ platform?: string; channelId?: string }>, field: 'messages' | 'l2' | 'l3') => {
      for (const row of rows) {
        const key = `${row.platform ?? '?'}:${row.channelId ?? '?'}`
        const item = byChannel.get(key) ?? { messages: 0, l2: 0, l3: 0 }
        item[field]++
        byChannel.set(key, item)
      }
    }
    if (msgs.ok) addCount(msgs.value, 'messages')
    if (l2.ok) addCount(l2.value, 'l2')
    if (l3.ok) addCount(l3.value, 'l3')
    const l2Dim = await this.l2Dim()
    const totalDiaries = tables.find((t) => t.name === TableName.L3Diaries)?.rows ?? 0

    if (rawStats === null) {
      degraded.push('overview-size')
      warnings.push('当前数据库驱动未提供 size 统计，容量列显示为 —。')
    }
    return {
      tables,
      byChannel: Array.from(byChannel.entries())
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.messages + b.l2 + b.l3 - (a.messages + a.l2 + a.l3)),
      l2Dim,
      totalDiaries,
      degraded,
      warnings,
    }
  }

  async preview(text: string, platform: string, channelId: string): Promise<PreviewResult> {
    const degraded: string[] = []
    const warnings: string[] = [
      '本预览分别独立调用与 YesImBot 注入链同源的公开函数（getMemoryBlocksForRendering / getL1History / l2_manager.search），',
      '但未经过 buildWorldState 的会话上下文组装，且真实 L2 注入受“L1 满载才触发、new_events 参与检索、频道过滤”等条件影响，',
      '结果非逐字还原真实推理输入，仅供参考。',
    ]
    if (!hasDatabase(this.ctx)) degraded.push('preview-l1', 'preview-l2')
    const [blocks, l1, l2] = await Promise.all([
      getBlocks(this.ctx).catch((): BlockResult => ({ items: [], source: 'file', degraded: ['blocks'], warnings: [MSG_DEGRADED_BANNER] })),
      getL1(this.ctx, platform, channelId, this.config.l1PreviewLimit),
      searchL2(this.ctx, text, platform, channelId, this.config.l2PreviewK),
    ])
    degraded.push(...blocks.degraded, ...l1.degraded, ...l2.degraded)
    warnings.push(...blocks.warnings, ...l1.warnings, ...l2.warnings)
    return {
      simulated: !(hasWorldState(this.ctx) && blocks.source !== 'file' && l1.source === 'service' && l2.source === 'service'),
      parts: {
        blocks: { source: blocks.source, count: blocks.items.length, items: blocks.items },
        l1: { source: l1.source, count: l1.items.length, items: l1.items },
        l2: { source: l2.source, count: l2.items.length, items: l2.items },
      },
      degraded: Array.from(new Set(degraded)),
      warnings: Array.from(new Set(warnings)),
    }
  }

  async channels() {
    return listChannels(this.ctx)
  }

  async blocks() {
    return getBlocks(this.ctx)
  }

  async l1(platform: string, channelId: string, limit: number) {
    return getL1(this.ctx, platform, channelId, limit)
  }

  async l2Search(text: string, platform: string, channelId: string, k: number) {
    return searchL2(this.ctx, text, platform, channelId, k)
  }

  async l3Dates() {
    return listDates(this.ctx)
  }

  async l3List(date?: string, platform?: string, channelId?: string) {
    return listL3(this.ctx, date, platform, channelId)
  }

  async l2List(platform: string, channelId: string, page: number) {
    return listL2(this.ctx, platform, channelId, page, this.config.l2PreviewK * 4)
  }

  async cleanup(table: string, platform: string, channelId: string, before?: string, after?: string): Promise<CleanupResult> {
    const warnings: string[] = []
    const degraded: string[] = []
    const real = CLEANABLE[table]
    if (!real) {
      return { table, removed: 0, skipped: 0, degraded: ['cleanup'], warnings: [`不允许清理表 ${table}，仅支持 ${Object.keys(CLEANABLE).join(' / ')}。`] }
    }
    if (!hasDatabase(this.ctx) || !this.ctx.database) {
      return { table, removed: 0, skipped: 0, degraded: ['cleanup'], warnings: ['无数据库服务，无法清理。'] }
    }
    const db = this.ctx.database
    const query: Record<string, unknown> = {}
    if (platform) query.platform = platform
    if (channelId) query.channelId = channelId
    if (real === TableName.L3Diaries) {
      if (before) query.date = { $lte: before }
      if (after) query.date = { $gte: after }
    } else {
      const ts: Record<string, unknown> = {}
      if (before) ts.$lte = new Date(before)
      if (after) ts.$gte = new Date(after)
      if (Object.keys(ts).length) query.timestamp = ts
    }
    const target = (await db.get(real, query, { fields: ['id'] })) as Array<{ id: string }>
    if (!target.length) return { table, removed: 0, skipped: 0, degraded, warnings: ['没有符合条件的数据。'] }
    const victims = target.slice(0, this.config.cleanupMaxRows)
    const removed = victims.length
    await db.remove(real, { id: { $in: victims.map((v) => v.id) } } as never)
    const skipped = target.length - removed
    if (skipped > 0) warnings.push(`符合条件共 ${target.length} 行，受护栏限制仅删除 ${removed} 行，剩余 ${skipped} 行请分批处理。`)
    return { table, removed, skipped, degraded, warnings }
  }
}
