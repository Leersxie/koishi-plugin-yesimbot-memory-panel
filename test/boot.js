/**
 * 本地实测启动脚本（仅本地联调用，不随包发布）。
 *
 * 启动一个最小 Koishi 实例：plugin-server（提供 ctx.router）+ console（面板 required）
 * + 记忆面板（已编译产物 lib/）。
 *
 * 运行方式（本机无 PATH 上的 node）：
 *   & "D:\PS\Adobe Photoshop 2025\Adobe Photoshop 2026\node.exe" test/boot.js
 *
 * baseDir 指向 test/.app，便于在零污染的前提下验证"本地文件模拟"降级路径
 * （对应数据目录：<baseDir>/data/yesimbot/...）。
 */
const path = require('node:path')
const { App } = require('koishi')

/** CJS require 到的插件往往是 { default: ... } 命名空间，归一化取 .default */
const norm = (m) => (m && typeof m === 'object' && 'default' in m ? m.default : m)

const app = new App({
  // 注意：koishi 4 的 App 构造参数不消费 baseDir（实测用 process.cwd()），需实例化后再赋值
  logger: { level: 3 },
})
app.baseDir = path.resolve(__dirname, '.app')

async function main() {
  app.plugin(norm(require('@koishijs/plugin-server')), { host: '127.0.0.1', port: 5141 })

  // 面板声明了 required: ['console']，必须先加载 console 服务插件
  app.plugin(norm(require('@koishijs/plugin-console')), {})

  // 加载已编译产物 lib/index.js（导出 { name, inject, Config, apply }）
  app.plugin(norm(require('../lib/index.js')), { l1PreviewLimit: 30, l2PreviewK: 5 })

  // 临时探针：确认 ctx.server / baseDir 与后续注册路由能否被命中
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
