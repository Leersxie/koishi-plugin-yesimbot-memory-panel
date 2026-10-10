import type { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import { Services } from 'koishi-plugin-yesimbot'
import { coreMemoryDir, hasMemory } from './common'
import type { MemoryBlockData } from 'koishi-plugin-yesimbot'

/**
 * 核心人格块取数。
 *
 * 优先走公开 Service：ctx[Services.Memory].getMemoryBlocksForRendering()
 * —— 这正是 YesImBot 每次 Agent 心跳注入上下文所调用的同一个方法
 * （见 koishi-plugin-yesimbot/lib/agent/context-builder.js 的 memoryBlocks 字段），
 * 因此面板上标注为"注入一致"。
 *
 * 降级（yesimbot.memory 未加载时）：直接读 <baseDir>/data/yesimbot/memory/core/*.md，
 * 此时前端必须展示"本地文件模拟"标注。
 */

/** 面板展示用的人格块条目 */
export interface BlockItem {
  title: string
  label: string
  description: string
  content: string
  /** 字节数（service 路径取字符数近似，文件路径取 fs 真实字节数） */
  size: number
  /** 来源标识：service=YesImBot 公开服务 / file=本地文件降级 */
  source: 'service' | 'file'
  /** 是否与真实注入同一数据源 */
  injected: boolean
}

export interface BlockResult {
  items: BlockItem[]
  source: 'service' | 'file'
  degraded: string[]
  warnings: string[]
}

/** 通过公开 Service 获取（与真实注入一致） */
async function viaService(ctx: Context, blocks: MemoryBlockData[]): Promise<BlockResult> {
  return {
    items: blocks.map((block) => ({
      title: block.title,
      label: block.label,
      description: block.description,
      content: block.content,
      size: block.content.length,
      source: 'service',
      injected: true,
    })),
    source: 'service',
    degraded: [],
    warnings: ['人格块来自 YesImBot memory 公开服务，与 Agent 心跳注入使用同一方法。'],
  }
}

/** 降级：直接扫描核心人格目录，解析 *.md / *.txt */
async function viaFile(ctx: Context): Promise<BlockResult> {
  const dir = coreMemoryDir(ctx)
  let names: string[] = []
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith('.md') || name.endsWith('.txt'))
  } catch {
    names = []
  }
  const items: BlockItem[] = []
  for (const name of names) {
    const file = `${dir}/${name}`
    try {
      const raw = await fs.readFile(file, 'utf8')
      // 文件中可能带前端元数据头，这里仅展示文件名 + 原始内容前 3000 字，不做复杂解析
      items.push({
        title: name,
        label: name.replace(/\.(md|txt)$/i, ''),
        description: '本地文件降级读取，元数据头未解析',
        content: raw.slice(0, 3000),
        size: Buffer.byteLength(raw),
        source: 'file',
        injected: false,
      })
    } catch {
      /* 单文件读取失败跳过 */
    }
  }
  return {
    items,
    source: 'file',
    degraded: ['blocks'],
    warnings: ['以下内容为本地文件模拟，非 YesImBot 实际注入结果，仅供参考。'],
  }
}

export async function getBlocks(ctx: Context): Promise<BlockResult> {
  if (hasMemory(ctx)) {
    try {
      const blocks = ctx[Services.Memory].getMemoryBlocksForRendering()
      return await viaService(ctx, blocks)
    } catch (error) {
      return {
        items: [],
        source: 'file',
        degraded: ['blocks'],
        warnings: [`memory 服务调用失败，已降级为文件读取：${(error as Error).message}`],
      }
    }
  }
  return viaFile(ctx)
}