/**
 * dsh-puppet-memory — 设置页（Client 半边）。
 *
 * 以 dsh.client bundle 格式加载（与 dsh-meme 同款）。注册两个独立的设置页：
 *   settings.section#puppet-backup（order 26，label「记忆备份」）
 *     → 备份策略 / 当前状态 / 上下文压缩 / 待确认事实；按钮放页面顶部
 *   settings.section#puppet-autosummary（order 27，label「自动摘要」）
 *     → 自动摘要设置 + 摘要列表；按钮放页面顶部
 * settings.section 是 list slot（一个条目一页），所以拆页不需要任何壳层改动。
 *
 * 数据走宿主的本机回环 HTTP API：/dsh-puppet-memory-api
 *   GET  ?action=status           → 配置 + 运行态 + 快照统计（含压缩记录）
 *   GET  ?action=autosummaries    → 自动摘要列表
 *   GET  ?action=autosummary      → 自动摘要设置
 *   GET  ?action=fact-candidates  → 待确认事实
 *   POST ?action=save             → 保存备份策略（宿主逐项校验）
 *   POST ?action=save-autosummary → 保存自动摘要设置
 *   POST ?action=backup           → 立即备份一次（force）
 *   POST ?action=delete-autosummary / accept-fact / reject-fact
 *
 * 注册 id 必须等于 loader entry 名（dsh-puppet-memory），否则 ModuleLoader 报
 * "loaded without registering dsh-puppet-memory"。
 */
