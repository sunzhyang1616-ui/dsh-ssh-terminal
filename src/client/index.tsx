import { createElement, useState, useEffect, useRef } from 'react'

const API = '/ssh-terminal/api'

function fmt(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

const SSH_CSS = `
.dshssh-body{display:flex;flex-direction:column;gap:8px;height:100%;box-sizing:border-box;padding:10px;color:var(--dsw-alias-label-primary,inherit);}
.dshssh-head{display:flex;align-items:center;gap:8px;}
.dshssh-title{font-weight:700;flex:1;}
.dshssh-status{font-weight:600;}
.dshssh-status.ok{color:var(--dsw-alias-state-success-primary,#22c55e);}
.dshssh-status.off{color:var(--dsw-alias-label-tertiary,#94a3b8);}
.dshssh-layout{display:flex;gap:8px;flex:1;min-height:0;}
.dshssh-sessions{width:150px;min-width:125px;display:flex;flex-direction:column;gap:6px;min-height:0;}
.dshssh-session-title{font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary,#d1d5db);}
.dshssh-session-list{display:flex;flex-direction:column;gap:5px;overflow:auto;min-height:0;}
.dshssh-session{display:flex;align-items:center;gap:6px;width:100%;padding:6px 7px;text-align:left;border-radius:7px;border:1px solid transparent;background:var(--dsw-alias-bg-layer-2,rgba(148,163,184,.08));color:var(--dsw-alias-label-primary,inherit);cursor:pointer;font-size:11px;}
.dshssh-session:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(148,163,184,.15));}
.dshssh-session.selected{border-color:var(--dsw-alias-accent,#60a5fa);}
.dshssh-session-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#94a3b8);}
.dshssh-session-dot.ok{background:var(--dsw-alias-state-success-primary,#22c55e);}
.dshssh-session-copy{min-width:0;display:flex;flex-direction:column;gap:2px;}
.dshssh-session-name,.dshssh-session-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dshssh-session-name{font-weight:600;}
.dshssh-session-meta{color:var(--dsw-alias-label-tertiary,#94a3b8);font-size:10px;}
.dshssh-empty{padding:6px;color:var(--dsw-alias-label-tertiary,#94a3b8);font-size:11px;}
.dshssh-main{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0;min-height:0;}
.dshssh-form{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.dshssh-input{padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(148,163,184,.4));background:var(--dsw-alias-bg-layer-3,rgba(2,6,23,.5));color:var(--dsw-alias-label-primary,inherit);font-size:12px;min-width:70px;}
.dshssh-input::placeholder{color:var(--dsw-alias-label-tertiary,#94a3b8);}
.dshssh-btn{padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(148,163,184,.4));background:var(--dsw-alias-interactive-bg-hover,rgba(148,163,184,.15));color:var(--dsw-alias-label-primary,inherit);cursor:pointer;font-size:12px;}
.dshssh-btn:hover{background:var(--dsw-alias-interactive-bg-active,rgba(148,163,184,.28));}
.dshssh-btn:disabled{opacity:.5;cursor:default;}
.dshssh-log{flex:1;min-height:120px;overflow:auto;background:var(--dsw-alias-bg-layer-1,rgba(2,6,23,.55));border:1px solid var(--dsw-alias-border-l2,rgba(148,163,184,.25));border-radius:8px;padding:8px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
.dshssh-step{margin:0 0 6px;}
.dshssh-cmd{color:var(--dsw-alias-accent,#93c5fd);}
.dshssh-cmd::before{content:"❯ ";color:var(--dsw-alias-accent,#60a5fa);}
.dshssh-out{color:var(--dsw-alias-label-secondary,#d1d5db);}
.dshssh-connect{color:var(--dsw-alias-state-success-primary,#86efac);}
.dshssh-disconnect{color:var(--dsw-alias-state-error-primary,#fca5a5);}
.dshssh-system{color:var(--dsw-alias-label-tertiary,#94a3b8);font-style:italic;}
.dshssh-err{color:var(--dsw-alias-state-error-primary,#fca5a5);}
`

async function callApi(action, extra = undefined) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...(extra || {}) }),
  })
  return await res.json()
}

