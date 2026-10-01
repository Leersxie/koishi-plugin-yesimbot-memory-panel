import type { Context } from 'koishi'
import { TableName } from 'koishi-plugin-yesimbot'
import { hasDatabase } from './common'

export interface L3Item {
  id: string
  date: string
  platform: string
  channelId: string
  content: string
  keywords: string[]
  mentionedUserIds: string[]
}

export interface L3ListResult {
  items: L3Item[]
  degraded: string[]
  warnings: string[]
}

export async function listDates(ctx: Context): Promise<{ dates: string[]; degraded: string[]; warnings: string[] }> {
  if (!hasDatabase(ctx)) {
    return { dates: [], degraded: ['l3'], warnings: ['无数据库服务，L3 不可用。'] }
  }
  const rows = await ctx.database.get(TableName.L3Diaries, {}, { fields: ['date', 'id'] })
  const dates = Array.from(new Set(rows.map((row) => row.date))).sort()
  return { dates, degraded: [], warnings: [] }
}

export async function listL3(ctx: Context, date?: string, platform?: string, channelId?: string): Promise<L3ListResult> {
  if (!hasDatabase(ctx)) {
    return { items: [], degraded: ['l3'], warnings: ['无数据库服务，L3 不可用。'] }
  }
  const query: Record<string, unknown> = {}
  if (date) query.date = date
  if (platform) query.platform = platform
  if (channelId) query.channelId = channelId
  const rows = await ctx.database.get(TableName.L3Diaries, query)
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.channelId.localeCompare(b.channelId))
  return {
    items: rows.map((row) => ({
      id: row.id,
      date: row.date,
      platform: row.platform,
      channelId: row.channelId,
      content: row.content,
      keywords: row.keywords ?? [],
      mentionedUserIds: row.mentionedUserIds ?? [],
    })),
    degraded: [],
    warnings: ['L3 日记为数据库表直读，与真实注入（按日期查昨日日记）同一张表。'],
  }
}
