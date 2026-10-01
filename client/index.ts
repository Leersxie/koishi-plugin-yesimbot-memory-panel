import { Context } from '@koishijs/client'
import { defineComponent, h, resolveComponent } from 'vue'

/**
 * 控制台 iframe 壳 —— 照抄 koishi-plugin-iframe 的最小实现。
 *
 * 只做一件事：注册一个控制台页面，页面主体是一个撑满的 <iframe>，
 * 指向本插件用 ctx.server 提供的静态面板（/__yesimbot-memory-panel-ui/）。
 * 面板的全部 UI 与取数都在纯 HTML/JS 里完成，本文件不参与任何面板逻辑。
 *
 * 注意（路径约定）：本页面路由为 /yesimbot-memory-panel，静态面板挂载在
 * /__yesimbot-memory-panel-ui/ —— 两者故意错开，避免静态 catch-all 抢占
 * 控制台 Vue 路由导致"整页替换、侧边栏消失"。
 */
export default function (ctx: Context) {
  ctx.page({
    path: '/yesimbot-memory-panel',
    name: 'YesImBot 记忆',
    desc: '人格 / 三级记忆 / 体检 / 注入联调',
    component: defineComponent({
      setup() {
        return () =>
          h(
            resolveComponent('k-layout'),
            {},
            {
              default: () =>
                h('iframe', {
                  src: `${location.origin}/__yesimbot-memory-panel-ui/`,
                  style: { width: '100%', height: '100%', border: 'none' },
                }),
            },
          )
      },
    }),
  })
}
