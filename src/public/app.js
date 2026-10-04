/**
 * YesImBot 记忆面板前端逻辑（纯 vanilla JS，无框架无构建）。
 * 所有取数统一走 /__yesimbot-memory-panel-ui/api/* 的 REST 接口。
 */
(function () {
  'use strict'

  const API = `${location.origin}/__yesimbot-memory-panel-ui/api`
  const $ = (sel) => document.querySelector(sel)

  // ---------- 通用 ----------
  function toast(msg) {
    const box = $('#toast')
    box.textContent = msg
    box.style.display = 'block'
    clearTimeout(toast._t)
    toast._t = setTimeout(() => (box.style.display = 'none'), 2600)
  }

  async function api(path, init) {
    const res = await fetch(`${API}${path}`, init)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  /** 渲染降级/提示横幅：degraded 命中或 warnings 非空时展示 */
  function banners(degraded, warnings, key) {
    const out = []
    const isKey = Array.isArray(degraded) && degraded.includes(key)
    const warns = Array.isArray(degraded) && degraded.length && !isKey ? [] : (warnings || [])
    if (isKey || (warnings && warnings.length)) {
      const list = warns.length ? warns : warnings
      for (const w of list) out.push(`<div class="banner${isKey ? ' danger' : ''}">${escapeHtml(w)}</div>`)
    }
    return out.join('')
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function fmtTime(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('zh-CN', { hour12: false })
  }

  function emptyBox(text) {
    return `<div class="empty">${escapeHtml(text)}</div>`
  }

  // ---------- 页面状态 ----------
  let channels = []
  const calState = { year: 0, month: 0 }

  // ---------- Tab 切换 ----------
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn))
      document.querySelectorAll('section.page').forEach((s) => s.classList.toggle('active', s.id === `tab-${btn.dataset.tab}`))
    })
  })

  // ---------- 状态条 & 频道填充 ----------
  async function loadChannels() {
    try {
      const r = await api('/channels')
      channels = r.data || []
      const opts = channels.map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.key)}${c.hasAgentLog ? '（有 Agent 日志）' : ''}</option>`).join('')
      for (const sel of ['#l1-channel', '#dbg-channel']) {
        const el = $(sel)
        el.innerHTML = `<option value="">（所有）</option>` + opts
      }
    } finally {
      /* 频道加载失败不影响其他功能 */
    }
    try {
      const status = await api('/status')
      const s = status.data || {}
      $('#status-line').textContent = `world-state:${s.worldState ? '🟢' : '⚪'} memory:${s.memory ? '🟢' : '⚪'} database:${s.database ? '🟢' : '⚪'}`
    } catch {
      $('#status-line').textContent = '状态不可用'
    }
  }

  // ---------- 核心人格 ----------
  async function renderBlocks() {
    const box = $('#blocks-list')
    box.innerHTML = '<div class="empty">加载中…</div>'
    try {
      const r = await api('/blocks')
      const items = r.data || []
      box.innerHTML =
        banners(r.degraded, r.warnings, 'blocks') +
        (items.length
          ? items
              .map(
                (b) => `
        <div class="card">
          <h3>${escapeHtml(b.title)} <span class="tag ${b.injected || b.source === 'service' ? 'injected' : 'file'}">${b.injected || b.source === 'service' ? '与注入一致' : '文件模拟'}</span> <span class="meta">${escapeHtml(b.label)} · ${b.size} B</span></h3>
          <div class="meta">${escapeHtml(b.description || '')}</div>
          <pre class="block">${escapeHtml(b.content)}</pre>
        </div>`,
              )
              .join('')
          : emptyBox('未读取到人格块（data/yesimbot/memory/core 为空，或 memory 服务未加载）'))
    } catch (e) {
      box.innerHTML = emptyBox(`加载失败：${e.message}`)
    }
  }

  // ---------- L1 ----------
  async function renderL1() {
    const host = $('#l1-list')
    host.innerHTML = '<div class="empty">加载中…</div>'
    const key = $('#l1-channel').value
    const [platform, channelId] = key ? key.split(':') : ['', '']
    const q = new URLSearchParams()
    if (platform) q.set('platform', platform)
    if (channelId) q.set('channelId', channelId)
    try {
      const r = await api(`/l1?${q.toString()}`)
      const items = r.data || []
      const banner = banners(r.degraded, r.warnings, 'l1')
      const bEl = $('#mem-banner')
      bEl.innerHTML = banner
      bEl.style.display = banner ? 'block' : 'none'
      host.innerHTML = items.length
        ? items
            .map(
              (e) => `
        <div class="row">
          <span class="time">${escapeHtml(fmtTime(e.timestamp))}</span>
          <span class="type">${escapeHtml(e.type)}</span>
          <span class="who">${escapeHtml(e.senderName || '')}</span>
          <span class="txt">${escapeHtml(e.text)}</span>
        </div>`,
            )
            .join('')
        : emptyBox('该频道暂无 L1 记录')
    } catch (e) {
      host.innerHTML = emptyBox(`加载失败：${e.message}`)
    }
  }

  // ---------- L2 ----------
  function l2Card(item) {
    const sim = item.similarity == null ? '' : `<span class="sim">${(item.similarity * 100).toFixed(1)}%</span>`
    return `
      <div class="row">
        <span class="time">${escapeHtml(fmtTime(item.startTimestamp))}</span>
        <span class="type">${escapeHtml(item.platform + ':' + item.channelId)}</span>
        <span class="txt">${escapeHtml(item.content)}</span>
        ${sim}
      </div>`
  }

  async function searchL2() {
    const host = $('#l2-list')
    const text = $('#l2-query').value.trim()
    const key = $('#l1-channel').value
    const [platform, channelId] = key ? key.split(':') : ['', '']
    const q = new URLSearchParams({ text })
    if (platform) q.set('platform', platform)
    if (channelId) q.set('channelId', channelId)
    host.innerHTML = '<div class="empty">检索中…</div>'
    if (!text && key) {
      /* 允许空关键词浏览全部 */
    }
    try {
      const r = await api(`/l2?${q.toString()}`)
      const items = r.data || []
      host.innerHTML =
        banners(r.degraded, r.warnings, 'l2') +
        (items.length ? items.map(l2Card).join('') : emptyBox('无 L2 检索结果'))
    } catch (e) {
      host.innerHTML = emptyBox(`检索失败：${e.message}`)
    }
  }

  async function listL2All() {
    const host = $('#l2-list')
    const key = $('#l1-channel').value
    const [platform, channelId] = key ? key.split(':') : ['', '']
    const q = new URLSearchParams({ page: '0' })
    if (platform) q.set('platform', platform)
    if (channelId) q.set('channelId', channelId)
    host.innerHTML = '<div class="empty">加载中…</div>'
    try {
      const r = await api(`/l2/chunks?${q.toString()}`)
      const data = r.data || { items: [], dim: null }
      const totalText = data.total == null || data.total < 0 ? '' : ` · 共 ${data.total} 块`
      host.innerHTML =
        banners(r.degraded, r.warnings, 'l2') +
        (data.dim != null ? `<div class="meta">向量维度：${data.dim}${totalText}</div>` : '') +
        (data.items.length ? data.items.map(l2Card).join('') : emptyBox('L2 表为空'))
    } catch (e) {
      host.innerHTML = emptyBox(`加载失败：${e.message}`)
    }
  }

  // ---------- L3 日历 ----------
  let datesSet = new Set()
  let calSelected = ''

  async function loadDates() {
    try {
      const r = await api('/l3/dates')
      datesSet = new Set((r.data && r.data.dates) || [])
      const now = new Date()
      calState.year = now.getFullYear()
      calState.month = now.getMonth()
      renderCal()
    } catch {
      datesSet = new Set()
    }
  }

  function renderCal() {
    const y = calState.year
    const m = calState.month
    $('#cal-label').textContent = `${y} 年 ${m + 1} 月`
    const first = new Date(y, m, 1)
    const days = new Date(y, m + 1, 0).getDate()
    const lead = first.getDay()
    let html = ''
    for (let i = 0; i < lead; i++) html += '<div class="cal-cell"></div>'
    for (let d = 1; d <= days; d++) {
      const pad = String(m + 1).padStart(2, '0')
      const dateStr = `${y}-${pad}-${String(d).padStart(2, '0')}`
      const has = datesSet.has(dateStr)
      html += `<div class="cal-cell ${has ? 'has' : ''} ${dateStr === calSelected ? 'hot' : ''}" data-date="${dateStr}">${has ? '●' : ''} ${d}</div>`
    }
    $('#cal-grid').innerHTML = html
    document.querySelectorAll('.cal-cell[data-date]').forEach((cell) =>
      cell.addEventListener('click', () => {
        calSelected = cell.dataset.date
        renderCal()
        renderL3(calSelected)
      }),
    )
  }

  async function renderL3(date) {
    const host = $('#l3-list')
    host.innerHTML = '<div class="empty">加载中…</div>'
    const q = new URLSearchParams()
    if (date) q.set('date', date)
    try {
      const r = await api(`/l3?${q.toString()}`)
      const items = r.data || []
      host.innerHTML =
        (date ? `<div class="meta">${escapeHtml(date)} 的日记</div>` : '') +
        banners(r.degraded, r.warnings, 'l3') +
        (items.length
          ? items
              .map(
                (it) => `
        <div class="card" style="margin-top:8px">
          <h3>${escapeHtml(it.date)} · ${escapeHtml(it.platform)}:${escapeHtml(it.channelId)}
            <span class="meta">${(it.keywords || []).map((k) => `<span class="tag">${escapeHtml(k)}</span>`).join(' ')}</span></h3>
          <pre class="block">${escapeHtml(it.content)}</pre>
        </div>`,
              )
              .join('')
          : emptyBox(date ? '当天没有日记' : '加载日期列表后点击日期查看'))
    } catch (e) {
      host.innerHTML = emptyBox(`加载失败：${e.message}`)
    }
  }

  // ---------- 记忆体检 ----------
  async function renderHealth() {
    const box = $('#health-content')
    box.innerHTML = '<div class="empty">加载中…</div>'
    try {
      const r = await api('/overview')
      const d = r.data || { tables: [], byChannel: [], l2Dim: null }
      const totalRows = d.tables.reduce((a, t) => a + (t.rows || 0), 0)
      const statCards = [
        ['总行数', totalRows],
        ['L1 消息', (d.tables.find((t) => t.name.includes('.messages')) || {}).rows ?? '—'],
        ['L2 记忆块', (d.tables.find((t) => t.name.includes('l2_chunks')) || {}).rows ?? '—'],
        ['L3 日记', (d.tables.find((t) => t.name.includes('l3_diaries')) || {}).rows ?? '—'],
        ['L2 向量维度', d.l2Dim ?? '—'],
      ]
        .map(
          ([lbl, num]) => `<div class="stat"><div class="num">${escapeHtml(String(num))}</div><div class="lbl">${escapeHtml(lbl)}</div></div>`,
        )
        .join('')
      const rows = d.byChannel
        .map(
          (c) => `<tr><td>${escapeHtml(c.key)}</td><td>${c.messages || 0}</td><td>${c.l2 || 0}</td><td>${c.l3 || 0}</td></tr>`,
        )
        .join('')
      const tablesHtml = d.tables
        .map(
          (t) => `<tr><td>${escapeHtml(t.name)}</td><td>${t.rows ?? 0}</td><td>${t.size == null ? '—' : `${(t.size / 1024).toFixed(1)} KB`}</td>${t.error ? `<td class="muted">${escapeHtml(t.error)}</td>` : '<td></td>'}</tr>`,
        )
        .join('')
      box.innerHTML =
        banners(r.degraded, r.warnings, 'overview') +
        `<div class="stat-cards">${statCards}</div>` +
        `<div class="card"><h3>表统计</h3><table class="tbl"><tr><th>表</th><th>行数</th><th>大小</th><th>备注</th></tr>${tablesHtml}</table></div>` +
        `<div class="card" style="margin-top:12px"><h3>按频道分布</h3><table class="tbl"><tr><th>频道</th><th>L1</th><th>L2</th><th>L3</th></tr>${rows || '<tr><td colspan="4" class="muted">暂无数据</td></tr>'}</table></div>` +
        `<div class="card" style="margin-top:12px"><h3>选期清理（只读为主，删除需二次确认）</h3>
          <div class="toolbar">
            <select id="clean-table"><option value="l2_chunks">L2 记忆块</option><option value="l3_diaries">L3 日记</option><option value="messages">L1 消息</option></select>
            <input id="clean-channel" placeholder="频道 key，如 platform:channelId（留空=全部）" style="min-width:220px" />
            <input id="clean-after" type="date" placeholder="开始日期" /> 到
            <input id="clean-before" type="date" placeholder="结束日期（L3 按日期，其余按时间戳）" />
            <button class="act danger" id="btn-clean">清理</button>
          </div></div>`
      // 清理事件
      $('#btn-clean').addEventListener('click', doCleanup)
    } catch (e) {
      box.innerHTML = emptyBox(`加载失败：${e.message}`)
    }
  }

  async function doCleanup() {
    const table = $('#clean-table').value
    const channel = $('#clean-channel').value.trim()
    const after = $('#clean-after').value
    const before = $('#clean-before').value
    const [platform, channelId] = channel ? channel.split(':') : ['', '']
    const desc = `${table} ${channel || '全部频道'} ${after || '不限'}~${before || '不限'}`
    if (!confirm(`确认删除以下范围的数据？\n\n${desc}\n\n此操作不可撤销，且单次受护栏限制（默认最多 500 行）。`)) return
    try {
      const token = prompt('请输入清理访问令牌（在插件配置中设置 cleanupToken）：') || ''
      const q2 = new URLSearchParams({ table })
      if (platform) q2.set('platform', platform)
      if (channelId) q2.set('channelId', channelId)
      if (before) q2.set('before', before)
      if (after) q2.set('after', after)
      if (token) q2.set('token', token)
      const r = await api(`/cleanup?${q2.toString()}`, { method: 'POST' })
      if (r.ok === false) {
        toast(r.error || '清理未授权或失败')
        return
      }
      const d = r.data || { removed: 0 }
      toast(`已删除 ${d.removed} 行，跳过 ${d.skipped || 0} 行（护栏限制）。`)
      renderHealth()
    } catch (e) {
      toast(`清理失败：${e.message}`)
    }
  }

  // ---------- 注入联调 ----------
  async function runDebug() {
    const host = $('#dbg-result')
    const text = $('#dbg-text').value.trim()
    const key = $('#dbg-channel').value
    const [platform, channelId] = key ? key.split(':') : ['', '']
    const q = new URLSearchParams({ text })
    if (platform) q.set('platform', platform)
    if (channelId) q.set('channelId', channelId)
    host.innerHTML = '<div class="empty">计算中…</div>'
    try {
      const r = await api(`/preview?${q.toString()}`, { method: 'POST' })
      const d = r.data || { parts: {}, degraded: [], warnings: [] }
      const render = (part, title) => {
        if (!part) return ''
        const items = part.items || []
        if (title === 'L2 片段') {
          return `<div class="card"><h3>${title} <span class="tag">${part.source}</span> <span class="tag">${part.count} 条</span></h3>${
            items.length ? items.map(l2Card).join('') : '<div class="empty">无</div>'
          }</div>`
        }
        if (title === 'L1 上下文') {
          return `<div class="card"><h3>${title} <span class="tag">${part.source}</span> <span class="tag">${part.count} 条</span></h3>${
            items.length
              ? items
                  .map(
                    (e) => `<div class="row"><span class="time">${escapeHtml(fmtTime(e.timestamp))}</span><span class="type">${escapeHtml(e.type)}</span><span class="who">${escapeHtml(e.senderName || '')}</span><span class="txt">${escapeHtml(e.text)}</span></div>`,
                  )
                  .join('')
              : '<div class="empty">无</div>'
          }</div>`
        }
        return `<div class="card blocks-card"><h3>${title} <span class="tag">${part.source}</span> <span class="tag">${part.count} 块</span></h3>${
          items.length
            ? items
                .map(
                  (b) => `<div class="row"><span class="type">${escapeHtml(b.label || b.title)}</span><span class="txt">${escapeHtml(b.content.slice(0, 300))}</span></div>`,
                )
                .join('')
            : '<div class="empty">无</div>'
        }</div>`
      }
      host.innerHTML =
        (d.simulated ? '<div class="banner danger">以下内容为本地模拟组合，非 YesImBot 实际注入结果，仅供参考。</div>' : '') +
        (d.warnings && d.warnings.length ? d.warnings.map((w) => `<div class="banner">${escapeHtml(w)}</div>`).join('') : '') +
        `<div class="preview-grid">${render(d.parts.l2, 'L2 片段')}${render(d.parts.l1, 'L1 上下文')}${render(d.parts.blocks, '人格块')}</div>`
    } catch (e) {
      host.innerHTML = emptyBox(`联调失败：${e.message}`)
    }
  }

  // ---------- 行为学习 ----------
  async function renderBehavior() {
    const box = $('#behavior-content')
    box.innerHTML = '<div class="empty">加载中…</div>'
    try {
      const r = await api('/behavior')
      const d = r.data || { behaviorRaw: '', candidates: [], round: 0, stats: null }
      const parts = []

      // 统计摘要
      const st = d.stats
      if (st) {
        const adoptRate = st.adopted + st.skipped > 0 ? Math.round((st.adopted / (st.adopted + st.skipped)) * 100) : 0
        parts.push(`
          <div class="stat-cards">
            <div class="stat"><div class="num">${escapeHtml(st.totalRounds)}</div><div class="lbl">提炼轮次</div></div>
            <div class="stat"><div class="num">${escapeHtml(st.totalCandidates)}</div><div class="lbl">累计候选</div></div>
            <div class="stat"><div class="num">${escapeHtml(st.adopted)}</div><div class="lbl">已采纳</div></div>
            <div class="stat"><div class="num">${escapeHtml(st.skipped)}</div><div class="lbl">已跳过</div></div>
            <div class="stat"><div class="num">${adoptRate}%</div><div class="lbl">采纳率</div></div>
          </div>`)
        const cats = Object.entries(st.byCategory || {}).sort((a, b) => b[1].total - a[1].total)
        if (cats.length) {
          parts.push(
            `<div class="card"><h3>分类采纳率</h3><table class="tbl"><tr><th>分类</th><th>候选</th><th>采纳</th><th>跳过</th><th>采纳率</th></tr>` +
              cats
                .map(([cat, c]) => {
                  const rate = c.adopted + c.skipped > 0 ? Math.round((c.adopted / (c.adopted + c.skipped)) * 100) : 0
                  return `<tr><td>${escapeHtml(cat)}</td><td>${c.total}</td><td>${c.adopted}</td><td>${c.skipped}</td><td>${rate}%</td></tr>`
                })
                .join('') +
              `</table></div>`,
          )
        }
      }

      // 待确认候选
      const cands = d.candidates || []
      parts.push(
        `<div class="card"><h3>待确认候选 <span class="tag">第 ${escapeHtml(String(d.round || 0))} 轮 · ${cands.length} 条</span></h3>` +
          (cands.length
            ? cands
                .map(
                  (c) => `
            <div class="row">
              <span class="type">${escapeHtml(c.id)} [${escapeHtml(c.category)}]</span>
              <span class="txt">${escapeHtml(c.text)}</span>
            </div>
            <div class="row">
              <span class="time">${escapeHtml(c.time)}</span>
              <span class="txt">原文：${escapeHtml(c.evidence)}</span>
              <span class="type">置信度 ${Number(c.confidence || 0).toFixed(2)} · ${escapeHtml(c.channelCid)}</span>
            </div>`,
                )
                .join('')
            : emptyBox('当前没有待确认候选（自动提炼后推送确认，或发送「行为 立即」手动触发）')),
      )

      // behavior.md
      parts.push(
        `<div class="card"><h3>行为文档（behavior.md）</h3>` +
          (d.behaviorRaw
            ? `<pre class="block">${escapeHtml(d.behaviorRaw)}</pre>`
            : emptyBox('behavior.md 不存在或内容为空')) +
          `</div>`,
      )

      box.innerHTML = parts.join('')
    } catch (e) {
      box.innerHTML = emptyBox(`加载失败：${e.message}`)
    }
  }

  // ---------- 事件绑定 & 启动 ----------
  $('#refresh-l1').addEventListener('click', renderL1)
  // L1 频道切换即自动加载（无需再点刷新按钮）
  $('#l1-channel').addEventListener('change', renderL1)
  $('#btn-l2').addEventListener('click', searchL2)
  $('#l2-query').addEventListener('keydown', (e) => e.key === 'Enter' && searchL2())
  $('#btn-l2-list').addEventListener('click', listL2All)
  $('#btn-debug').addEventListener('click', runDebug)
  $('#dbg-text').addEventListener('keydown', (e) => e.key === 'Enter' && runDebug())
  $('#refresh-behavior').addEventListener('click', renderBehavior)
  $('#cal-prev').addEventListener('click', () => {
    calState.month--
    if (calState.month < 0) {
      calState.month = 11
      calState.year--
    }
    renderCal()
  })
  $('#cal-next').addEventListener('click', () => {
    calState.month++
    if (calState.month > 11) {
      calState.month = 0
      calState.year++
    }
    renderCal()
  })

  loadChannels().then(() => {
    renderBlocks()
    renderL1()
    renderHealth()
    loadDates().then(() => renderL3())
    renderBehavior()
  })
})()