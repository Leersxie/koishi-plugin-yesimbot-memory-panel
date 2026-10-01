/**
 * REST 接口冒烟测试：逐个请求面板接口并打印状态码与关键字段。
 * 零依赖，node 22 内置 fetch。
 */
const BASE = process.env.PANEL_BASE || 'http://127.0.0.1:5141/__yesimbot-memory-panel-ui'

function brief(j) {
  if (!j || typeof j !== 'object') return String(j).slice(0, 120)
  const out = { ok: j.ok, degraded: j.degraded, warnings: j.warnings }
  const d = j.data
  if (Array.isArray(d)) out.data = `Array(${d.length})`
  else if (d && typeof d === 'object' && Object.keys(d).length) out.data = `Object[${Object.keys(d).join(',')}]`
  else out.data = d
  return JSON.stringify(out)
}

async function req(desc, method, url) {
  try {
    const res = await fetch(BASE + url, { method })
    const text = await res.text()
    let j = null
    try { j = JSON.parse(text) } catch { /* 非 JSON（静态页/错误页） */ }
    console.log(`\n== ${desc}\n   ${method} ${url}`)
    console.log('   HTTP', res.status, '| type:', res.headers.get('content-type'))
    console.log('   ', j ? brief(j) : text.slice(0, 160).replace(/\s+/g, ' '))
  } catch (e) {
    console.log(`\n== ${desc} ERR ${e.message}`)
  }
}

async function main() {
  for (let i = 0; i < 20; i++) {
    try { await fetch(BASE + '/api/status'); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }

  await req('静态页(根)', 'GET', '/')
  await req('静态 app.js', 'GET', '/app.js')
  await req('目录穿越探测', 'GET', '/..%2flib%2findex.js')

  await req('status 服务状态', 'GET', '/api/status')
  await req('overview 体检总览', 'GET', '/api/overview')
  await req('blocks 人格块', 'GET', '/api/blocks')
  await req('channels 频道列表', 'GET', '/api/channels')
  await req('l1 无参', 'GET', '/api/l1')
  await req('l1 带频道', 'GET', '/api/l1?platform=onebot&channelId=test')
  await req('l2 检索(你是谁)', 'GET', '/api/l2?text=' + encodeURIComponent('你是谁') + '&platform=onebot&channelId=test')
  await req('l2 列表', 'GET', '/api/l2/chunks?page=0')
  await req('l3 dates', 'GET', '/api/l3/dates')
  await req('l3 指定日期', 'GET', '/api/l3?date=2026-10-01')
  await req('preview 注入联调', 'POST', '/api/preview?text=' + encodeURIComponent('1+1等于几') + '&platform=onebot&channelId=test')
  await req('cleanup 清理(无参)', 'POST', '/api/cleanup')
  process.exit(0)
}

main()