window.__ModuleLoader__.load({
  id: 'dsh-puppet-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const API = '/dsh-puppet-memory-api'

    // 宿主自带的菜单行/图标原语：侧栏「更多」里要长得像原生行就得用它
    let primitives = null
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch (err) { primitives = null }

    const CSS = [
      '.pmb{display:flex;flex-direction:column;gap:16px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.pmb-sub{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.pmb-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}',
      '.pmb-title{font-size:13px;font-weight:600}',
      '.pmb-head{display:flex;flex-direction:column;gap:4px}',
      '.pmb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}',
      '.pmb-kv{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.pmb-k{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.pmb-v{font-size:13px;word-break:break-all}',
      '.pmb-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.pmb-row-label{min-width:132px;color:var(--dsw-alias-label-secondary)}',
      '.pmb-input{width:96px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.pmb-input-wide{width:min(100%,380px)}',
      '.pmb-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px}',
      '.pmb-btn:disabled{opacity:.5;cursor:default}',
      '.pmb-btn-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.pmb-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.pmb-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.pmb-note{font-size:12px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.pmb-err{font-size:12px;padding:8px 10px;border-radius:8px;color:#b42318;background:rgba(180,35,24,.08)}',
      '.pmb-ok{font-size:12px;padding:8px 10px;border-radius:8px;color:#067647;background:rgba(6,118,71,.08)}',
      '.pmb-warn{font-size:12px;padding:8px 10px;border-radius:8px;color:#b54708;background:rgba(181,71,8,.08)}',
      '.pmb-check{display:flex;align-items:center;gap:6px;cursor:pointer}',
      '.pmb-list{display:flex;flex-direction:column;gap:8px}',
      '.pmb-item{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-base)}',
      '.pmb-item-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.pmb-tag{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.pmb-item-text{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:110px;overflow:auto}',
      '.pmb-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:sticky;top:0;z-index:1;padding:8px 0;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pmb-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.pmb-search{width:min(100%,240px);padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.pmb-item-text.pmb-open{max-height:none}',
      '.pmb-btn-danger{border-color:#b42318;color:#b42318}',
      // 主面板页（main slot 里的面板要自己负责 100% 高度、滚动和内边距）
      '.pmb-page{box-sizing:border-box;height:100%;overflow:auto;padding:28px clamp(20px,4vw,48px) 48px;color:var(--dsw-alias-label-primary)}',
      '.pmb-page-inner{width:100%;max-width:960px;margin:0 auto}',
      '.pmb-tag-warn{background:rgba(181,71,8,.12);color:#b54708}',
      '.pmb-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      // 分组 + 一行一件事：左边标题/说明，右边控件（跟宿主自带设置页同一个排版语言）
      '.pmb-sec{display:flex;flex-direction:column;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:6px 14px 10px;background:var(--dsw-alias-bg-layer-1)}',
      '.pmb-sec-h{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:8px 0 6px;letter-spacing:.3px}',
      '.pmb-sec-h-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.pmb-line{display:flex;align-items:flex-start;gap:16px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.pmb-line:first-of-type{border-top:0}',
      '.pmb-line-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.pmb-line-label{font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.pmb-line-note{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}',
      '.pmb-line-ctl{flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:60%}',
      // 按天折叠：每天一行标题，点开才展开当天条目
      '.pmb-day{display:flex;flex-direction:column;gap:6px}',
      '.pmb-day-head{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;user-select:none}',
      '.pmb-day-head:hover{filter:brightness(1.04)}',
      '.pmb-day-arrow{font-size:11px;color:var(--dsw-alias-label-secondary);width:10px}',
      '.pmb-day-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.pmb-day-body{display:flex;flex-direction:column;gap:8px;padding:2px 0 4px 10px;border-left:2px solid var(--dsw-alias-border-l1);margin-left:6px}',
    ].join('\n')

    function fmtLocal(iso) {
      if (!iso) return '还没备份过'
      const t = typeof iso === 'number' ? iso : Date.parse(iso)
      if (!Number.isFinite(t) || t <= 0) return String(iso)
      try {
        return new Date(t).toLocaleString('zh-CN', { hour12: false })
      } catch {
        return String(iso)
      }
    }

    function reasonLabel(reason) {
      if (reason === 'compaction') return '压缩后'
      if (reason === 'session-end') return '会话结束'
      if (reason === 'manual') return '手动'
      return reason || '未知'
    }

    // 「多久以前」：面板里只看绝对时间判断不了新鲜度，尤其是一屏 100 条的时候
    function relTime(iso) {
      if (!iso) return ''
      const t = typeof iso === 'number' ? iso : Date.parse(iso)
      if (!Number.isFinite(t) || t <= 0) return ''
      const diff = Date.now() - t
      if (diff < 0) return '刚刚'
      if (diff < 60e3) return '刚刚'
      if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前'
      if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前'
      return Math.floor(diff / 86400e3) + ' 天前'
    }

    // 整块屏蔽的键名换成中文，别让人对着 core/state 猜
    const BLOCK_LABELS = { core: '核心卡', state: '三线状态', social: '社交记忆', persona: '人设' }
    function blockLabel(key) {
      const k = String(key || '')
      return BLOCK_LABELS[k] ? BLOCK_LABELS[k] + '（' + k + '）' : k
    }

    // query 必须单独传：以前把 `&session=…` 拼进 action，会被 encodeURIComponent 编成
    // %26session%3D…，服务端拿到的 action 不再是纯动作名 —— 翻页和切会话都会 404。
    async function callApi(action, payload, query) {
      let url = API + '?action=' + encodeURIComponent(action)
      if (query && typeof query === 'object') {
        for (const [k, v] of Object.entries(query)) {
          if (v === undefined || v === null || v === '') continue
          url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(String(v))
        }
      }
      const init = payload === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      let res
      try {
        res = await fetch(url, init)
      } catch (err) {
        return { ok: false, error: '连不上宿主接口（' + (err && err.message ? err.message : err) + '）' }
      }
      let data
      try {
        data = await res.json()
      } catch {
        return { ok: false, error: '接口返回的不是 JSON（HTTP ' + res.status + '）' }
      }
      if (!res.ok && (!data || data.ok !== false)) {
        return { ...(data || {}), ok: false, error: (data && data.error) || 'HTTP ' + res.status }
      }
      return data
    }

    function formFromConfig(config) {
      const c = config || {}
      return {
        enabled: c.enabled !== false,
        minIntervalHours: Number(c.minIntervalHours) || 0,
        keepDays: Number(c.keepDays) || 30,
        behavior: c.behavior !== false,
        configFile: c.configFile !== false,
        sessions: c.sessions !== false,
        dir: typeof c.dir === 'string' ? c.dir : '',
        workEnabled: c.workEnabled === true,
        workDir: typeof c.workDir === 'string' ? c.workDir : '',
        workKeepArchives: Number(c.workKeepArchives) || 10,
        workMaxGB: Math.round((Number(c.workMaxBytes) || 20 * 1024 ** 3) / 1024 ** 3),
      }
    }

    function Row(props) {
      return h('div', { className: 'pmb-row' }, h('div', { className: 'pmb-row-label' }, props.label), props.children)
    }

    function Check(props) {
      return h(
        'label',
        { className: 'pmb-check' },
        h('input', {
          type: 'checkbox',
          checked: !!props.checked,
          disabled: !!props.disabled,
          onChange: (ev) => props.onChange(ev.target.checked),
        }),
        h('span', null, props.text),
      )
    }

    function NOTE(props) {
      return h('div', { className: 'pmb-note' }, props.children)
    }

    // 页面顶部的操作条（粘在顶部，不用滚到底才找到按钮）
    function Actions(props) {
      return h('div', { className: 'pmb-actions' }, props.children)
    }

    // ---------------------------------------------------------------
    // 页 1：自动摘要（独立设置页）
    // ---------------------------------------------------------------
    // v1.1（2026-11-16）：一页四面——功能 / 备份 / 摘要 / 会话。以前是四个独立设置页，太多。
    // 记忆设置（总览）：从值班台搬过来，并把三张卡的账列全
    function OverviewPanel() {
      const { useState, useEffect, useCallback } = React
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      // 注意：hooks 必须在任何 early return 之前——放下面会让首次渲染和后续渲染的 hook 数量不一致，整页白屏
      const [editing, setEditing] = useState(null)
      const [editDraft, setEditDraft] = useState({ label: '', date: '', lunar: '', note: '' })
      const [showAllOpening, setShowAllOpening] = useState(false)

      const load = useCallback(async () => {
        setError('')
        try {
          const res = await callApi('overview')
          if (!res || res.ok !== true) throw new Error((res && res.error) || '读取失败')
          setData(res)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      if (error) return h('div', { className: 'pmb' }, h('div', { className: 'pmb-error' }, error))
      if (!data) return h('div', { className: 'pmb' }, h('div', { className: 'pmb-hint' }, '读取中…'))

      const startEdit = (i, r) => {
        setEditing(i)
        setEditDraft({ label: r.label || '', date: r.date || '', lunar: r.lunar || '', note: r.note || '' })
      }
      const saveOpening = async (i) => {
        const res = await callApi('opening-update', { index: i, ...editDraft })
        if (res && res.ok === true) { setEditing(null); setData(res) } else { setError((res && res.error) || '保存失败') }
      }
      const removeOpening = async (i) => {
        if (typeof window !== 'undefined' && !window.confirm('删除这条？删了就没了。')) return
        const res = await callApi('opening-delete', { index: i })
        if (res && res.ok === true) setData(res); else setError((res && res.error) || '删除失败')
      }
      const cards = data.cards || []
      const counts = data.counts || {}
      const backup = data.backup || {}
      // v0.47.0：用户侧切换人设提示模式；鼓励词不在这里写（由低频的「扮演总结」覆盖）
      const setPersonaMode = async (mode) => {
        const res = await callApi('persona-hint-set', { mode })
        if (res && res.ok === true) setData({ ...data, personaHint: res.personaHint })
        else setError((res && res.error) || '切换失败')
      }
      return h('div', { className: 'pmb' },
        h('div', { className: 'pmb-title' }, '记忆'),
        h('div', { className: 'pmb-hint' }, '这台机器上的记忆现在长什么样。三张常驻卡的额度、各层条目数、压缩与备份的状态都在这儿。'),
        h('div', { className: 'pmb-card' },
          h('div', { className: 'pmb-title' }, '常驻卡'),
          h('div', { className: 'pmb-grid' },
            cards.map((c) => h('div', { key: c.id, className: 'pmb-kv' },
              h('div', { className: 'pmb-k' }, c.label),
              h('div', { className: 'pmb-v' }, c.chars + ' / ' + c.budget + ' 字'),
            )),
          ),
        ),
        (() => {
          // v0.47.0：只读展示当前用哪种人设提示；模式切换由 AI 侧决定（config.personaHint.mode）
          const ph = data.personaHint
          const modeRow = h(Row, { label: '切换' }, h('div', { className: 'pmb-actions' },
            ['off', 'on'].map((m) => h('button', {
              key: m, type: 'button',
              className: (ph && ph.mode === m) ? 'pmb-btn pmb-btn-on' : 'pmb-btn',
              onClick: () => setPersonaMode(m),
            }, m === 'off' ? '关闭' : '开')),
          ))
          // 2026-11-22 丹阳定：这里只留必要一句，删掉重复的解释（机制细节看代码注释）
          const explain = h('div', { className: 'pmb-hint' },
            '跟记忆内容无关，默认开；切换立刻生效。',
            h('div', null, '· 关闭：一个字不加。'),
            h('div', null, '· 开：鼓励词每轮都给；数字 100/100 只在首轮和每 25 轮。'),
          )
          if (!ph || ph.mode === 'off') return h('div', { className: 'pmb-card' },
            h('div', { className: 'pmb-title' }, '人设提示'),
            h('div', { className: 'pmb-hint' }, '现在是关闭：不注入任何提示。'),
            modeRow,
            explain,
          )
          const label = '数字锚定'
          return h('div', { className: 'pmb-card' },
            h('div', { className: 'pmb-title' }, '人设提示'),
            h(Row, { label: '方式' }, h('div', null, label + '（首轮 + 每 25 轮一行）')),
            h(Row, { label: '状态' }, h('div', null, ph.lastIntegrity === 'missing-or-clipped' ? '上次体检不完整，已重载过' : '正常（卡在场）')),
            h(Row, { label: '鼓励词' }, h('div', null, ph.hasEncourage ? '有（每轮都给；换方向时覆盖）' : '还没写（只给数字）')),
            h(Row, { label: '切换' }, h('div', { className: 'pmb-actions' },
              ['off', 'on'].map((m) => h('button', {
                key: m, type: 'button',
                className: m === ph.mode ? 'pmb-btn pmb-btn-on' : 'pmb-btn',
                onClick: () => setPersonaMode(m),
              }, m === 'off' ? '关闭' : '开')),
            )),
            explain,
          )
        })(),
        (function () {
          const sp = data.sessionPool || { enabled: true, recentDays: 7 }
          const setPool = async (enabled) => {
            const res = await callApi('session-pool-set', { enabled })
            if (res && res.ok === true) setData({ ...data, sessionPool: res.sessionPool })
            else setError((res && res.error) || '保存失败')
          }
          return h('div', { className: 'pmb-card' },
            h('div', { className: 'pmb-title' }, '会话候选池'),
            h(Row, { label: '状态' }, h('div', null, sp.enabled ? '开（只收最近 ' + sp.recentDays + ' 天）' : '关（读会话不再摘候选）')),
            h(Row, { label: '切换' }, h('div', { className: 'pmb-actions' },
              h('button', { type: 'button', className: sp.enabled ? 'pmb-btn' : 'pmb-btn pmb-btn-on', onClick: () => setPool(false) }, '关'),
              h('button', { type: 'button', className: sp.enabled ? 'pmb-btn pmb-btn-on' : 'pmb-btn', onClick: () => setPool(true) }, '开'),
            )),
            h('div', { className: 'pmb-hint' }, '读会话时顺手摘出的候选，攒着等确认；关掉只是不再摘，已有的不会删。'),
          )
        })(),
        h('div', { className: 'pmb-card' },
          h('div', { className: 'pmb-title' }, '条目'),
          h('div', { className: 'pmb-grid' },
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '关系'), h('div', { className: 'pmb-v' }, String(counts.relations || 0))),
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '用户档案'), h('div', { className: 'pmb-v' }, String(counts.user || 0))),
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '便签'), h('div', { className: 'pmb-v' }, String(counts.memo || 0))),
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '笔记'), h('div', { className: 'pmb-v' }, String(counts.notes || 0))),
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '常言'), h('div', { className: 'pmb-v' }, String(counts.sayings || 0))),
          ),
        ),
        h('div', { className: 'pmb-card' },
          h('div', { className: 'pmb-title' }, '开幕表'),
          (data.opening && data.opening.length)
            ? (() => {
                // 近的排前面：有日期的按日期升序，农历放最后；最多显示 10 条，其余折叠
                const raw = data.opening.map((r, i) => ({ ...r, _i: i }))
                const sorted = raw.slice().sort((a, b) => {
                  const da = a.date || '9999-12-31'
                  const db = b.date || '9999-12-31'
                  return da < db ? -1 : da > db ? 1 : a._i - b._i
                })
                const visible = showAllOpening ? sorted : sorted.slice(0, 10)
                // 一条占一整行（不用 pmb-grid 的两列，否则窄屏下日期和按钮会被挤到第二行）
                return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  visible.map((r) => (editing === r._i
                  ? h('div', { key: r._i, className: 'pmb-kv', style: { flexDirection: 'column', alignItems: 'stretch', gap: 6 } },
                      h('input', { className: 'pmb-in', value: editDraft.label, placeholder: '名字', onChange: (e) => setEditDraft({ ...editDraft, label: e.target.value }) }),
                      h('input', { className: 'pmb-in', value: editDraft.date, placeholder: '日期 YYYY-MM-DD', onChange: (e) => setEditDraft({ ...editDraft, date: e.target.value }) }),
                      h('input', { className: 'pmb-in', value: editDraft.lunar, placeholder: '农历 MM-DD（可空）', onChange: (e) => setEditDraft({ ...editDraft, lunar: e.target.value }) }),
                      h('input', { className: 'pmb-in', value: editDraft.note, placeholder: '备注（可空）', onChange: (e) => setEditDraft({ ...editDraft, note: e.target.value }) }),
                      h('div', { style: { display: 'flex', gap: 8 } },
                        h('button', { className: 'pmb-btn pmb-btn-on', onClick: () => saveOpening(r._i) }, '保存'),
                        h('button', { className: 'pmb-btn', onClick: () => setEditing(null) }, '取消'),
                      ),
                    )
                  : h('div', { key: r._i, className: 'pmb-kv', style: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' } },
                      h('div', { className: 'pmb-k', style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.label + (r.repeat === 'yearly' ? '（每年）' : '')),
                      h('div', { className: 'pmb-v', style: { flex: '0 0 auto' } }, r.date || (r.lunar ? '农历 ' + r.lunar : '')),
                      h('div', { style: { display: 'flex', gap: 6, flex: '0 0 auto' } },
                        h('button', { className: 'pmb-btn', onClick: () => startEdit(r._i, r) }, '编辑'),
                        h('button', { className: 'pmb-btn', onClick: () => removeOpening(r._i) }, '删除'),
                      ),
                    ))),
                  sorted.length > 10
                    ? h('button', { className: 'pmb-btn', onClick: () => setShowAllOpening(!showAllOpening) },
                        showAllOpening ? '收起' : `展开全部（${sorted.length} 条）`)
                    : null,
                )
              })()
            : h('div', { className: 'pmb-hint' }, '表是空的（用 memory_opening add 加一条特殊日子）。'),
          h('div', { className: 'pmb-sub' }, '每天第一次打开时读一次；到点提醒一次。'),
        ),
        h('div', { className: 'pmb-card' },
          h('div', { className: 'pmb-title' }, '压缩与备份'),
          h('div', { className: 'pmb-grid' },
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '累计压缩'), h('div', { className: 'pmb-v' }, String(data.compactions || 0) + ' 次')),
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '上次压缩'), h('div', { className: 'pmb-v' }, data.lastCompactionAt ? fmtLocal(data.lastCompactionAt) : '（还没触发过）')),
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '最近备份'), h('div', { className: 'pmb-v' }, backup.lastAt ? fmtLocal(backup.lastAt) : '（还没备份）')),
            h('div', { className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, '保留'), h('div', { className: 'pmb-v' }, (backup.keepDays || '-') + ' 天')),
          ),
          h('div', { className: 'pmb-sub' }, '数据目录：' + (data.dir || '') + (backup.dir ? '　｜　备份：' + backup.dir : '')),
        ),
      )
    }

    // 2026-11-22 丹阳定：观察器的「省 token」设置从值班台搬到记忆设置（独立 tab）。
    // 这里同时留一个开放接口：extras（自定义查看项，一行一条「名称=提示」），
    // 别人或别的插件想加「需要时常查看的内容」，往 settings.json 的 extras 里加即可。
    function ObserverPanel() {
      const { useState, useEffect, useCallback } = React
      const [qw, setQw] = useState(null)
      const [skipText, setSkipText] = useState('')
      const [extrasText, setExtrasText] = useState('')
      const [savingQw, setSavingQw] = useState(false)
      const [qwMsg, setQwMsg] = useState('')
      const loadQw = useCallback(async () => {
        const res = await callApi('qq-watch')
        if (res && res.ok === true) {
          setQw(res)
          setSkipText((((res.settings || {}).skip) || []).map((r) => r.type + ':' + r.value).join('\n'))
          setExtrasText((((res.settings || {}).extras) || []).map((e) => e.name + '=' + (e.text || '')).join('\n'))
        }
      }, [])
      useEffect(() => { loadQw() }, [loadQw])
      const saveQw = useCallback(async () => {
        if (!qw) return
        setSavingQw(true)
        setQwMsg('')
        const skip = skipText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
          const i = line.indexOf(':')
          if (i < 0) return null
          const type = line.slice(0, i).trim().toLowerCase()
          const value = line.slice(i + 1).trim()
          if (!['keyword', 'regex', 'group'].includes(type) || !value) return null
          return { type, value }
        }).filter(Boolean)
        const extras = extrasText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
          const i = line.indexOf('=')
          if (i <= 0) return null
          return { name: line.slice(0, i).trim(), text: line.slice(i + 1).trim() }
        }).filter(Boolean)
        const res = await callApi('qq-watch', {
          watchMinutes: qw.settings.watchMinutes,
          replyMinutes: qw.settings.replyMinutes,
          peakHalf: Boolean(qw.settings.peakHalf),
          skip,
          extras,
        })
        setSavingQw(false)
        if (res && res.ok === true) { setQw(res); setQwMsg('已保存（观察器下一轮热读生效，不用重启）') }
        else setQwMsg((res && res.error) || '保存失败')
      }, [qw, skipText, extrasText])
      const setQwField = (k, v) => setQw((prev) => (prev ? { ...prev, settings: { ...prev.settings, [k]: v } } : prev))
      const numInputStyle = { width: 72, padding: '2px 6px', fontSize: 12 }
      const taStyle = { width: '100%', marginTop: 4, boxSizing: 'border-box', fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical' }
      if (!qw) return h('div', { className: 'pmb' }, h('div', { className: 'pmb-sub' }, '读取观察器设置…'))
      return h('div', { className: 'pmb' },
        h('div', { className: 'pmb-title' }, '省 token（观察器）'),
        h('div', { className: 'pmb-sub' }, '跟值班台分开了：这里只改观察器的节奏与查看内容，保存后下一轮热读。'),
        h('div', { className: 'pmb-grid' },
          h('div', { className: 'pmb-kv' },
            h('div', { className: 'pmb-k' }, '观察间隔（分钟）'),
            h('div', { className: 'pmb-v' },
              h('input', { type: 'number', min: 1, max: 30, value: qw.settings.watchMinutes, style: numInputStyle, onChange: (e) => setQwField('watchMinutes', Number(e.target.value) || 1) }))),
          h('div', { className: 'pmb-kv' },
            h('div', { className: 'pmb-k' }, '回话间隔（分钟）'),
            h('div', { className: 'pmb-v' },
              h('input', { type: 'number', min: 1, max: 30, value: qw.settings.replyMinutes, style: numInputStyle, onChange: (e) => setQwField('replyMinutes', Number(e.target.value) || 1) }))),
          h('div', { className: 'pmb-kv' },
            h('div', { className: 'pmb-k' }, '峰时减半'),
            h('div', { className: 'pmb-v' },
              h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: Boolean(qw.settings.peakHalf), onChange: (e) => setQwField('peakHalf', e.target.checked) }),
                h('span', null, qw.settings.peakHalf ? '开（峰时两个间隔 ×2）' : '关')))),
          h('div', { className: 'pmb-kv' },
            h('div', { className: 'pmb-k' }, '当前生效'),
            h('div', { className: 'pmb-v' }, '观察 ' + qw.effective.watchMinutes + ' 分钟 / 回话 ' + qw.effective.replyMinutes + ' 分钟' + (qw.effective.peak ? '（峰时）' : '')))),
        h('div', { style: { marginTop: 10, fontSize: 12, opacity: 0.85 } }, '自定义查看项（一行一条「名称=提示」；别人也能加，观察时按它去查）'),
        h('textarea', { value: extrasText, onChange: (e) => setExtrasText(e.target.value), rows: 3, placeholder: '待办=看有没有被卡住的事\n私信=有没有没回的人', style: taStyle }),
        h('div', { style: { marginTop: 10, fontSize: 12, opacity: 0.85 } }, '跳过规则（一行一条，type:value；type = keyword / regex / group；留空 = 什么都不跳）'),
        h('textarea', { value: skipText, onChange: (e) => setSkipText(e.target.value), rows: 3, placeholder: 'keyword:插眼\ngroup:123456789', style: taStyle }),
        h('div', { className: 'pmb-actions', style: { marginTop: 8 } },
          h('button', { className: 'pmb-btn', disabled: savingQw, onClick: () => saveQw() }, savingQw ? '保存中…' : '保存设置'),
          qwMsg ? h('span', { className: 'pmb-sub' }, qwMsg) : null),
        h('div', { className: 'pmb-sub' }, '文件：' + (qw.effective.file || '~/.dsh/qq-watch/settings.json') + (qw.effective.exists ? '' : '（还没创建，保存后生成）')),
      )
    }

    function MemorySettingsPanel(props) {
      const { useState } = React
      // initialTab 只给测试用（宿主不传）；页面仍按点 tab 切换
      const [tab, setTab] = useState((props && props.initialTab) || 'features')
      const tabs = [
        ['overview', '记忆'],
        ['features', '功能开关'],
        ['backup', '备份'],
        ['summary', '自动摘要'],
        ['session', '会话记忆'],
        ['observer', '观察器'],
        ['update', '插件更新'],
      ]
      const body = tab === 'overview' ? h(OverviewPanel)
        : tab === 'features' ? h(FeaturesPanel)
        : tab === 'backup' ? h(BackupPanel)
        : tab === 'summary' ? h(AutoSummaryPanel)
        : tab === 'observer' ? h(ObserverPanel)
        : tab === 'update' ? h(UpdatePanel)
        : h(SessionMemoryPanel)
      return h('div', { className: 'pmb' },
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: 8 } },
          tabs.map(([id, label]) => h('button', {
            key: id,
            className: tab === id ? 'pmb-btn pmb-btn-on' : 'pmb-btn',
            onClick: () => setTab(id),
          }, label)),
        ),
        body,
      )
    }

    // 时间提示的开关（v1.3）：插件自己的钩子，零模型；放在「功能开关」页底部
    function NowHintCard() {
      const { useState, useEffect, useCallback } = React
      const [cfg, setCfg] = useState(null)
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        try {
          const res = await callApi('now')
          if (res && res.ok === true) setCfg({ mode: res.mode, gapMinutes: res.gapMinutes })
          else setError((res && res.error) || '读取失败')
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        }
      }, [])
      useEffect(() => { load() }, [load])

      const save = async (patch) => {
        const next = { ...(cfg || {}), ...patch }
        setCfg(next)
        const res = await callApi('now', next)
        if (res && res.ok === true) setCfg({ mode: res.mode, gapMinutes: res.gapMinutes })
        else setError((res && res.error) || '保存失败')
      }

      return h('div', { className: 'pmb-card' },
        h('div', { className: 'pmb-title' }, '时间提示'),
        h('div', { className: 'pmb-hint' }, '插件自己的钩子，零模型成本。一次只触发一次；两个条件都没满足，就完全不注入时间。'),
        error ? h('div', { className: 'pmb-error' }, error) : null,
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          h('select', {
            className: 'pmb-in',
            value: (cfg || {}).mode || 'gap',
            onChange: (e) => save({ mode: e.target.value }),
          },
            h('option', { value: 'gap' }, '隔久了才给（默认）'),
            h('option', { value: 'recall' }, '只有翻出旧回忆时才给'),
            h('option', { value: 'both' }, '两种都算（隔久 或 回忆，任一满足给一次）'),
            h('option', { value: 'off' }, '关闭（都不给，这一轮不注入时间）'),
          ),
          h('span', { className: 'pmb-sub' }, '间隔'),
          h('input', {
            className: 'pmb-in', type: 'number', min: 1, max: 1440,
            style: { width: 72 },
            value: (cfg || {}).gapMinutes || 10,
            onChange: (e) => save({ gapMinutes: Number(e.target.value) || 10 }),
          }),
          h('span', { className: 'pmb-sub' }, '分钟'),
        ),
      )
    }

    function FeaturesPanel() {
      const { useState, useEffect, useCallback } = React
      const [items, setItems] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')

      const load = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const res = await callApi('features')
          if (!res || res.ok !== true) throw new Error((res && res.error) || '读取失败')
          setItems(res.items || [])
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const toggle = async (item) => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const res = await callApi('save-feature', { id: item.id, enabled: !item.enabled })
          if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败')
          setItems(res.items || [])
          setNotice(`「${item.label}」已${item.enabled ? '关闭' : '打开'}，下一轮生效。`)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'pmb' },
        h('div', { className: 'pmb-title' }, '功能开关'),
        h('div', { className: 'pmb-hint' }, '这里是插件的全部可选功能。用不上的关着，用得上的打开——每个人的用法不一样，不用全开；默认关的也列出来，不列出来就容易一直忘着。'),
        error ? h('div', { className: 'pmb-error' }, error) : null,
        notice ? h('div', { className: 'pmb-hint' }, notice) : null,
        items === null
          ? h('div', { className: 'pmb-hint' }, '读取中…')
          : h('div', { className: 'pmb-list' },
              items.map((item) => h('div', { key: item.id, className: 'pmb-row' },
                h('div', { style: { flex: 1 } },
                  h('div', { className: 'pmb-k' }, item.label),
                  h('div', { className: 'pmb-hint' }, item.desc),
                ),
                h('button', {
                  className: item.enabled ? 'pmb-btn pmb-btn-on' : 'pmb-btn',
                  disabled: busy,
                  onClick: () => toggle(item),
                }, item.enabled ? '已开启' : '已关闭'),
              )),
            ),
        h(RecallCard),
        h(NowHintCard),
      )
    }

    function RecallCard() {
      const { useState, useEffect, useCallback } = React
      const [cfg, setCfg] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [error, setError] = useState('')
      const load = useCallback(async () => {
        try {
          const res = await callApi('recall-view')
          if (!res || res.ok !== true) throw new Error((res && res.error) || '读取失败')
          setCfg(res)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        }
      }, [])
      useEffect(() => { load() }, [load])
      const save = async (patch) => {
        setBusy(true); setError(''); setNotice('')
        try {
          const res = await callApi('recall-update', patch)
          if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败')
          setCfg(res)
          setNotice('已保存，下一轮生效。')
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }
      const row = (k, hint, control) => h('div', { className: 'pmb-row' },
        h('div', { style: { flex: 1 } },
          h('div', { className: 'pmb-k' }, k),
          h('div', { className: 'pmb-hint' }, hint),
        ),
        control,
      )
      return h('div', { style: { marginTop: 18 } },
        h('div', { className: 'pmb-title' }, '顺手取回（强弱提示）'),
        h('div', { className: 'pmb-hint' }, '说话时按关键词顺手取几条记忆：命中够强的进正文，擦边的只在末尾报个数。'),
        error ? h('div', { className: 'pmb-error' }, error) : null,
        notice ? h('div', { className: 'pmb-hint' }, notice) : null,
        cfg === null
          ? h('div', { className: 'pmb-hint' }, '读取中…')
          : h('div', { className: 'pmb-list' },
              row('开关', '关掉就完全不取回', h('button', {
                className: cfg.enabled ? 'pmb-btn pmb-btn-on' : 'pmb-btn',
                disabled: busy,
                onClick: () => save({ enabled: !cfg.enabled }),
              }, cfg.enabled ? '已开启' : '已关闭')),
              row('强命中阈值', '同时命中几个词才进正文', h('select', {
                style: { minWidth: '90px' },
                value: String(cfg.minStrong || 2),
                disabled: busy,
                onChange: (e) => save({ minStrong: Number(e.target.value) }),
              }, [1, 2, 3].map((n) => h('option', { key: n, value: String(n) }, n + ' 个')))),
              row('弱命中提示', '末尾报「另有 N 条只擦到一点」', h('button', {
                className: cfg.showWeak === false ? 'pmb-btn' : 'pmb-btn pmb-btn-on',
                disabled: busy,
                onClick: () => save({ showWeak: cfg.showWeak === false }),
              }, cfg.showWeak === false ? '不报' : '报')),
            ),
      )
    }

    function AutoSummaryPanel() {
      const { useState, useEffect, useCallback } = React
      const [summaries, setSummaries] = useState(null)
      const [autoCfg, setAutoCfg] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const [sums, autoRes] = await Promise.all([callApi('autosummaries'), callApi('autosummary')])
          if (autoRes && autoRes.ok === true) setAutoCfg(autoRes)
          else setAutoCfg({ ok: false, enabled: false, error: (autoRes && autoRes.error) || '接口不可用' })
          if (sums && sums.ok === true) setSummaries(sums)
          else setSummaries({ ok: false, items: [], total: 0, error: (sums && sums.error) || '接口不可用' })
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const saveAuto = async () => {
        if (!autoCfg) return
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const route = autoCfg.model && autoCfg.model.provider && autoCfg.model.model
            ? { provider: autoCfg.model.provider, model: autoCfg.model.model }
            : null
          const res = await callApi('save-autosummary', {
            enabled: autoCfg.enabled,
            onCompaction: autoCfg.onCompaction,
            onSessionEnd: autoCfg.onSessionEnd,
            maxEntries: autoCfg.maxEntries,
            model: route,
          })
          if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败')
          setAutoCfg(res.config)
          setNotice('自动摘要设置已保存，下一次触发就按新开关走。')
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const deleteSummary = async (hash) => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const res = await callApi('delete-autosummary', { hash })
          if (!res || res.ok !== true) throw new Error((res && res.error) || '删除失败')
          setNotice('已删除 1 条自动摘要（原始会话和手写日记没动）。')
          const sums = await callApi('autosummaries')
          if (sums && sums.ok === true) setSummaries(sums)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const summaryItems = summaries && Array.isArray(summaries.items) ? summaries.items : []

      const actions = h(
        Actions,
        null,
        h('button', { className: 'pmb-btn pmb-btn-primary', disabled: busy || !autoCfg || autoCfg.ok === false, onClick: saveAuto }, busy ? '处理中…' : '保存自动摘要设置'),
        h('button', { className: 'pmb-btn', disabled: busy, onClick: load }, '刷新'),
      )

      const autoPolicyCard = autoCfg
        ? h(
            'div',
            { className: 'pmb-card' },
            h('div', { className: 'pmb-title' }, '自动摘要设置'),
            h('div', { className: 'pmb-sub' }, '模型把压过的回合压成一段「【自动摘要】」，只在 memory_search 命中时出现，不进每轮注入。关掉总开关就不会再生成新的。'),
            h(Row, { label: '总开关' }, h(Check, { checked: !!autoCfg.enabled, disabled: busy, text: autoCfg.enabled ? '开（按下面的触发条件自动摘要）' : '关（不生成新的自动摘要）', onChange: (v) => setAutoCfg({ ...autoCfg, enabled: v }) })),
            h(Row, { label: '触发条件' },
              h(Check, { checked: !!autoCfg.onCompaction, disabled: busy, text: '上下文压缩时', onChange: (v) => setAutoCfg({ ...autoCfg, onCompaction: v }) }),
              h(Check, { checked: !!autoCfg.onSessionEnd, disabled: busy, text: '会话结束时', onChange: (v) => setAutoCfg({ ...autoCfg, onSessionEnd: v }) }),
            ),
            h(Row, { label: '保留上限' }, h('input', { className: 'pmb-input', type: 'number', min: 0, max: 100000, step: 1, value: String(autoCfg.maxEntries ?? 300), disabled: busy, onChange: (ev) => setAutoCfg({ ...autoCfg, maxEntries: ev.target.value }) }), h('span', { className: 'pmb-sub' }, '条；超出后按时间删最旧的。默认 300，0 = 不限。')),
            h(Row, { label: '规模限制' }, h('span', { className: 'pmb-sub' }, '最少 ' + String(autoCfg.minTurns || 2) + ' 回合；输入上限 ' + String(autoCfg.maxInputChars || 8000) + ' 字；输出上限 ' + String(autoCfg.maxOutputChars || 400) + ' 字')),
            h(Row, { label: '模型路由' },
              h('input', {
                className: 'pmb-input pmb-input-wide',
                type: 'text',
                placeholder: 'provider（如 ollama / openai-compat）',
                value: String((autoCfg.model && autoCfg.model.provider) || ''),
                disabled: busy,
                spellCheck: false,
                onChange: (ev) => setAutoCfg({ ...autoCfg, model: { ...(autoCfg.model || {}), provider: ev.target.value } }),
              }),
              h('input', {
                className: 'pmb-input',
                type: 'text',
                placeholder: 'model（如 qwen3:4b）',
                value: String((autoCfg.model && autoCfg.model.model) || ''),
                disabled: busy,
                spellCheck: false,
                onChange: (ev) => setAutoCfg({ ...autoCfg, model: { ...(autoCfg.model || {}), model: ev.target.value } }),
              }),
            ),
            h('div', { className: 'pmb-sub' }, '摘要/提炼用哪个模型：留空 = 跟随主会话模型；填了就用这个路由，调用失败会自动回退主会话模型。本地 Ollama 走 OpenAI 兼容 provider。'),
            autoCfg.ok === false ? h('div', { className: 'pmb-err' }, '读不到自动摘要设置：' + (autoCfg.error || '接口不可用')) : null,
          )
        : null

      const summaryCard = h(
        'div',
        { className: 'pmb-card' },
        h('div', { className: 'pmb-title' }, '自动摘要' + (summaries && summaries.ok ? '（共 ' + String(summaries.total || 0) + ' 条）' : '')),
        h('div', { className: 'pmb-sub' }, '这些是模型压过的回合，只在 memory_search 命中时出现，不进每轮注入。删掉一条不会动原始会话和手写日记；删了以后那些回合会重新变成「未摘要」，下次触发摘要时会再摘一遍。'),
        summaryItems.length === 0
          ? h(NOTE, null, summaries && summaries.ok ? '还没有自动摘要。' : '读不到自动摘要列表：' + ((summaries && summaries.error) || '接口不可用'))
          : h(
              'div',
              { className: 'pmb-list' },
              summaryItems.map((it) =>
                h(
                  'div',
                  { key: it.hash || it.ts, className: 'pmb-item' },
                  h(
                    'div',
                    { className: 'pmb-item-head' },
                    h('span', { className: 'pmb-v' }, fmtLocal(it.ts)),
                    h('span', { className: 'pmb-tag' }, reasonLabel(it.reason)),
                    h('span', { className: 'pmb-tag' }, String(it.turns || 0) + ' 回合'),
                    h('span', { className: 'pmb-sub' }, (it.session || '').slice(-8)),
                    h('button', { className: 'pmb-btn', disabled: busy, onClick: () => deleteSummary(it.hash) }, '删除'),
                  ),
                  h('div', { className: 'pmb-item-text' }, it.text || '（空）'),
                ),
              ),
            ),
      )

      return h(
        'div',
        { className: 'pmb' },
        h('div', { className: 'pmb-head' },
          h('div', { className: 'pmb-title' }, '自动摘要'),
          h('div', { className: 'pmb-sub' }, '压缩后 / 会话结束时，用模型把这段回合压成一条摘要，只写日记层、只在检索时出现。这里管开关、触发条件、保留上限和已有的摘要。'),
        ),
        error ? h('div', { className: 'pmb-err' }, error) : null,
        notice ? h('div', { className: 'pmb-ok' }, notice) : null,
        actions,
        autoPolicyCard,
        summaryCard,
      )
    }

    // ---------------------------------------------------------------
    // 页 2：记忆备份（备份策略 + 状态 + 压缩 + 待确认事实）
    // ---------------------------------------------------------------
    function BackupPanel() {
      const { useState, useEffect, useCallback } = React
      const [data, setData] = useState(null)
      const [form, setForm] = useState(null)
      const [facts, setFacts] = useState(null)
      const [cue, setCue] = useState(null) // 取词器/提词器开关与模式
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const [res, factRes, cueRes] = await Promise.all([callApi('status'), callApi('fact-candidates'), callApi('cueprompt')])
          if (!res || res.ok !== true) throw new Error((res && res.error) || '读取备份策略失败')
          setData(res)
          setForm(formFromConfig(res.config))
          if (factRes && factRes.ok === true) setFacts(factRes)
          else setFacts({ ok: false, items: [], pending: 0, error: (factRes && factRes.error) || '接口不可用' })
          if (cueRes && cueRes.ok === true) setCue(cueRes)
          else setCue({ ok: false, enabled: false, mode: 'assist', error: (cueRes && cueRes.error) || '接口不可用' })
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const patch = (key, value) => setForm((prev) => ({ ...(prev || {}), [key]: value }))

      const save = async () => {
        if (!form) return
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const res = await callApi('save', form)
          if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败')
          setData(res)
          setForm(formFromConfig(res.config))
          setNotice('设置已保存，下一次自动备份就按新策略走。')
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const backupNow = async () => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const res = await callApi('backup', {})
          if (!res || res.ok !== true) throw new Error((res && res.error) || '备份失败')
          setData(res)
          setNotice(res.message || '备份完成')
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const decideFact = async (id, decision) => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const res = await callApi(decision === 'accept' ? 'accept-fact' : 'reject-fact', { id })
          if (!res || res.ok !== true) throw new Error((res && res.error) || '操作失败')
          setNotice(res.message || (decision === 'accept' ? '已采纳并写入记忆。' : '已拒绝，不会写进记忆。'))
          const factRes = await callApi('fact-candidates')
          if (factRes && factRes.ok === true) setFacts(factRes)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const saveCue = async (patch) => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const cur = cue && cue.ok ? { enabled: cue.enabled, mode: cue.mode } : { enabled: false, mode: 'assist' }
          const res = await callApi('save-cueprompt', { ...cur, ...patch })
          if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败')
          setCue(res)
          setNotice(res.message || '已保存')
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const runtime = (data && data.runtime) || {}
      const config = (data && data.config) || {}

      const actions = h(
        Actions,
        null,
        h('button', { className: 'pmb-btn pmb-btn-primary', disabled: busy || !form, onClick: save }, busy ? '处理中…' : '保存设置'),
        h('button', { className: 'pmb-btn', disabled: busy, onClick: backupNow }, '立即备份一次'),
        h('button', { className: 'pmb-btn', disabled: busy, onClick: load }, '刷新'),
      )

      const cueCard = cue
        ? h(
            'div',
            { className: 'pmb-card' },
            h('div', { className: 'pmb-title' }, '取词器 / 提词器'),
            cue.ok === false ? h('div', { className: 'pmb-err' }, cue.error || '接口不可用') : null,
            h(Row, { label: '总开关' },
              h(Check, {
                checked: cue.enabled === true,
                disabled: busy,
                text: cue.enabled === true ? '开（每回合取词 + 小模型判读）' : '关（完全不启动：不取词、不判读、不调模型）',
                onChange: (v) => saveCue({ enabled: v }),
              }),
            ),
            h(Row, { label: '运行模式' },
              h('select', {
                className: 'pmb-input',
                // 截图里「assist（照常注…」被截断：下拉框要给够宽度，四个模式说明才看得全
                style: { minWidth: '22rem', maxWidth: '100%' },
                value: cue.mode || 'assist',
                disabled: busy || cue.enabled !== true,
                onChange: (ev) => saveCue({ mode: ev.target.value }),
              },
                h('option', { value: 'assist' }, 'assist（照常注入提示，默认）'),
                h('option', { value: 'shadow' }, 'shadow（只审计不注入：观察用）'),
                h('option', { value: 'enforce' }, 'enforce（只注入高置信 ≥0.7）'),
              ),
            ),
            h('div', { className: 'pmb-note' },
              '关掉之后下一轮就生效（配置每轮热读，不用重启）：取词、判读、写事件全停，一分钱模型调用都不花。'
              + 'shadow 是「照跑但不往上下文里塞」，适合先看它一天会抛几次。'),
          )
        : null

      const statusCard = h(
        'div',
        { className: 'pmb-card' },
        h('div', { className: 'pmb-title' }, '当前状态'),
        h(
          'div',
          { className: 'pmb-grid' },
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '上次备份'), h('span', { className: 'pmb-v' }, fmtLocal(runtime.lastBackupAt))),
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '触发来源'), h('span', { className: 'pmb-v' }, runtime.lastBackupReason === 'compress' ? '压缩上下文' : runtime.lastBackupReason === 'session-end' ? '会话结束' : runtime.lastBackupReason === 'manual' ? '手动 / 面板' : runtime.lastBackupReason || '—')),
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '快照数量'), h('span', { className: 'pmb-v' }, String(runtime.snapshots || 0) + ' 份')),
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '最近快照'), h('span', { className: 'pmb-v' }, runtime.latestSnapshot || '—')),
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '备份目录'), h('span', { className: 'pmb-v' }, config.dir || '—')),
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '备份盘'), h('span', { className: 'pmb-v' }, runtime.dirReadable ? '可读' : '读不到（盘没插 / 路径不对）')),
        ),
        runtime.warning ? h('div', { className: 'pmb-warn' }, '⚠ ' + runtime.warning) : null,
      )

      const policyCard = form
        ? h(
            'div',
            { className: 'pmb-card' },
            h('div', { className: 'pmb-title' }, '备份策略'),
            h(Row, { label: '自动备份' }, h(Check, { checked: form.enabled, disabled: busy, text: form.enabled ? '开（压缩上下文 / 会话结束时排队）' : '关（只手动备份）', onChange: (v) => patch('enabled', v) })),
            h(Row, { label: '最小间隔' }, h('input', { className: 'pmb-input', type: 'number', min: 0, max: 720, step: 1, value: String(form.minIntervalHours), disabled: busy, onChange: (ev) => patch('minIntervalHours', ev.target.value) }), h('span', { className: 'pmb-sub' }, '小时；0 = 不限制。默认 24 小时，也就是一天最多一份。')),
            h(Row, { label: '保留天数' }, h('input', { className: 'pmb-input', type: 'number', min: 1, max: 3650, step: 1, value: String(form.keepDays), disabled: busy, onChange: (ev) => patch('keepDays', ev.target.value) }), h('span', { className: 'pmb-sub' }, '天；快照名里的时间戳超过这个天数就自动删掉。')),
            h(Row, { label: '备份内容' },
              h(Check, { checked: form.behavior, disabled: busy, text: '行为记忆', onChange: (v) => patch('behavior', v) }),
              h(Check, { checked: form.configFile, disabled: busy, text: '配置与运行态', onChange: (v) => patch('configFile', v) }),
              h(Check, { checked: form.sessions, disabled: busy, text: '原始会话日志', onChange: (v) => patch('sessions', v) }),
            ),
            h(Row, { label: '备份目录' }, h('input', { className: 'pmb-input pmb-input-wide', type: 'text', value: form.dir, disabled: busy, spellCheck: false, onChange: (ev) => patch('dir', ev.target.value) }), h('span', { className: 'pmb-sub' }, '必须绝对路径；留空则用默认 F:\\dsh-memory-backup。')),
            h(Row, { label: '工作文件' },
              h(Check, { checked: form.workEnabled, disabled: busy, text: form.workEnabled ? '开（一并复制进快照的 work/）' : '关（默认，不影响任何东西）', onChange: (v) => patch('workEnabled', v) }),
            ),
            form.workEnabled
              ? h(Row, { label: '工作文件目录' },
                  h('input', { className: 'pmb-input pmb-input-wide', type: 'text', value: form.workDir, disabled: busy, spellCheck: false, placeholder: '例如 F:\\工作导出（绝对路径）', onChange: (ev) => patch('workDir', ev.target.value) }),
                  h('span', { className: 'pmb-sub' }, '整个目录原样复制；不进记忆库、不参与检索，只在快照旁留一份原文。'),
                )
              : null,
            form.workEnabled
              ? h(Row, { label: '工作文件额度' },
                  h('input', { className: 'pmb-input', type: 'number', min: 1, max: 100, step: 1, value: String(form.workKeepArchives), disabled: busy, onChange: (ev) => patch('workKeepArchives', ev.target.value) }),
                  h('span', { className: 'pmb-sub' }, '份；单独存 work-<时间>/，自己轮转。'),
                  h('input', { className: 'pmb-input', type: 'number', min: 1, max: 500, step: 1, value: String(form.workMaxGB), disabled: busy, onChange: (ev) => patch('workMaxGB', ev.target.value) }),
                  h('span', { className: 'pmb-sub' }, 'GB 上限（默认 20）。'),
                )
              : null,
            h(NOTE, null, '深层记忆与图片/音频资产始终会备份；「行为记忆」是 relations / user / memo / notes / diary / sources / persona。工作文件默认关，**只随手动备份走、不进每日快照轮转**（GB 级也扛得住，默认上限 20GB，超了整体跳过、不做半份备份）。'),
          )
        : null

      const compaction = (data && data.compaction) || {}
      const compactionRecords = Array.isArray(compaction.recent) ? compaction.recent : []
      const triggerLabel = (t) => (t === 'command' ? '手动 /compact' : '自动')
      const compactionCard = h(
        'div',
        { className: 'pmb-card' },
        h('div', { className: 'pmb-title' }, '上下文压缩'),
        h(
          'div',
          { className: 'pmb-grid' },
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '累计次数'), h('span', { className: 'pmb-v' }, String(compaction.count || 0) + ' 次')),
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '最近一次'), h('span', { className: 'pmb-v' }, fmtLocal(compaction.lastAt))),
          h('div', { className: 'pmb-kv' }, h('span', { className: 'pmb-k' }, '自动摘要'), h('span', { className: 'pmb-v' }, String(compaction.summaries || 0) + ' 次' + (compaction.lastSummaryAt ? '，最近 ' + fmtLocal(compaction.lastSummaryAt) : ''))),
        ),
        compactionRecords.length === 0
          ? null
          : h(
              'div',
              { className: 'pmb-list' },
              compactionRecords.map((r) =>
                h(
                  'div',
                  { key: r.id || r.at, className: 'pmb-item' },
                  h(
                    'div',
                    { className: 'pmb-item-head' },
                    h('span', { className: 'pmb-v' }, fmtLocal(r.at)),
                    h('span', { className: 'pmb-tag' }, triggerLabel(r.trigger)),
                    h('span', { className: 'pmb-tag' }, '压掉 ' + String(r.items || 0) + ' 条'),
                    h('span', { className: 'pmb-tag' }, '省 ' + String(r.savedTokens || 0) + ' tok'),
                    h('span', { className: 'pmb-sub' }, r.provider && r.model ? r.provider + '/' + r.model : ''),
                  ),
                ),
              ),
            ),
        h('div', { className: 'pmb-note' },
          '压缩本身由 ' + (compaction.provider || '官方 compaction 引擎') + ' 完成，这里只记录官方 compaction 事件（重启/重放不会重复计数）。'
          + (compaction.suite ? ' 触发阈值与摘要模型由 ' + compaction.suite + ' 控制；它不在了也不影响这里的记录。' : '')),
      )

      const factItems = facts && Array.isArray(facts.items) ? facts.items : []
      const layerName = (layer) => (layer === 'user' ? '用户档案' : layer === 'relation' ? '关系记忆' : layer === 'saying' ? '常言' : layer || '未知')
      const factCard = h(
        'div',
        { className: 'pmb-card' },
        h('div', { className: 'pmb-title' }, '待确认事实' + (facts && facts.ok ? '（' + String(facts.pending || 0) + ' 条）' : '')),
        h('div', { className: 'pmb-sub' }, '模型从自动摘要里提炼的稳定事实候选。**默认不写任何记忆**：点「采纳」才写进对应的记忆层，点「拒绝」就丢掉。没有候选时，可以让助手跑一次 memory_facts action=extract；tooltip：这部分只提案，不会自己动 user / relation。'),
        factItems.length === 0
          ? h(NOTE, null, facts && facts.ok ? '没有待确认的事实候选。' : '读不到事实候选：' + ((facts && facts.error) || '接口不可用'))
          : h(
              'div',
              { className: 'pmb-list' },
              factItems.map((it) =>
                h(
                  'div',
                  { key: it.id, className: 'pmb-item' },
                  h(
                    'div',
                    { className: 'pmb-item-head' },
                    h('span', { className: 'pmb-tag' }, layerName(it.layer)),
                    h('span', { className: 'pmb-v' }, it.keyword || '（无关键词）'),
                    h('span', { className: 'pmb-sub' }, fmtLocal(it.ts)),
                    h('button', { className: 'pmb-btn pmb-btn-primary', disabled: busy, onClick: () => decideFact(it.id, 'accept') }, '采纳'),
                    h('button', { className: 'pmb-btn', disabled: busy, onClick: () => decideFact(it.id, 'reject') }, '拒绝'),
                  ),
                  h('div', { className: 'pmb-item-text' }, it.text || it.meaning || '（空）'),
                  it.reason ? h('div', { className: 'pmb-sub' }, '理由：' + it.reason) : null,
                ),
              ),
            ),
      )

      return h(
        'div',
        { className: 'pmb' },
        h('div', { className: 'pmb-head' },
          h('div', { className: 'pmb-title' }, '记忆备份'),
          h('div', { className: 'pmb-sub' }, '自动备份一天最多一份、保留一段时间；改这里的设置等于改 config.json 的 backup 段，和 memory_backup / memory_control 看到的是同一份。手动「立即备份一次」不受间隔限制。'),
        ),
        error ? h('div', { className: 'pmb-err' }, error) : null,
        notice ? h('div', { className: 'pmb-ok' }, notice) : null,
        actions,
        statusCard,
        cueCard,
        policyCard,
        compactionCard,
        factCard,
        // A-51（2026-10-25 用户）：那行「说明书放在插件目录之外…」撤掉——设置页是干活的地方，
        // 这句说明放在这里占位置且每次看见都相同。外置与演练都已落实（A-44/A-50），不必再在 UI 里重复。
      )
    }

    // ---------------------------------------------------------------
    // 页 3：会话记忆（v0.28）——脏片段本会话屏蔽/删除，防止污染上下文
    // ---------------------------------------------------------------
    function SessionMemoryPanel() {
      const { useState, useEffect, useCallback } = React
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [error, setError] = useState('')
      const [query, setQuery] = useState('')
      const [newestFirst, setNewestFirst] = useState(true)
      // 加载更早之后要滚到衔接处，否则「新的在前」时内容长在看不见的底部
      const [pendingScroll, setPendingScroll] = useState('')
      // 删除不可逆（有归档但要翻文件），点一次只问「确定？」，再点才真删
      const [confirmHash, setConfirmHash] = useState('')
      // 展开 / 菜单：每条只留一个「⋯」，点开才看到展开、屏蔽、删掉
      const [openHash, setOpenHash] = useState('')
      const [menuHash, setMenuHash] = useState('')
      // 按天折叠：key 是 2026-10-23 这种日期，没记录时默认只展开最新一天
      const [openDays, setOpenDays] = useState({})
      // 视图：event=只看摘要/事件（默认），raw=只看原始回合，all=全看
      const [kindMode, setKindMode] = useState('event')
      // 翻页：接口一页 100 条，更早的靠「加载更早」往前接
      const [older, setOlder] = useState([])
      const [loadingMore, setLoadingMore] = useState(false)
      const [moreDone, setMoreDone] = useState(false)

      const load = useCallback(async (session) => {
        setBusy(true)
        setError('')
        setOlder([])
        setMoreDone(false)
        setMenuHash('')
        try {
          const res = await callApi('session-memory', undefined, session ? { session } : undefined)
          if (!res || res.ok !== true) throw new Error((res && res.error) || '读取会话记忆失败')
          setData(res)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const act = async (action, payload, okText) => {
        setBusy(true)
        setError('')
        setNotice('')
        const sid = data && data.session
        try {
          const res = await callApi(action, { session: sid, ...(payload || {}) })
          if (!res || res.ok !== true) throw new Error((res && res.error) || '操作失败')
          setNotice(res.message || okText || '完成')
          if (action === 'session-delete' && payload && payload.hash) {
            const drop = payload.hash
            setData((prev) => (prev && Array.isArray(prev.entries) ? { ...prev, entries: prev.entries.filter((e) => e.hash !== drop) } : prev))
            setOlder((prev) => prev.filter((e) => e.hash !== drop))
          }
          if (action === 'session-suppress' && payload && Array.isArray(payload.hashes)) {
            setData((prev) => {
              if (!prev) return prev
              const ov = prev.overview || {}
              return { ...prev, overview: { ...ov, suppressed: Array.from(new Set([...(ov.suppressed || []), ...payload.hashes])) } }
            })
          }
          if (action === 'session-unsuppress') {
            setData((prev) => {
              if (!prev) return prev
              const ov = prev.overview || {}
              const drop = payload && Array.isArray(payload.hashes) ? new Set(payload.hashes) : null
              return { ...prev, overview: { ...ov, suppressed: drop ? (ov.suppressed || []).filter((x) => !drop.has(x)) : [] } }
            })
          }
          setMenuHash('')
          await load(sid)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
          setBusy(false)
        }
      }

      // 切回页面 / 窗口重新聚焦时重拉一次，不停在旧列表
      useEffect(() => {
        const reload = () => {
          if (typeof document !== 'undefined' && document.hidden) return
          load(data && data.session)
        }
        if (typeof window !== 'undefined') window.addEventListener('focus', reload)
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', reload)
        return () => {
          if (typeof window !== 'undefined') window.removeEventListener('focus', reload)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', reload)
        }
      }, [load, data && data.session])

      const serverEntries = (data && Array.isArray(data.entries)) ? data.entries : []
      const total = data && Number.isFinite(data.total) ? data.total : serverEntries.length
      const seen = new Set()
      const allEntries = [...older, ...serverEntries]
        .filter((it) => {
          const k = String(it.hash || it.ts)
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      const hasMore = !moreDone && allEntries.length < total
      const suppressed = (data && data.overview && Array.isArray(data.overview.suppressed)) ? data.overview.suppressed : []
      const suppressedSet = new Set(suppressed)
      const sessions = (data && Array.isArray(data.sessions)) ? data.sessions : []
      const q = query.trim().toLowerCase()
      // 视图层：默认只看「摘要 / 事件」，原始回合收进另一种视图——一回合一条是流水账，不是记忆
      const kindPool = allEntries.filter((it) => {
        if (kindMode === 'all') return true
        if (kindMode === 'raw') return it.kind === 'turn'
        return it.kind !== 'turn' // 摘要 + 将来的事件条目
      })
      const hiddenByKind = allEntries.length - kindPool.length
      const entries = kindPool
        .filter((it) => !q || String(it.summary || '').toLowerCase().includes(q) || String(it.hash || '').toLowerCase().includes(q))
        .slice()
        .sort((a, b) => (newestFirst ? String(b.ts).localeCompare(String(a.ts)) : String(a.ts).localeCompare(String(b.ts))))
      const hiddenByFilter = kindPool.length - entries.length
      // 按天分组：条目太多时翻页也找不着，折叠成「每天一行」才看得清分布
      const dayKeyOf = (iso) => {
        const t = Date.parse(iso)
        if (!Number.isFinite(t)) return '未知日期'
        const d = new Date(t)
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
      }
      const dayLabelOf = (iso) => {
        const t = Date.parse(iso)
        if (!Number.isFinite(t)) return '未知日期'
        const d = new Date(t)
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
        return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + week
      }
      const dayGroups = []
      for (const it of entries) {
        const key = dayKeyOf(it.ts)
        const last = dayGroups[dayGroups.length - 1]
        if (last && last.key === key) last.items.push(it)
        else dayGroups.push({ key, label: dayLabelOf(it.ts), items: [it] })
      }
      // 默认只展开最上面那天；搜索时全部展开（不然命中被折叠看不见）
      const isDayOpen = (key) => (q ? true : (openDays[key] !== undefined ? openDays[key] : key === (dayGroups[0] && dayGroups[0].key)))
      const toggleDay = (key) => setOpenDays({ ...openDays, [key]: !isDayOpen(key) })
      const allDaysOpen = dayGroups.length > 0 && dayGroups.every((g) => isDayOpen(g.key))
      const toggleAllDays = () => {
        if (allDaysOpen) {
          const next = {}
          for (const g of dayGroups) next[g.key] = false
          setOpenDays(next)
        } else {
          const next = {}
          for (const g of dayGroups) next[g.key] = true
          setOpenDays(next)
        }
      }
      const blockedBlocks = suppressed.filter((x) => BLOCK_LABELS[x])
      const blockedHashes = suppressed.filter((x) => !BLOCK_LABELS[x])
      const latestEntry = allEntries.length ? allEntries[allEntries.length - 1] : null

      const loadMore = async () => {
        if (!data || !data.session || loadingMore || !hasMore) return
        setLoadingMore(true)
        setError('')
        setNotice('')
        try {
          const oldest = allEntries.length ? allEntries[0] : null
          const cursor = oldest ? oldest.ts : ''
          const boundary = oldest ? String(oldest.hash || oldest.ts) : ''
          const res = await callApi('session-memory', undefined, {
            session: data.session,
            ...(cursor ? { before: cursor } : {}),
          })
          if (!res || res.ok !== true) throw new Error((res && res.error) || '加载更早失败')
          const got = Array.isArray(res.entries) ? res.entries : []
          if (!got.length) {
            setMoreDone(true)
            setNotice('没有更早的了')
          } else {
            setOlder((prev) => {
              const have = new Set([...prev, ...serverEntries].map((it) => String(it.hash || it.ts)))
              return [...prev, ...got.filter((it) => !have.has(String(it.hash || it.ts)))]
            })
            if (got.length < 100) setMoreDone(true)
            // 滚到衔接处：新的在前时，新加载的在下面，不滚过去看起来就像没加载
            setPendingScroll(boundary)
            setNotice('已加载更早 ' + String(got.length) + ' 条（接在' + (newestFirst ? '列表下方' : '列表上方') + '）')
          }
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setLoadingMore(false)
        }
      }

      // 加载完再滚：等这一帧渲染出来，元素才存在
      useEffect(() => {
        if (!pendingScroll) return
        const el = typeof document !== 'undefined'
          ? document.querySelector('[data-pmb-hash="' + pendingScroll + '"]')
          : null
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
        setPendingScroll('')
      }, [pendingScroll, older])

      const askDelete = (hash) => {
        if (confirmHash !== hash) {
          setConfirmHash(hash)
          setTimeout(() => setConfirmHash((cur) => (cur === hash ? '' : cur)), 5000)
          return
        }
        setConfirmHash('')
        act('session-delete', { hash }, '已删除（归档里可找回）')
      }

      // 布局零件：分组 + 「一行一件事」（左边标题和说明，右边控件）
      const sec = (title, ...kids) =>
        h('div', { className: 'pmb-sec' }, title ? h('div', { className: 'pmb-sec-h' }, title) : null, kids)
      const line = (label, note, control) =>
        h('div', { className: 'pmb-line' },
          h('div', { className: 'pmb-line-main' },
            h('div', { className: 'pmb-line-label' }, label),
            note ? h('div', { className: 'pmb-line-note' }, note) : null),
          h('div', { className: 'pmb-line-ctl' }, control))

      const head = h(
        'div',
        { className: 'pmb-head' },
        h('div', { className: 'pmb-title' }, '会话记忆'),
        h('div', { className: 'pmb-sub' }, '这里是本会话自己写下的片段。屏蔽只影响本会话注入，数据不删；删掉会先归档，可从归档找回。'),
      )

      const sessionSec = sec('当前会话',
        data
          ? h('div', { style: { display: 'contents' } },
              line('会话', '换会话＝换一张名单，下面的片段和屏蔽跟着换',
                h('select', {
                  className: 'pmb-input pmb-input-wide',
                  value: data.session,
                  disabled: busy,
                  onChange: (ev) => load(ev.target.value),
                  style: { width: 'min(100%,320px)' },
                },
                  sessions.map((x) => h('option', { key: x.id, value: x.id }, x.id + (x.ts ? '  ' + fmtLocal(x.ts) : ''))),
                  sessions.some((x) => x.id === data.session) ? null : h('option', { value: data.session }, data.session || '（还没有会话）'),
                )),
              line('状态', null,
                h('span', { className: 'pmb-line-note' },
                  (data.disabled ? '已暂停注入' : '注入正常') +
                    ' · 片段 ' + String(allEntries.length) + (total > allEntries.length ? ' / 共 ' + String(total) : '') + ' 条' +
                    (latestEntry ? ' · 最近一条 ' + (relTime(latestEntry.ts) || fmtLocal(latestEntry.ts)) : '') +
                    (suppressed.length ? ' · 屏蔽 ' + String(suppressed.length) + ' 项' : ''))),
              line('本会话注入', '暂停后这个会话不再注入记忆，但下面的操作仍然有效',
                h('button', { className: 'pmb-btn', disabled: busy, onClick: () => act('session-toggle', { enabled: !!data.disabled }) },
                  data.disabled ? '恢复注入' : '暂停注入')),
              line('刷新', '别的窗口改过之后，这里不会自动变',
                h('button', { className: 'pmb-btn', disabled: busy, onClick: () => load(data.session) }, '重新读取')),
            )
          : h(NOTE, null, '读取中…'),
      )

      const blockSec = data
        ? sec('屏蔽整块',
            h('div', { className: 'pmb-line' },
              h('div', { className: 'pmb-line-main' },
                h('div', { className: 'pmb-line-label' }, '整块记忆'),
                h('div', { className: 'pmb-line-note' }, '不想让某一整块进这个会话，就点一下；再点解除。')),
              h('div', { className: 'pmb-line-ctl' },
                ['core', 'state', 'social', 'persona'].map((key) => {
                  const on = suppressedSet.has(key)
                  return h('button', {
                    key,
                    className: 'pmb-btn' + (on ? ' pmb-btn-danger' : ''),
                    disabled: busy,
                    onClick: () => act(on ? 'session-unsuppress' : 'session-suppress', { hashes: [key] }, on ? '已解除 ' + blockLabel(key) : '已屏蔽 ' + blockLabel(key)),
                  }, on ? blockLabel(key) + '·已屏蔽' : blockLabel(key))
                }))),
            blockedHashes.length
              ? h('div', { className: 'pmb-line' },
                  h('div', { className: 'pmb-line-main' },
                    h('div', { className: 'pmb-line-label' }, '已屏蔽的片段'),
                    h('div', { className: 'pmb-line-note' }, '这些片段不进本会话注入，点「解除」放回去。')),
                  h('div', { className: 'pmb-line-ctl' },
                    blockedHashes.map((hash) =>
                      h('span', { key: hash, className: 'pmb-tag' },
                        hash.slice(0, 8) + ' ',
                        h('button', { className: 'pmb-btn', disabled: busy, onClick: () => act('session-unsuppress', { hashes: [hash] }, '已解除 ' + hash) }, '解除')))))
              : null)
        : null

      const entriesSec = h('div', { className: 'pmb-sec' },
        h('div', { className: 'pmb-sec-h pmb-sec-h-row' },
          h('span', null, '片段' + (allEntries.length ? '（' + String(allEntries.length) + (total > allEntries.length ? ' / ' + String(total) : '') + '）' : '')),
          hasMore || loadingMore
            ? h('button', {
                className: 'pmb-btn',
                disabled: busy || loadingMore,
                onClick: () => loadMore(),
              }, loadingMore ? '加载中…' : '加载更早（还有 ' + String(Math.max(0, total - allEntries.length)) + ' 条）')
            : null,
        ),
        h('div', { className: 'pmb-line' },
          h('div', { className: 'pmb-line-main' },
            h('div', { className: 'pmb-line-label' }, '看哪些'),
            h('div', { className: 'pmb-line-note' },
              (kindMode === 'event'
                ? '默认只显示摘要与事件——一回合一条是流水账，原始回合收在「原始回合」里'
                : kindMode === 'raw'
                  ? '现在显示的是原始回合（每个回合一条），这里条目最多'
                  : '全部条目，含原始回合') +
                (hiddenByFilter > 0 ? '；筛掉 ' + String(hiddenByFilter) + ' 条' : ''))),
          h('div', { className: 'pmb-line-ctl' },
            h('select', {
              className: 'pmb-input',
              value: kindMode,
              disabled: busy,
              onChange: (ev) => setKindMode(ev.target.value),
              style: { width: 'auto', minWidth: '132px' },
            },
              h('option', { value: 'event' }, '摘要与事件（' + String(allEntries.filter((it) => it.kind !== 'turn').length) + '）'),
              h('option', { value: 'raw' }, '原始回合（' + String(allEntries.filter((it) => it.kind === 'turn').length) + '）'),
              h('option', { value: 'all' }, '全部（' + String(allEntries.length) + '）'),
            ),
            h('input', {
              className: 'pmb-search',
              type: 'search',
              placeholder: '搜文字或 hash',
              value: query,
              disabled: busy,
              onChange: (ev) => setQuery(ev.target.value),
            }),
            h('button', { className: 'pmb-btn', disabled: busy, onClick: () => setNewestFirst(!newestFirst) }, newestFirst ? '新的在前' : '旧的在前'),
            dayGroups.length > 1
              ? h('button', { className: 'pmb-btn', disabled: busy, onClick: () => toggleAllDays() }, allDaysOpen ? '全部收起' : '全部展开')
              : null)),
        // 事件层还没做：条目几乎全是原始回合时，说清楚为什么这页看起来这么空
        kindMode === 'event' && allEntries.length > 0 && allEntries.length - hiddenByKind <= Math.max(2, allEntries.length * 0.1)
          ? h('div', { className: 'pmb-line' },
              h('div', { className: 'pmb-line-main' },
                h('div', { className: 'pmb-line-note' },
                  '这个会话 ' + String(allEntries.length) + ' 条里只有 ' + String(allEntries.length - hiddenByKind) +
                    ' 条是摘要/事件——事件条目要等 0.30 数据层（同话题多回合合成一条）。现在可以先切到「原始回合」。')))
          : null,
        allEntries.length === 0
          ? h(NOTE, null, data ? '这个会话还没有片段（回合要跑过才写，或者本会话还没触发过摘要）。' : '读不到会话记忆接口。')
          : entries.length === 0
            ? h(NOTE, null,
                hiddenByKind > 0 && !q
                  ? '这个会话只有原始回合（' + String(hiddenByKind) + ' 条），还没有摘要或事件条目。切到「原始回合」就能看到它们。'
                  : '没有匹配「' + query.trim() + '」的片段。')
            : h('div', { className: 'pmb-list' },
                dayGroups.map((g) => {
                  const open = isDayOpen(g.key)
                  return h('div', { key: 'day-' + g.key, className: 'pmb-day' },
                    h('div', {
                      className: 'pmb-day-head',
                      role: 'button',
                      tabIndex: 0,
                      onClick: () => toggleDay(g.key),
                      onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleDay(g.key) } },
                    },
                      h('span', { className: 'pmb-day-arrow' }, open ? '▾' : '▸'),
                      h('span', { className: 'pmb-day-label' }, g.label),
                      h('span', { className: 'pmb-sub' }, String(g.items.length) + ' 条'),
                      open ? null : h('span', { className: 'pmb-hint' }, '点开'),
                    ),
                    open
                      ? h('div', { className: 'pmb-day-body' },
                          g.items.map((it) => {
                            const isSuppressed = suppressedSet.has(it.hash)
                            const isOpen = openHash === it.hash
                            const isMenu = menuHash === it.hash
                            return h('div', { key: it.hash || it.ts, className: 'pmb-item', 'data-pmb-hash': String(it.hash || it.ts) },
                              h('div', { className: 'pmb-item-head' },
                                h('span', { className: 'pmb-v', title: fmtLocal(it.ts) }, relTime(it.ts) || fmtLocal(it.ts)),
                                h('span', { className: 'pmb-tag' }, it.kind === 'auto-summary' ? '摘要' : '对话'),
                                it.kind === 'auto-summary' && it.reason ? h('span', { className: 'pmb-tag' }, reasonLabel(it.reason)) : null,
                                isSuppressed ? h('span', { className: 'pmb-tag pmb-tag-warn' }, '已屏蔽') : null,
                                h('span', { className: 'pmb-sub', title: it.hash }, String(it.hash || '').slice(0, 10)),
                                h('div', { className: 'pmb-line-ctl' },
                                  h('button', { className: 'pmb-btn', disabled: busy, onClick: () => setMenuHash(isMenu ? '' : it.hash) }, isMenu ? '收起' : '⋯'))),
                              isMenu
                                ? h('div', { className: 'pmb-row' },
                                    h('button', { className: 'pmb-btn', disabled: busy, onClick: () => setOpenHash(isOpen ? '' : it.hash) }, isOpen ? '收起正文' : '展开正文'),
                                    isSuppressed
                                      ? h('button', { className: 'pmb-btn', disabled: busy, onClick: () => act('session-unsuppress', { hashes: [it.hash] }, '已解除屏蔽') }, '解除屏蔽')
                                      : h('button', { className: 'pmb-btn', disabled: busy, onClick: () => act('session-suppress', { hashes: [it.hash] }, '已屏蔽，本会话不再注入') }, '屏蔽这条'),
                                    h('button', {
                                      className: 'pmb-btn' + (confirmHash === it.hash ? ' pmb-btn-danger' : ''),
                                      disabled: busy,
                                      onClick: () => askDelete(it.hash),
                                    }, confirmHash === it.hash ? '确认删除？' : '删掉这条'))
                                : null,
                              h('div', { className: 'pmb-item-text' + (isOpen ? ' pmb-open' : '') }, it.summary || ''),
                            )
                          }),
                        )
                      : null,
                  )
                }),
              ),
        hasMore || loadingMore
          ? h('div', { className: 'pmb-line' },
              h('div', { className: 'pmb-line-main' },
                h('div', { className: 'pmb-line-note' }, '更早的还没拉：数据都在，只是没显示')),
              h('div', { className: 'pmb-line-ctl' },
                h('button', { className: 'pmb-btn', disabled: busy || loadingMore, onClick: () => loadMore() },
                  loadingMore ? '加载中…' : '加载更早（还有 ' + String(Math.max(0, total - allEntries.length)) + ' 条）')))
          : null,
      )

      return h('div', { className: 'pmb' },
        head,
        error ? h('div', { className: 'pmb-err' }, error) : null,
        notice ? h('div', { className: 'pmb-ok' }, notice) : null,
        sessionSec,
        blockSec,
        entriesSec,
      )
    }

    // ---------------------------------------------------------------
    // 页：值班台（sidebar「更多」入口 + 独立主面板 key = puppet-duty-board）
    // ---------------------------------------------------------------
    function DutyBoardPanel() {
      const { useState, useEffect, useCallback } = React
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const load = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const res = await callApi('duty-board')
          if (!res || res.ok !== true) throw new Error((res && res.error) || '读取值班台失败')
          setData(res)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }, [])
      useEffect(() => { load() }, [load])
      useEffect(() => {
        const t = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) load() }, 30000)
        return () => clearInterval(t)
      }, [load])


      const card = (title, rows, note) =>
        h('div', { className: 'pmb-card' },
          h('div', { className: 'pmb-title' }, title),
          h('div', { className: 'pmb-grid' }, rows.map((r) => h('div', { key: r[0], className: 'pmb-kv' }, h('div', { className: 'pmb-k' }, r[0]), h('div', { className: 'pmb-v' }, String(r[1]))))),
          note ? h('div', { className: 'pmb-sub' }, note) : null)

      const qq = (data && data.qq) || {}
      const bili = (data && data.bili) || {}
      const quota = qq.quota || {}

      return h('div', { className: 'pmb-page' },
        h('div', { className: 'pmb-page-inner' },
        h('div', { className: 'pmb' },
        h('div', { className: 'pmb-head' },
          h('div', { className: 'pmb-title' }, '值班台'),
          h('div', { className: 'pmb-sub' }, '两样心跳：QQ 观察器 / B站值班。记忆的去设置页「记忆设置」看。每 30 秒自动刷新。'),
        ),
        error ? h('div', { className: 'pmb-err' }, error) : null,
        h('div', { className: 'pmb-actions' },
          h('button', { className: 'pmb-btn', disabled: busy, onClick: () => load() }, busy ? '读取中…' : '刷新'),
          data ? h('span', { className: 'pmb-sub' }, '更新于 ' + fmtLocal(data.at)) : null,
        ),
        card('QQ 观察器', [
          ['今日额度', (quota.sent || 0) + ' / ' + (quota.max || '-')],
          ['观察器 pid', qq.watcherPid || '（无）'],
          ['最近扫描', qq.lastScan ? String(qq.lastScan).slice(0, 90) : '（暂无）'],
          // 开机自启那一行以前把 boot.log 整条怼进来（含暂停原因长句），面板被撑开还容易被误读；
          // 现在只留「时间 + 前 28 字」摘要，完整内容去 ~/.dsh/qq-watch/boot.log 看。
          ['开机自启', qq.lastBoot ? (String(qq.lastBoot).length > 34 ? String(qq.lastBoot).slice(0, 34) + '…' : String(qq.lastBoot)) : '（暂无）'],
        ], (qq.alert ? ('⚠️ 有未清告警：' + qq.alert.ago + '，连续失败 ' + qq.alert.failures + ' 次') : '无未清告警') + ' ｜ 日志 ~/.dsh/qq-watch/'),
        card('B站值班', [
          ['配置', bili.configured ? '已配置' : '未配置'],
          ['最近报告', bili.lastReport ? (bili.lastReport.file + '（' + bili.lastReport.ago + '）') : '（还没跑过）'],
          ['最近日志', bili.lastLog ? String(bili.lastLog).slice(0, 90) : '（暂无）'],
        ], '报告在 ~/.dsh/bili-duty/out/'),
        )))
    }

    // 侧栏面板图标（sidebar.panellist 的 occupant 只画图标，label 由宿主读注册项）
    function DutyBoardIcon(props) {
      const size = (props && typeof props.size === 'number') ? props.size : 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', style: { display: 'block' },
      },
      h('rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 2.6, stroke: 'currentColor', strokeWidth: 1.2 }),
      h('path', { d: 'M4.9 6.1h3.4M4.9 8.5h2.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      h('path', { d: 'M9.2 9.4l1.3 1.4 2.1-2.4', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    // 侧栏「更多」里的一行：打开值班台 + 固定/收起。
    // 行必须用宿主的 MenuItemButton 画，否则放进菜单里就是一块白底按钮；
    // 固定状态和打开动作都走 owner props（entries/pinned/onOpen/onPinnedChange）。
    function DutyBoardMenuRow(props) {
      const MenuItemButton = primitives && primitives.MenuItemButton
      const IconCheck = primitives && primitives.IconCheckOutlineRegular
      const list = (props && props.entries) || []
      const mine = list.find((entry) => entry && entry.id === 'puppet-duty-board') ||
        { id: 'puppet-duty-board', label: '值班台', pinned: true, active: false }
      const openPanel = () => {
        if (props && props.onDismiss) props.onDismiss()
        if (props && props.onOpen) props.onOpen('puppet-duty-board')
      }
      const togglePin = () => {
        if (props && props.onPinnedChange) props.onPinnedChange('puppet-duty-board', !mine.pinned)
      }
      const row = (label, onSelect, icon) => MenuItemButton
        ? h(MenuItemButton, icon ? { onSelect, icon } : { onSelect }, label)
        : h('button', {
          type: 'button', className: 'pmb-btn',
          style: { width: '100%', textAlign: 'left' },
          onClick: onSelect,
        }, label)
      return h(React.Fragment, null,
        row(mine.active === true ? '值班台（当前页）' : '打开值班台', openPanel,
          IconCheck ? h(IconCheck, { size: 16, style: { opacity: mine.pinned ? 1 : 0 } }) : null),
        row(mine.pinned ? '值班台：收进「更多」' : '值班台：固定到侧栏', togglePin))
    }

    // ---------------------------------------------------------------
    // v0.46.0：插件更新（只查不装）
    // 仅打开本页或保存到期设置时自动检查；手动检查可绕过间隔，无后台定时器。
    // ---------------------------------------------------------------
    function UpdatePanel() {
      const { useState, useEffect, useCallback, useRef } = React
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const pending = useRef(null)

      const run = useCallback((work) => {
        if (pending.current) return pending.current
        setBusy(true)
        setError('')
        const task = (async () => {
          try { await work() }
          catch (err) { setError(err && err.message ? err.message : String(err)) }
        })().finally(() => {
          pending.current = null
          setBusy(false)
        })
        pending.current = task
        return task
      }, [])

      const check = useCallback(async (force) => {
        const res = await callApi('update-check', { force })
        if (res && res.currentVersion !== undefined) setData(res)
        if (!res || (res.ok !== true && !res.skipped)) throw new Error((res && (res.error || res.message)) || '检查失败')
      }, [])

      const load = useCallback(() => run(async () => {
        const res = await callApi('update-state')
        if (!res || res.ok !== true) throw new Error((res && res.error) || '读取失败')
        setData(res)
        if (res.enabled && res.due) await check(false)
      }), [run, check])

      useEffect(() => { load() }, [load])

      const save = (patch) => run(async () => {
        const res = await callApi('update-configure', patch)
        if (!res || res.ok !== true) throw new Error((res && res.error) || '保存失败')
        setData(res)
        if (res.enabled && res.due) await check(false)
      })

      const checkNow = () => run(() => check(true))

      if (error && !data) return h('div', { className: 'pmb' },
        h('div', { className: 'pmb-error' }, error),
        h('button', { type: 'button', className: 'pmb-btn', disabled: busy, onClick: load }, '重试'))
      if (!data) return h('div', { className: 'pmb' }, h('div', { className: 'pmb-hint' }, '读取中…'))

      const latest = data.latest
      const status = data.lastError ? '检查失败，以下为上次结果' : data.hasUpdate
        ? '有新版本 ' + latest.version
        : (latest ? '未发现更新' : '还没查过')
      const name = 'pmb-update'
      return h('div', { className: 'pmb', id: name },
        h('div', { className: 'pmb-title' }, '插件更新'),
        h('div', { className: 'pmb-hint' }, '只查 GitHub 上的稳定版，只显示版本号和链接；不会下载、也不会替换插件。'),
        h('div', { className: 'pmb-card' },
          h(Row, { label: '当前版本' }, h('div', null, data.currentVersion || '(未读到)')),
          h(Row, { label: '最新版' }, h('div', null,
            status,
            latest && latest.url
              ? h('a', { href: latest.url, target: '_blank', rel: 'noreferrer', style: { marginLeft: '8px' } }, '打开 Release')
              : null,
          )),
          h(Row, { label: '自动检查' },
            h('button', {
              type: 'button', className: 'pmb-btn', disabled: busy,
              onClick: () => save({ enabled: data.enabled !== true }),
            }, data.enabled === true ? '开' : '关'),
            h('span', { className: 'pmb-hint' }, '每'),
            h('select', {
              className: 'pmb-input', value: String(data.intervalDays || 7), disabled: busy,
              onChange: (e) => save({ intervalDays: Number(e.target.value) }),
            }, Array.from({ length: 30 }, (_, i) => i + 1).map((d) => h('option', { key: d, value: String(d) }, d + ' 天'))),
            h('span', { className: 'pmb-hint' }, '查一次'),
          ),
          h(Row, { label: '上次检查' },
            h('div', null, data.lastCheckedAt ? relTime(data.lastCheckedAt) : '还没查过'),
            data.nextCheckAt ? h('span', { className: 'pmb-hint', style: { marginLeft: '8px' } }, '（下次约 ' + fmtLocal(data.nextCheckAt) + '）') : null,
          ),
          data.lastError ? h(Row, { label: '上次错误' }, h('div', { className: 'pmb-error' }, data.lastError)) : null,
          h('div', { className: 'pmb-actions' },
            h('button', { type: 'button', className: 'pmb-btn', disabled: busy, onClick: checkNow },
              busy ? '检查中…' : '立即检查'),
            h('span', { className: 'pmb-hint' }, '检查完只看结果，装不装由你决定。'),
          ),
        ),
        error ? h('div', { className: 'pmb-error' }, error) : null,
      )
    }
    function apply(ctx) {
      if (typeof document !== 'undefined') {
        const style = document.createElement('style')
        style.dataset.dshPuppetMemoryBackup = '1'
        style.textContent = CSS
        document.head.appendChild(style)
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => () => style.remove(), 'dsh-puppet-memory: 面板样式')
        }
      }
      const slots = typeof ctx.get === 'function' ? ctx.get('slots') : ctx.slots
      if (slots === undefined || slots === null) return
      slots.inject('settings.section', () => {
        // 两个独立设置页：一个页面一个 list 条目，互不挤在一起
        // v1.1：四个页面合并成一页（顶部 tab 切换），设置列表里只占一行
        slots.register(
          { name: 'settings.section', id: 'puppet-memory', order: 25, label: '记忆设置' },
          (props) => h(MemorySettingsPanel, props),
        )

        // v0.49.x（2026-11-21 丹阳定）：插件更新并进「记忆设置」的第五个 tab，不再单独占侧栏一行

        // 值班台：侧栏面板行（sidebar.panellist 才进侧栏列表、才有固定状态）
        slots.inject('sidebar.panellist', () => slots.register(
          { name: 'sidebar.panellist', id: 'puppet-duty-board', order: 40, label: '值班台' },
          DutyBoardIcon,
        ))
        // 「更多」菜单里的入口，行样式用宿主原语
        slots.inject('sidebar.panellist.actions', () => slots.register(
          { name: 'sidebar.panellist.actions', id: 'puppet-duty-board.actions', order: 40, label: '值班台' },
          DutyBoardMenuRow,
        ))
        // 面板本体：main 是 keyed slot，key 必须与上面 id 一致
        slots.inject('main', () => slots.register(
          { name: 'main', key: 'puppet-duty-board' },
          DutyBoardPanel,
        ))
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
