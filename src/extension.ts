import type { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import { extname, resolve } from 'node:path'
import { Services } from 'koishi-plugin-yesimbot'
import { Config } from './config'
import { MemoryPanelService } from './services/data-service'
import { getBehaviorData } from './services/behavior'
import { qs, onum } from './services/common'

export const PANEL_PATH = '/__yesimbot-memory-panel-ui'
export const PANEL_PATH_LEGACY = '/yesimbot-memory-panel'
export const name = 'yesimbot-memory-panel'

export const inject = {
  required: ['console', 'server'],
  optional: ['database', 'yesimbot.world-state', 'yesimbot.memory'],
}

export { Config }

interface PanelRoute {
  query: Record<string, unknown>
  params: Record<string, string | undefined>
  body: any
  type: string
  status: number
  redirect(url: string): void
}

interface PanelRouter {
  get(path: string, handler: (route: PanelRoute) => void): void
  post(path: string, handler: (route: PanelRoute) => void): void
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export function apply(ctx: Context, config: Config) {
  const svc = new MemoryPanelService(ctx, config)

  ctx.inject(['console'], (consoleCtx) => {
    consoleCtx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })
  })

  const router = (ctx as unknown as { server?: PanelRouter }).server
  if (router) {
    const api = `${PANEL_PATH}/api`
    const publicDir = resolve(__dirname, '../src/public')
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
      const limit = onum(route.query.limit, config.l1PreviewLimit)
      const data = await svc.l1(platform, channelId, limit)
      route.body = { ok: true, data: data.items, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/l2`, async (route) => {
      const text = qs(route.query.text)
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const k = onum(route.query.k, config.l2PreviewK)
      const data = await svc.l2Search(text, platform, channelId, k)
      route.body = { ok: true, data: data.items, degraded: data.degraded, warnings: data.warnings }
    })
    router.get(`${api}/l2/chunks`, async (route) => {
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const page = Math.max(0, onum(route.query.page, 0))
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
      if (config.cleanupToken) {
        const token = qs(route.query.token)
        if (!token || token !== config.cleanupToken) {
          route.status = 403
          route.body = { ok: false, error: '清理需要访问令牌 token（未通过校验）' }
          return
        }
      }
      const table = qs(route.query.table)
      const platform = qs(route.query.platform)
      const channelId = qs(route.query.channelId)
      const before = qs(route.query.before) || undefined
      const after = qs(route.query.after) || undefined
      const data = await svc.cleanup(table, platform, channelId, before, after)
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
    router.get(`${PANEL_PATH_LEGACY}/(.*)`, async (route) => {
      route.status = 302
      route.redirect(`${PANEL_PATH}/`)
    })
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
}
