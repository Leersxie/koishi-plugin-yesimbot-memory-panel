import type { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import { Services } from 'koishi-plugin-yesimbot'
import { coreMemoryDir, hasMemory } from './common'
import type { MemoryBlockData } from 'koishi-plugin-yesimbot'

export interface BlockItem {
  title: string
  label: string
  description: string
  content: string
  size: number
  source: 'service' | 'file'
  injected: boolean
}

export interface BlockResult {
  items: BlockItem[]
  source: 'service' | 'file'
  degraded: string[]
  warnings: string[]
}

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
