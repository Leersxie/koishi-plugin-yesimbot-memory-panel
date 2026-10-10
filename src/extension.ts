import { Context } from 'koishi'
import type {} from '@koishijs/plugin-console'
import { promises as fs } from 'node:fs'
import { extname, resolve } from 'node:path'
import { Services } from 'koishi-plugin-yesimbot'
import { Config } from './config'
import { MemoryPanelService } from './services/data-service'
import { getBehaviorData } from './services/behavior'
import { clampNum, qs, safeEqual } from './services/common'

/**
 * 插件主逻辑。
 *
 * 职责：
 * 1. 控制台集成 —— 照抄 koishi-plugin-iframe 的实现：ctx.console.addEntry 注入一个
 *    只放 <iframe> 的最小 Vue 壳（client/index.ts），iframe 指向本插件的 REST 静态页；
 *    prod 指向 koishi-console build 产物 dist/，无运行时构建链。
 * 2. 静态面板 —— src/public/ 下的纯 HTML/JS 静态资源，挂到 /__yesimbot-memory-panel-ui/。
 * 3. REST 取数 —— 统一前缀 /__yesimbot-memory-panel-ui/api/*，内部委托 MemoryPanelService。
 *
 * 依赖注入：console、server 必需；yesimbot.world-state、yesimbot.memory 可选（运行时守卫）。
 */

/**
 * 面板路由前缀。
 *
 * 注意：该前缀必须与控制台客户端路由（client/index.ts 里 ctx.page({ path })）错开，
 * 否则静态 catch-all 会先于控制台的 Vue 路由命中 path，导致"点入口变成整页替换、
 * 侧边栏消失"（实测踩坑，2026-10-01）。约定：
 *  - 控制台入口路由 = /yesimbot-memory-panel（client 壳）
 *  - 静态面板 + REST = /__yesimbot-memory-panel-ui（本常量），iframe 指到这里
 *  - 旧的 /yesimbot-memory-panel/ 直接访问地址保留 302 重定向，避免历史收藏失效
 */
export const PANEL_PATH = '/__yesimbot-memory-panel-ui'

/** 旧面板直链前缀（保留重定向，兼容历史收藏） */
export const PANEL_PATH_LEGACY = '/yesimbot-memory-panel'

export const name = 'yesimbot-memory-panel'

export const inject = {
  required: ['console', 'server'],
  optional: ['database', 'yesimbot.world-state', 'yesimbot.memory'],
}

export { Config }

/**
 * router 类型说明：koishi 4.18 / plugin-server 3.2.9 运行时只暴露 ctx.server
 * （@koa/router 子类实例）。plugin-server 源码里虽然调用了 ctx.alias('server', ['router'])，
 * 但 cordis 3.18 的 Context.alias 第一行有 `if (name in internal) return` 守卫，
 * 而 serve 的 constructor 是先生成 ctx.provide('server') 再 alias —— 此时 'server'
 * 已在 internal 表内，alias 直接空转返回，ctx.router 实际上从未被注册（实测确认）。
 * 因此这里统一使用 ctx.server，并按运行时实际 API 收敛成插件内最小接口，避免类型依赖漂移。
 */
interface PanelRoute {
  query: Record<string, unknown>
  params: Record<string, string | undefined>
  /** koa context.headers；用于读取清理令牌（不经 URL，避免落入访问日志/浏览器历史） */
  headers?: Record<string, unknown>
  /** 请求体（koa-body 解析结果；未挂载 body 中间件时为 undefined） */
  request?: { body?: unknown }
  body: any
  type: string
  status: number
  /** koa context 的 redirect(url)，设置 3xx + Location 头 */
  redirect(url: string): void
}

interface PanelRouter {
  get(path: string, handler: (route: PanelRoute) => void): void
  post(path: string, handler: (route: PanelRoute) => void): void
}

