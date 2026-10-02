import type { Context } from 'koishi'
import { TableName, Services } from 'koishi-plugin-yesimbot'
import { hasDatabase, hasWorldState } from './common'

export interface L2Item {
  id: string
  platform: string
  channelId: string
  content: string
  similarity: number | null
  startTimestamp: string
  endTimestamp: string
  dim?: number | null
}

export interface L2SearchResult {
  items: L2Item[]
  degraded: string[]
  warnings: string[]
  source: 'service' | 'keyword-sim' | 'empty'
}

export interface L2ListResult {
  items: L2Item[]
  total: number
  dim: number | null
  degraded: string[]
  warnings: string[]
}

const toIso = (value: Date | string): string => {
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString()
}

function needChannel(platform: string, channelId: string): boolean {
  return !platform || !channelId
}

/** 降级检索：关键词重叠得分（中英文混合：连续文本按 2-gram 切分）+ 时间升序 */
function keywordScore(content: string, query: string): number {
  const words = query
    .split(/[\s,，。.!！?？;；:：""''（）()\-_/\\]+/)
    .filter((w) => w.length >= 2)
  if (!words.length) return 0
  let hit = 0
  for (const w of words) {
    if (w.length <= 4 && /^[\u4e00-\u9fff]+$/.test(w)) {
      const grams: string[] = []
      for (let i = 0; i + 2 <= w.length; i++) grams.push(w.slice(i, i + 2))
      if (grams.some((g) => content.includes(g))) {
        hit++
        continue
      }
    }
    if (content.includes(w)) hit++
  }
  return hit / words.length
}

async function dbChunks(ctx: Context, platform: string, channelId: string, limit: number) {
  const query: Record<string, unknown> = {}
  if (platform) query.platform = platform
  if (channelId) query.channelId = channelId
  return ctx.database.get(TableName.L2Chunks, query, { fields: ['id', 'platform', 'channelId', 'content', 'startTimestamp', 'endTimestamp'] })
    .then((rows) => rows.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime()).slice(-limit))
}

async function viaService(ctx: Context, text: string, platform: string, channelId: string, k: number): Promise<L2SearchResult> {
  const options: { platform?: string; channelId?: string; k: number } = { k }
  if (platform) options.platform = platform
  if (channelId) options.channelId = channelId
  const chunks = await ctx[Services.WorldState].l2_manager.search(text, options)
  if (chunks.length > 0) {
    return {
      items: chunks.map((chunk) => ({
        id: chunk.id,
        platform: chunk.platform,
        channelId: chunk.channelId,
        content: chunk.content,
        similarity: chunk.similarity ?? null,
        startTimestamp: toIso(chunk.startTimestamp),
        endTimestamp: toIso(chunk.endTimestamp),
      })),
      degraded: [],
      warnings: ['L2 检索来自 yesimbot.world-state 公开服务（l2_manager.search），与真实注入同源。'],
      source: 'service',
    }
  }
  const note = 'l2.search 返回为空（可能未配置嵌入模型或 L2 关闭），已改用数据库关键词模拟。'
  const rows = hasDatabase(ctx)
    ? await ctx.database.get(TableName.L2Chunks, {}, { fields: ['id', 'platform', 'channelId', 'content', 'startTimestamp', 'endTimestamp'] })
    : []
  return keywordFallback(rows, text, k, note)
}

async function keywordFallback(rows: Array<{ id: string; platform: string; channelId: string; content: string; startTimestamp: Date; endTimestamp: Date }>, text: string, k: number, note: string): Promise<L2SearchResult> {
  const scored = text.trim()
    ? rows
        .map((row) => ({ row, score: keywordScore(row.content, text) }))
        .sort((a, b) => b.score - a.score || new Date(b.row.startTimestamp).getTime() - new Date(a.row.startTimestamp).getTime())
    : rows.map((row) => ({ row, score: 0 }))
  const top = (text.trim() ? scored.filter((s) => s.score > 0) : scored).slice(0, k)
  return {
    items: top.map(({ row, score }) => ({
      id: row.id,
      platform: row.platform,
      channelId: row.channelId,
      content: row.content,
      similarity: text.trim() ? score : null,
      startTimestamp: toIso(row.startTimestamp),
      endTimestamp: toIso(row.endTimestamp),
    })),
    degraded: ['l2'],
    warnings: ['以下内容为本地文件模拟，非 YesImBot 实际注入结果，仅供参考。', note],
    source: 'keyword-sim',
  }
}

