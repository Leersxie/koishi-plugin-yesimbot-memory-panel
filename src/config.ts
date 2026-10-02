import { Schema } from 'koishi'

/**
 * 插件配置。
 * 面板路由固定为 /__yesimbot-memory-panel-ui（客户端 iframe 壳与静态目录都写死该路径，
 * 因此这里不再提供可配置路径，避免“壳与页面地址不一致”类问题）。
 */
export interface Config {
  /** L1 历史预览最大条数 */
  l1PreviewLimit: number
  /** L2 语义检索 Top-K */
  l2PreviewK: number
  /** 单次清理操作最多删除的行数（护栏，防误删整表） */
  cleanupMaxRows: number
  /** 清理/时间过滤使用的时区（IANA 名，默认 Asia/Shanghai）；容器为 UTC 时必须显式指定 */
  timezone: string
  /** 清理接口访问令牌：非空时 /api/cleanup 需携带 ?token= 一致才允许执行（面板静态页无鉴权，防局域网恶意调用） */
  cleanupToken: string
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
  timezone: Schema.string()
    .default('Asia/Shanghai')
    .description('清理与时间过滤使用的时区（IANA 名，如 Asia/Shanghai）；容器若为 UTC 必须显式指定，否则按容器时区计算日期边界。'),
  cleanupToken: Schema.string()
    .role('secret')
    .default('')
    .description('清理接口访问令牌：留空不启用；设置后前端清理前需输入该令牌（写接口无 Koishi 鉴权，建议内网部署时设置）。'),
})
