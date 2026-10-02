import type { Context } from 'koishi'
import { TableName } from 'koishi-plugin-yesimbot'
import type { Config } from '../config'
import { hasDatabase, hasWorldState, settle, tzLocalDayBoundsUTC } from './common'
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
    let rawStats: Record<string, { rows?: number; size?: number }> | null = null
    try {
      const stats = await (db as unknown as { stats?: () => Promise<any> }).stats?.()
      const normalized: Record<string, { rows?: number; size?: number }> = {}
      if (stats && (stats as any).tables) {
        for (const [name, info] of Object.entries((stats as any).tables)) {
          const t = info as { count?: number; size?: number }
          normalized[name] = { rows: t.count, size: t.size }
        }
        rawStats = normalized
      }
    } catch {
      rawStats = null
    }
    const statResults = await settle(
      MEMORY_TABLES.map((name) =>
        rawStats && rawStats[name]?.rows != null
          ? Promise.resolve({ length: rawStats[name]!.rows! })
          : db.get(name, {}, { fields: ['id'] }),
      ),
    )
    const tables: TableStat[] = statResults.map((r, index) => {
      const name = MEMORY_TABLES[index]!
      return r.ok ? { name, rows: (r.value as unknown as { length: number }).length, size: rawStats?.[name]?.size ?? null } : { name, rows: 0, size: null, error: r.error }
    })
    const byChannel = new Map<string, { messages: number; l2: number; l3: number }>()
    const addCount = (rows: Array<{ platform?: string; channelId?: string }>, field: 'messages' | 'l2' | 'l3') => {
      for (const row of rows) {
        const key = `${row.platform ?? '?'}:${row.channelId ?? '?'}`
        const item = byChannel.get(key) ?? { messages: 0, l2: 0, l3: 0 }
        item[field]++
        byChannel.set(key, item)
      }
    }
    const groupCounts = async (name: TableKey): Promise<Array<{ platform: string; channelId: string; count: number }> | null> => {
      try {
        const mod: any = require('minato')
        const Eval = mod.Eval
        const grouped = await (db as any).select(name, {}).groupBy(['platform', 'channelId'], (row: any) => ({ count: Eval.count(row.id) })).execute()
        return (grouped as Array<{ platform?: string; channelId?: string; count?: number }>).map((row) => ({
          platform: row.platform ?? '?',
          channelId: row.channelId ?? '?',
          count: row.count ?? 0,
        }))
      } catch {
        return null
      }
    }
    const groupRes = await Promise.all([groupCounts(TableName.Messages), groupCounts(TableName.L2Chunks), groupCounts(TableName.L3Diaries)])
    const gMsg = groupRes[0]
    const gL2 = groupRes[1]
    const gL3 = groupRes[2]
    const setGroup = (rows: Array<{ platform: string; channelId: string; count: number }> | null, field: 'messages' | 'l2' | 'l3') => {
      if (!rows) return false
      for (const row of rows) {
        const key = `${row.platform}:${row.channelId}`
        const item = byChannel.get(key) ?? { messages: 0, l2: 0, l3: 0 }
        item[field] += row.count
        byChannel.set(key, item)
      }
      return true
    }
    const gOk = [setGroup(gMsg, 'messages'), setGroup(gL2, 'l2'), setGroup(gL3, 'l3')]
    if (!gOk[0] || !gOk[1] || !gOk[2]) {
      const needMsg = !gOk[0]
      const needL2 = !gOk[1]
      const needL3 = !gOk[2]
      if (needMsg || needL2 || needL3) {
        const fallback = await settle([
          needMsg ? db.get(TableName.Messages, {}, { fields: ['platform', 'channelId'] }) : Promise.resolve([]),
          needL2 ? db.get(TableName.L2Chunks, {}, { fields: ['platform', 'channelId'] }) : Promise.resolve([]),
          needL3 ? db.get(TableName.L3Diaries, {}, { fields: ['platform', 'channelId'] }) : Promise.resolve([]),
        ])
        if (needMsg && fallback[0].ok) addCount(fallback[0].value as Array<{ platform?: string; channelId?: string }>, 'messages')
        if (needL2 && fallback[1].ok) addCount(fallback[1].value as Array<{ platform?: string; channelId?: string }>, 'l2')
        if (needL3 && fallback[2].ok) addCount(fallback[2].value as Array<{ platform?: string; channelId?: string }>, 'l3')
      }
    }
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
    const tz = this.config.timezone || 'Asia/Shanghai'
    const afterBounds = after ? tzLocalDayBoundsUTC(tz, after) : null
    const beforeBounds = before ? tzLocalDayBoundsUTC(tz, before) : null
    if (real === TableName.L3Diaries) {
      if (before) query.date = { $lte: before }
      if (after) query.date = { $gte: after }
    } else {
      const field = real === TableName.L2Chunks ? 'startTimestamp' : 'timestamp'
      const ts: Record<string, unknown> = {}
      if (afterBounds) ts.$gte = afterBounds.start
      if (beforeBounds) ts.$lt = beforeBounds.end
      if (Object.keys(ts).length) query[field] = ts
    }
    const target = (await db.get(real, query, { fields: ['id'] })) as Array<{ id: string }>
    if (!target.length) return { table, removed: 0, skipped: 0, degraded, warnings: ['没有符合条件的数据。'] }
    const victims = target.slice(0, this.config.cleanupMaxRows)
    await db.remove(real, { id: { $in: victims.map((v) => v.id) } } as never)
    const skipped = target.length - victims.length
    if (skipped > 0) warnings.push(`符合条件共 ${target.length} 行，受护栏限制仅删除 ${victims.length} 行，剩余 ${skipped} 行请分批处理。`)
    return { table, removed: victims.length, skipped, degraded, warnings }
  }
}