export async function searchL2(ctx: Context, text: string, platform: string, channelId: string, k: number): Promise<L2SearchResult> {
  if (!hasDatabase(ctx)) {
    return { items: [], degraded: ['l2'], warnings: ['无数据库服务，L2 不可用。'], source: 'empty' }
  }
  if (hasWorldState(ctx) && !needChannel(platform, channelId)) {
    try {
      return await viaService(ctx, text, platform, channelId, k)
    } catch (error) {
      const rows = await ctx.database.get(TableName.L2Chunks, {}, { fields: ['id', 'platform', 'channelId', 'content', 'startTimestamp', 'endTimestamp'] })
      return keywordFallback(rows, text, k, `l2.search 调用失败：${(error as Error).message}`)
    }
  }
  if (needChannel(platform, channelId)) {
    return {
      items: [],
      degraded: ['l2'],
      warnings: ['请先选择频道后再做 L2 语义检索（真实注入依赖 platform/channelId 过滤）。'],
      source: 'empty',
    }
  }
  const rows = await ctx.database.get(TableName.L2Chunks, {}, { fields: ['id', 'platform', 'channelId', 'content', 'startTimestamp', 'endTimestamp'] })
  return keywordFallback(rows, text, k, 'world-state 服务未加载，使用数据库关键词模拟。')
}

export async function listL2(ctx: Context, platform: string, channelId: string, page: number, pageSize: number): Promise<L2ListResult> {
  if (!hasDatabase(ctx)) {
    return { items: [], total: 0, dim: null, degraded: ['l2'], warnings: ['无数据库服务，L2 不可用。'] }
  }
  const query: Record<string, unknown> = {}
  if (platform) query.platform = platform
  if (channelId) query.channelId = channelId
  const start = page * pageSize
  let rows: Array<{ id: string; platform: string; channelId: string; content: string; startTimestamp: Date; endTimestamp: Date }> | null = null
  try {
    rows = await (ctx.database as any)
      .select(TableName.L2Chunks, query)
      .orderBy('startTimestamp', 'desc')
      .limit(start, pageSize)
      .project(['id', 'platform', 'channelId', 'content', 'startTimestamp', 'endTimestamp'])
      .execute()
  } catch {
    rows = null
  }
  let items = rows ?? []
  let total = -1
  if (rows === null) {
    const all = await ctx.database.get(TableName.L2Chunks, query, {
      fields: ['id', 'platform', 'channelId', 'content', 'startTimestamp', 'endTimestamp'],
    })
    all.sort((a, b) => new Date(b.startTimestamp).getTime() - new Date(a.startTimestamp).getTime())
    total = all.length
    items = all.slice(start, start + pageSize)
  }
  let dim: number | null = null
  try {
    const firstId = rows?.[0]?.id ?? (items[0] as { id?: string } | undefined)?.id
    if (firstId) {
      const one = await ctx.database.get(TableName.L2Chunks, { id: firstId }, { fields: ['embedding'] })
      dim = one[0]?.embedding?.length ?? null
    }
  } catch {
    /* 忽略维度探测失败 */
  }
  return {
    items: items.map((row) => ({
      id: row.id,
      platform: row.platform,
      channelId: row.channelId,
      content: row.content,
      similarity: null,
      startTimestamp: toIso(row.startTimestamp),
      endTimestamp: toIso(row.endTimestamp),
      dim,
    })),
    total,
    dim,
    degraded: [],
    warnings: ['L2 列表为数据库表直读（不参与检索），仅用于浏览。'],
  }
}
