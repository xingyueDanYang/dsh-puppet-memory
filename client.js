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
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const [res, factRes] = await Promise.all([callApi('status'), callApi('fact-candidates')])
          if (!res || res.ok !== true) throw new Error((res && res.error) || '读取备份策略失败')
          setData(res)
          setForm(formFromConfig(res.config))
          if (factRes && factRes.ok === true) setFacts(factRes)
          else setFacts({ ok: false, items: [], pending: 0, error: (factRes && factRes.error) || '接口不可用' })
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

      const runtime = (data && data.runtime) || {}
      const config = (data && data.config) || {}

      const actions = h(
        Actions,
        null,
        h('button', { className: 'pmb-btn pmb-btn-primary', disabled: busy || !form, onClick: save }, busy ? '处理中…' : '保存设置'),
        h('button', { className: 'pmb-btn', disabled: busy, onClick: backupNow }, '立即备份一次'),
        h('button', { className: 'pmb-btn', disabled: busy, onClick: load }, '刷新'),
      )

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
            h(NOTE, null, '深层记忆与图片/音频资产始终会备份；「行为记忆」是 relations / user / memo / notes / diary / sources / persona。'),
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
        policyCard,
        compactionCard,
        factCard,
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
      const entries = allEntries
        .filter((it) => !q || String(it.summary || '').toLowerCase().includes(q) || String(it.hash || '').toLowerCase().includes(q))
        .slice()
        .sort((a, b) => (newestFirst ? String(b.ts).localeCompare(String(a.ts)) : String(a.ts).localeCompare(String(b.ts))))
      const hiddenByFilter = allEntries.length - entries.length
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
            h('div', { className: 'pmb-line-label' }, '找一条'),
            h('div', { className: 'pmb-line-note' }, hiddenByFilter > 0 ? '筛掉 ' + String(hiddenByFilter) + ' 条' : '搜文字或 hash；一页 100 条，更早的往下翻')),
          h('div', { className: 'pmb-line-ctl' },
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
        allEntries.length === 0
          ? h(NOTE, null, data ? '这个会话还没有片段（回合要跑过才写，或者本会话还没触发过摘要）。' : '读不到会话记忆接口。')
          : entries.length === 0
            ? h(NOTE, null, '没有匹配「' + query.trim() + '」的片段。')
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
        slots.register(
          { name: 'settings.section', id: 'puppet-backup', order: 26, label: '记忆备份' },
          () => h(BackupPanel),
        )
        slots.register(
          { name: 'settings.section', id: 'puppet-autosummary', order: 27, label: '自动摘要' },
          () => h(AutoSummaryPanel),
        )
        // v0.28：脏记忆的会话级隔离——屏蔽只影响本会话注入，删除只动本会话片段（先归档）
        slots.register(
          { name: 'settings.section', id: 'puppet-session', order: 28, label: '会话记忆' },
          () => h(SessionMemoryPanel),
        )
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