function injectCss() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="dsh-ssh-terminal"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-ssh-terminal'
  tag.dataset.pluginCss = 'dsh-ssh-terminal'
  tag.textContent = SSH_CSS
  document.head.appendChild(tag)
}

function SshBody(props) {
  const ctx = props.ctx
  const visible = props.visible === undefined ? true : props.visible
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hostV, setHostV] = useState('')
  const [userV, setUserV] = useState('')
  const [portV, setPortV] = useState('22')
  const [passV, setPassV] = useState('')
  const [cmdV, setCmdV] = useState('')
  const [sessions, setSessions] = useState([])
  const [connectionId, setConnectionId] = useState('')
  const [connected, setConnected] = useState(false)
  const [target, setTarget] = useState('')
  const [steps, setSteps] = useState([])
  const [logEl, setLogEl] = useState(null)
  const refreshSeq = useRef(0)

  const selectedSession = sessions.find((s) => s.connectionId === connectionId)
  const canRun = connected && !!selectedSession && !!selectedSession.connected

  async function refresh(preferredId) {
    const seq = ++refreshSeq.current
    try {
      const list = await callApi('list')
      if (seq !== refreshSeq.current) return
      const nextSessions = Array.isArray(list && list.sessions) ? list.sessions : []
      setSessions(nextSessions)
      const preferred = preferredId || connectionId
      const selected = nextSessions.some((s) => s.connectionId === preferred)
        ? preferred
        : (list && list.activeConnectionId && nextSessions.some((s) => s.connectionId === list.activeConnectionId)
          ? list.activeConnectionId
          : ((nextSessions.find((s) => s.connected) || nextSessions[0] || {}).connectionId || ''))
      if (selected !== connectionId) setConnectionId(selected)
      if (!selected) {
        if (seq !== refreshSeq.current) return
        setConnected(false)
        setTarget('')
        setSteps([])
        return
      }
      const t = await callApi('status', { connectionId: selected })
      if (seq !== refreshSeq.current) return
      setConnected(!!(t && t.connected))
      setTarget((t && t.target) || '')
      setSteps((t && t.steps) || [])
    } catch (e) {}
  }

  useEffect(() => {
    injectCss()
    if (visible === false) { refreshSeq.current += 1; return }
    refresh(connectionId)
    const stop = ctx.interval(() => refresh(connectionId), 600)
    return () => {
      refreshSeq.current += 1
      try { stop() } catch (e) {}
    }
  }, [visible, connectionId])

  useEffect(() => {
    const el = logEl
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [steps, logEl])

  async function connect() {
    setBusy(true); setErr('')
    try {
      const r = await callApi('connect', { host: hostV, user: userV, port: Number(portV) || 22, password: passV || undefined })
      if (r && r.error) setErr(String(r.error))
      await refresh(r && r.connectionId)
    }
    catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
  }
  async function run() {
    setBusy(true); setErr('')
    try {
      const r = await callApi('exec', { connectionId, command: cmdV, waitMs: 15000 })
      if (r && r.error) setErr(String(r.error))
      await refresh(connectionId)
    }
    catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true); setErr('')
    try { await callApi('disconnect', { connectionId }); await refresh(connectionId) }
    catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
  }
  async function clearHistory() {
    try {
      if (window.confirm('确定清空当前连接的 SSH 操作记录吗？')) {
        await callApi('clear', connectionId ? { connectionId } : undefined)
        await refresh(connectionId)
      }
    } catch (e) { setErr(String((e && e.message) || e)) }
  }

  const onKey = (e) => { if (e.key === 'Enter' && canRun && !busy) run() }
  const status = connected ? ('● ' + target) : (selectedSession ? (selectedSession.exited ? '○ 已退出' : '○ 未连接') : '○ 未选择连接')

  return createElement('div', { className: 'dshssh-body' },
    createElement('div', { className: 'dshssh-head' },
      createElement('span', { className: 'dshssh-title' }, 'SSH 远程终端'),
      createElement('span', { className: 'dshssh-status ' + (connected ? 'ok' : 'off') }, status),
      createElement('button', { className: 'dshssh-btn dshssh-clear', onClick: clearHistory }, '清空当前'),
    ),
    createElement('div', { className: 'dshssh-layout' },
      createElement('div', { className: 'dshssh-sessions' },
        createElement('div', { className: 'dshssh-session-title' }, '连接列表 (' + sessions.length + ')'),
        createElement('div', { className: 'dshssh-session-list' },
          sessions.length
            ? sessions.map((s) => createElement('button', {
              key: s.connectionId,
              className: 'dshssh-session' + (s.connectionId === connectionId ? ' selected' : ''),
              onClick: () => { setConnectionId(s.connectionId); setErr('') },
            },
            createElement('span', { className: 'dshssh-session-dot' + (s.connected ? ' ok' : '') }),
            createElement('span', { className: 'dshssh-session-copy' },
              createElement('span', { className: 'dshssh-session-name' }, s.label || s.target || 'SSH 连接'),
              createElement('span', { className: 'dshssh-session-meta' }, s.connected ? (s.busy ? '执行中' : '已连接') : (s.historical ? '历史记录' : '已断开')),
            )))
            : createElement('div', { className: 'dshssh-empty' }, '暂无连接'),
        ),
      ),
      createElement('div', { className: 'dshssh-main' },
        createElement('div', { className: 'dshssh-form' },
          createElement('input', { className: 'dshssh-input', placeholder: '主机', value: hostV, onChange: (e) => setHostV(e.target.value) }),
          createElement('input', { className: 'dshssh-input', placeholder: '用户', value: userV, onChange: (e) => setUserV(e.target.value) }),
          createElement('input', { className: 'dshssh-input', style: { width: 54 }, placeholder: '端口', value: portV, onChange: (e) => setPortV(e.target.value) }),
          createElement('input', { className: 'dshssh-input', style: { width: 96 }, type: 'password', placeholder: '密码(可选)', value: passV, onChange: (e) => setPassV(e.target.value) }),
          createElement('button', { className: 'dshssh-btn', disabled: busy, onClick: connect }, '新建连接'),
        ),
        createElement('div', { className: 'dshssh-form' },
          createElement('input', { className: 'dshssh-input dshssh-cmdline', style: { flex: 1 }, placeholder: '输入命令后回车或点执行', value: cmdV, onChange: (e) => setCmdV(e.target.value), onKeyDown: onKey }),
          createElement('button', { className: 'dshssh-btn', disabled: busy || !canRun, onClick: run }, '执行'),
          createElement('button', { className: 'dshssh-btn', disabled: busy || !canRun, onClick: disconnect }, '断开'),
        ),
        createElement('div', { className: 'dshssh-log', ref: (el) => setLogEl(el) },
          steps.length
            ? steps.map((s, i) => createElement('div', { key: i, className: 'dshssh-step dshssh-' + s.kind }, (fmt(s.ts) + '  ' + s.text)))
            : createElement('div', { className: 'dshssh-step dshssh-system' }, '还没有操作。'),
        ),
        err ? createElement('div', { className: 'dshssh-err' }, String(err)) : null,
      ),
    ),
  )
}

export const inject = ['timer', 'betterSidebar']

export function apply(ctx) {
  const bs = ctx.get('betterSidebar')
  if (!bs) return
  ctx.effect(() => bs.registerTab({
    id: 'ssh-remote:terminal',
    title: 'SSH 终端',
    order: 60,
    single: true,
    component: (p) => createElement(SshBody, { ctx, visible: p.visible }),
  }))
}
