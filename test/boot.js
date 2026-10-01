/**
 * 本地实测启动脚本（仅本地联调用，不随包发布）。
 * baseDir 指向 test/.app，便于在零污染的前提下验证"本地文件模拟"降级路径。
 */
const path = require('node:path')
const { App } = require('koishi')

const norm = (m) => (m && typeof m === 'object' && 'default' in m ? m.default : m)

const app = new App({
  logger: { level: 3 },
})
app.baseDir = path.resolve(__dirname, '.app')

async function main() {
  app.plugin(norm(require('@koishijs/plugin-server')), { host: '127.0.0.1', port: 5141 })
  app.plugin(norm(require('@koishijs/plugin-console')), {})
  app.plugin(norm(require('../lib/index.js')), { l1PreviewLimit: 30, l2PreviewK: 5 })

  app.plugin((ctx) => {
    ctx.logger.info('[PANEL-PROBE] server exists = %o, router = %o, baseDir = %s', !!ctx.server, !!ctx.router, ctx.baseDir)
    const r = ctx.server
    if (r) r.get('/__probe', (route) => { route.body = { ok: true, probe: 1 } })
  }, {})

  await app.start()
  console.log('[BOOT-OK] http://127.0.0.1:5141/__yesimbot-memory-panel-ui/')
}

main().catch((error) => {
  console.error('[BOOT-FAIL]', error)
  process.exit(1)
})
