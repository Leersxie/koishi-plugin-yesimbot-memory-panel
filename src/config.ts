import { Schema } from 'koishi'

export interface Config {
  l1PreviewLimit: number
  l2PreviewK: number
  cleanupMaxRows: number
}

export const Config: Schema<Config> = Schema.object({
  l1PreviewLimit: Schema.number()
    .default(80)
    .description('L1 历史预览最大条数（仅影响面板展示，不影响 YesImBot 实际注入）。'),
  l2PreviewK: Schema.number()
    .default(5)
    .description('L2 语义检索 Top-K（与 l2_memory.retrievalK 无强制关系，仅面板联调用）。'),
  cleanupMaxRows: Schema.number()
    .default(500)
    .description('记忆体检中单次清理操作最多删除的行数（护栏）。'),
})
