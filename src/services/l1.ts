import type { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import { TableName, Services } from 'koishi-plugin-yesimbot'
import { hasDatabase, hasWorldState, interactionsDir } from './common'

export interface L1Event {
  type: string
  timestamp: string
  turnId?: string
  senderName?: string
  text: string
}

export interface L1Result {
  items: L1Event[]
  degraded: string[]
  warnings: string[]
  source: 'service' | 'database' | 'none'
}

function toIso(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString()
}

function serializeItem(item: any): L1Event {
  const base: L1Event = {
    type: item.type ?? 'unknown',
    timestamp: toIso(item.timestamp),
    turnId: item.turnId,
    senderName: item.sender?.name,
    text: '',
  }
  switch (item.type) {
    case 'message':
      base.text = item.content ?? ''
      break
    case 'agent_thought':
      base.text = `【观察】${item.observe || item.thoughts?.observe || ''}\n${item.analyze_infer || item.thoughts?.analyze_infer || ''}\n${item.plan || item.thoughts?.plan || ''}`
      break
    case 'agent_action':
      base.text = `调用 ${item.function || item.action?.function || ''}(${JSON.stringify(item.params ?? item.action?.params ?? {})})`
      break
    case 'agent_observation':
      base.text = `${item.function || ''} → ${item.status ?? ''}`
      break
    case 'agent_heartbeat':
      base.text = `心跳 ${item.current}/${item.max}`
      break
    case 'system_event':
      base.text = item.message || item.eventType || ''
      break
    default:
      base.text = JSON.stringify(item)
  }
  return base
}

async function viaService(ctx: Context, platform: string, channelId: string, limit: number): Promise<L1Result> {
  const raw = await ctx[Services.WorldState].l1_manager.getL1History(platform, channelId, limit)
  return {
    items: raw.map(serializeItem),
    degraded: [],
    warnings: ['L1 来自 yesimbot.world-state 公开服务（getL1History），与真实注入同源。'],
    source: 'service',
  }
}

async function viaDatabase(ctx: Context, platform: string, channelId: string, limit: number): Promise<L1Result> {
  if (!hasDatabase(ctx)) {
    return { items: [], degraded: ['l1'], warnings: ['无数据库服务，L1 不可用。'], source: 'none' }
  }
  const query: Record<string, unknown> = {}
  if (platform) query.platform = platform
  if (channelId) query.channelId = channelId
  const rows = await ctx.database.get(TableName.Messages, query, { fields: ['sender', 'content', 'timestamp'], limit })
  const items: L1Event[] = rows
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((row) => ({
      type: 'message',
      timestamp: toIso(row.timestamp),
      senderName: row.sender?.name,
      text: row.content ?? '',
    }))
  return {
    items,
    degraded: ['l1'],
    warnings: ['以下内容为数据库表直读（仅消息，不含 Agent 思考/动作），非 YesImBot 实际注入的 L1 工作记忆，仅供参考。'],
    source: 'database',
  }
}

export async function getL1(ctx: Context, platform: string, channelId: string, limit: number): Promise<L1Result> {
  if (hasWorldState(ctx) && hasDatabase(ctx)) {
    try {
      return await viaService(ctx, platform, channelId, limit)
    } catch (error) {
      return viaDatabase(ctx, platform, channelId, limit)
    }
  }
  return viaDatabase(ctx, platform, channelId, limit)
}

export interface ChannelItem {
  key: string
  platform: string
  channelId: string
  messageCount?: number
  hasAgentLog: boolean
}

export async function listChannels(ctx: Context): Promise<ChannelItem[]> {
  const map = new Map<string, ChannelItem>()
  const put = (platform: string, channelId: string, hasAgent: boolean) => {
    const key = `${platform}:${channelId}`
    const exist = map.get(key)
    if (!exist) {
      map.set(key, { key, platform, channelId, hasAgentLog: hasAgent })
    } else {
      exist.hasAgentLog ||= hasAgent
    }
  }
  if (hasDatabase(ctx)) {
    try {
      const rows = await ctx.database.get(TableName.Messages, {}, { fields: ['platform', 'channelId'] })
      for (const row of rows) put(row.platform, row.channelId, false)
    } catch {
      /* 忽略统计失败 */
    }
  }
  try {
    const root = interactionsDir(ctx)
    const platforms = await fs.readdir(root, { withFileTypes: true })
    for (const platformDir of platforms) {
      if (!platformDir.isDirectory()) continue
      const files = await fs.readdir(`${root}/${platformDir.name}`)
      for (const file of files) {
        if (!file.endsWith('.agent.jsonl')) continue
        put(platformDir.name, file.replace(/\.agent\.jsonl$/, ''), true)
      }
    }
  } catch {
    /* 目录不存在则忽略 */
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key))
}