/**
 * 读取清理令牌。优先级：请求头 > 请求体 > query（兼容旧调用）。
 *
 * query 传参会让令牌进入访问日志、浏览器历史与 Referer，因此仅作兼容保留；
 * 命中 query 时调用方会记一条废弃告警。
 */
function readCleanupToken(route: PanelRoute): { token: string; via: 'header' | 'body' | 'query' } {
  const headers = route.headers ?? {}
  const bearer = qs(headers.authorization)
  const fromHeader = qs(headers['x-cleanup-token']) || (/^bearer\s+/i.test(bearer) ? bearer.replace(/^bearer\s+/i, '').trim() : '')
  if (fromHeader) return { token: fromHeader, via: 'header' }

  const body = route.request?.body
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).token === 'string') {
    const token = (body as Record<string, string>).token.trim()
    if (token) return { token, via: 'body' }
  }

  return { token: qs(route.query.token), via: 'query' }
}

/** 极小 MIME 表（面板只有 html/js/css/svg） */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export function apply(ctx: Context, config: Config) {
  const svc = new MemoryPanelService(ctx, config)
  // 清理属于破坏性操作，单独留一条可检索的审计日志通道（按插件名过滤）
  const logger = ctx.logger('yesimbot-memory-panel')

  // ============ 控制台入口（照抄 koishi-plugin-iframe） ============
  // dev 指向仓库内的 Vue 壳源码（koishi 控制台 dev 模式由 vite 现场编译）；
  // prod 指向 koishi-console build 的产物 dist/（随 npm 包发布，发布前执行 build:client）。
  ctx.inject(['console'], (consoleCtx) => {
    consoleCtx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })
  })

  // ============ 静态面板 + REST 路由（挂在 ctx.server 上，见顶部类型注释） ============
  // 注意：REST 路由必须比静态 catch-all（(.*)）先注册 —— koa-router 按注册顺序匹配，
  // 若静态层在前，/api/* 会被它先吞掉（实测踩坑）。
  const router = (ctx as unknown as { server?: PanelRouter }).server
  if (router) {
    const api = `${PANEL_PATH}/api`
    const publicDir = resolve(__dirname, '../src/public')

    // ---- REST 取数 ----
    router.get(`${api}/blocks`, async (route) => {
      const data = await svc.blocks()
      route.body = { ok: true, data: data.items, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/channels`, async (route) => {
      const data = await svc.channels()
      route.body = { ok: true, data }
    })
    router.get(`${api}/l1`, async (route) => {
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const limit = clampNum(route.query.limit, 1, 500, config.l1PreviewLimit)
      const data = await svc.l1(platform, channelId, limit)
      route.body = { ok: true, data: data.items, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/l2`, async (route) => {
      const text = qs(route.query.text)
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const k = clampNum(route.query.k, 1, 50, config.l2PreviewK)
      const data = await svc.l2Search(text, platform, channelId, k)
      route.body = { ok: true, data: data.items, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/l2/chunks`, async (route) => {
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const page = clampNum(route.query.page, 0, 10000, 0)
      const data = await svc.l2List(platform, channelId, page)
      route.body = { ok: true, data, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/l3/dates`, async (route) => {
      const data = await svc.l3Dates()
      route.body = { ok: true, data, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/l3`, async (route) => {
      const date = qs(route.query.date)
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const data = await svc.l3List(date, platform, channelId)
      route.body = { ok: true, data: data.items, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/overview`, async (route) => {
      const data = await svc.overview()
      route.body = { ok: true, data, degraded: data.degraded, warnings: data.warnings }
    })
    router.post(`${api}/preview`, async (route) => {
      const text = qs(route.query.text)
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const data = await svc.preview(text, platform, channelId)
      route.body = { ok: true, data, degraded: data.degraded, warnings: data.warnings }
    })
    router.post(`${api}/cleanup`, async (route) => {
      // 写接口鉴权：面板静态页与 REST 都挂在 ctx.server 上，不经过 Koishi 控制台鉴权，
      // 因此必须自带令牌校验。未配置令牌时一律拒绝（fail-closed）——
      // 旧实现“留空即跳过校验”等于默认零鉴权，任何能访问端口的人都能删数据。
      const expected = config.cleanupToken
      if (!expected) {
        logger.warn('cleanup 被拒绝：未配置 cleanupToken（写接口 fail-closed）')
        route.status = 403
        route.body = {
          ok: false,
          error: '清理接口未启用：请先在插件配置中设置 cleanupToken（该写接口不走 Koishi 鉴权，留空将拒绝所有清理请求）。',
        }
        return
      }
      const { token, via } = readCleanupToken(route)
      if (!token || !safeEqual(token, expected)) {
        logger.warn(`cleanup 被拒绝：令牌校验未通过（来源 ${via}）`)
        route.status = 403
        route.body = { ok: false, error: '清理需要访问令牌（未通过校验）。' }
        return
      }
      if (via === 'query') {
        logger.warn('cleanup 通过 query 传参令牌（已废弃）：令牌会进入访问日志与浏览器历史，请改用 x-cleanup-token 请求头')
      }
      const table = qs(route.query.table)
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const before = qs(route.query.before) || undefined
      const after = qs(route.query.after) || undefined
      const data = await svc.cleanup(table, platform, channelId, before, after)
      logger.info(
        `cleanup 执行：table=${table} platform=${platform || '*'} channel=${channelId || '*'} ` +
          `range=${after || '-'}~${before || '-'} removed=${data.removed} skipped=${data.skipped}`,
      )
      if (data.warnings.length) logger.warn(`cleanup 提示：${data.warnings.join(' | ')}`)
      route.body = { ok: true, data, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/status`, async (route) => {
      route.body = {
        ok: true,
        data: {
          worldState: !!ctx[Services.WorldState],
          memory: !!ctx[Services.Memory],
          database: !!ctx.database,
        },
      }
    })
    router.get(`${api}/behavior`, async (route) => {
      const data = await getBehaviorData(ctx)
      route.body = { ok: true, data, degraded: [], warnings: [] }
    })

    // ---- 旧路径 302 重定向（兼容历史收藏的 /yesimbot-memory-panel/ 直链） ----
    // 注意 gateway：老路径以 /yesimbot-memory-panel 开头（含子路径），统一跳回新面板根。
    // 控制台客户端路由本身是 /yesimbot-memory-panel（在 client 壳里注册），该路由在
    // 前端 history 层面处理，不会到这里；只有 iframe 直链 / 收藏链接才会命中后端。
    router.get(`${PANEL_PATH_LEGACY}/(.*)`, async (route) => {
      route.status = 302
      route.redirect(`${PANEL_PATH}/`)
    })

    // ---- 静态资源（最后注册；不依赖 Router.static，自实现带目录穿透防护的文件服务） ----
    // 无尾斜杠访问面板根地址时，直接回 index.html
    router.get(`${PANEL_PATH}`, async (route) => {
      route.type = 'text/html; charset=utf-8'
      try {
        route.body = await fs.readFile(resolve(publicDir, 'index.html'))
      } catch {
        route.status = 404
        route.body = 'Not Found'
      }
    })
    router.get(`${PANEL_PATH}/(.*)`, async (route) => {
      const rel = route.params[0] ?? 'index.html'
      if (rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) {
        route.status = 403
        route.body = 'Forbidden'
        return
      }
      const file = resolve(publicDir, rel)
      try {
        const data = await fs.readFile(file)
        route.type = MIME[extname(file)] ?? 'application/octet-stream'
        route.body = data
      } catch {
        route.status = 404
        route.body = 'Not Found'
      }
    })
  }

  // 面板路由/静态资源均为 koishi 声明式注册，插件卸载时随 ctx 自动回收，无需手动 dispose
}