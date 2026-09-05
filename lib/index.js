// dsh-ssh-terminal — Host half
// Open one isolated interactive SSH session per connectionId, expose agent
// tools (via the tools service) and an HTTP route (via webServer) that the
// better-sidebar tab uses for connect/exec/disconnect/status.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const inject = ['timer', 'subprocess', 'webServer', 'tools']

export function apply(ctx) {
  const fs = ctx.get('fs')
  const sessions = new Map()
  const connectionMeta = new Map()
  const HISTORY_PATH = join(homedir(), '.dsh', 'ssh-terminal-history.json')
  const MAX_HISTORY = 1200
  const MAX_STEPS = 600
  const LEGACY_SESSION_ID = 'legacy'
  let history = []
  const pinnedConnectionIds = new Set()
  try {
    const raw = readFileSync(HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    const entries = Array.isArray(parsed) ? parsed : parsed && parsed.events
    if (!Array.isArray(parsed) && parsed && Array.isArray(parsed.pinnedConnectionIds)) {
      for (const connectionId of parsed.pinnedConnectionIds) {
        if (connectionId) pinnedConnectionIds.add(String(connectionId))
      }
    }
    if (Array.isArray(entries)) {
      history = entries.map((entry) => ({
        connectionId: entry && entry.connectionId ? String(entry.connectionId) : LEGACY_SESSION_ID,
        kind: entry && entry.kind ? String(entry.kind) : 'system',
        text: entry && entry.text != null ? String(entry.text) : '',
        ts: entry && Number(entry.ts) ? Number(entry.ts) : Date.now(),
        ...(entry && entry.target ? { target: String(entry.target) } : {}),
        ...(entry && entry.label ? { label: String(entry.label) } : {}),
      }))
    }
  } catch (e) {}
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)

  let activeSessionId = null
  let lastTarget = ''
  function persist() {
    try {
      mkdirSync(dirname(HISTORY_PATH), { recursive: true })
      writeFileSync(HISTORY_PATH, JSON.stringify({ version: 2, events: history, pinnedConnectionIds: Array.from(pinnedConnectionIds) }))
    } catch (e) {}
  }

  function ensureMeta(connectionId) {
    let meta = connectionMeta.get(connectionId)
    if (!meta) {
      meta = { connectionId, target: '', label: '', connected: false, pinned: pinnedConnectionIds.has(connectionId), lastActivityAt: 0 }
      connectionMeta.set(connectionId, meta)
    }
    return meta
  }

  for (const event of history) {
    const meta = ensureMeta(event.connectionId)
    if (event.target) meta.target = event.target
    if (event.label) meta.label = event.label
    meta.lastActivityAt = Math.max(meta.lastActivityAt, event.ts)
    meta.connected = false
  }

  function cleanStream(s) {
    s = String(s)
    s = s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    s = s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    s = s.replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    return s
  }

  function appendStep(connectionId, kind, text, extra) {
    const event = {
      connectionId: connectionId || LEGACY_SESSION_ID,
      kind,
      text: String(text),
      ts: Date.now(),
      ...(extra && extra.target ? { target: String(extra.target) } : {}),
      ...(extra && extra.label ? { label: String(extra.label) } : {}),
    }
    history.push(event)
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)

    const meta = ensureMeta(event.connectionId)
    if (event.target) meta.target = event.target
    if (event.label) meta.label = event.label
    meta.lastActivityAt = event.ts
    if (kind === 'connect') meta.connected = true
    if (kind === 'disconnect') meta.connected = false
    persist()
  }

  function startDrain(s) {
    const decoder = new TextDecoder()
    const run = (async () => {
      try {
        for await (const chunk of s.handle.output) {
          if (s.drainState.stopped || sessions.get(s.connectionId) !== s) break
          const text = cleanStream(decoder.decode(chunk, { stream: true }))
          if (!text) continue
          s.log += text
          s.lastActivityAt = Date.now()
          tryPassword(s)
        }
      } catch (e) { try { console.error('ssh output stream error', e) } catch (e2) {} }
      if (sessions.get(s.connectionId) === s && !s.drainState.stopped) {
        s.exited = true
        s.connected = false
        const meta = ensureMeta(s.connectionId)
        meta.connected = false
        meta.lastActivityAt = Date.now()
      }
    })()
    return run
  }

  function tail(s, n) { return s ? s.log.slice(-n) : '' }

  function tryPassword(s) {
    if (!s || !s.passwordPending || s.passwordSent) return
    const t = s.log.trimEnd()
    if (/password\s*:\s*$/i.test(t) || /password.*:\s*$/i.test(t.slice(-90))) {
      const p = s.passwordPending
      s.passwordPending = null
      s.passwordSent = true
      if (s.handle) s.handle.write(p + '\n').catch(() => {})
    }
  }

  function makeConnectionId() { return 'ssh-' + randomUUID() }

  function resolveConnectionId(value, allowHistorical) {
    const requested = value == null || value === '' ? null : String(value)
    if (requested) {
      if (sessions.has(requested)) return requested
      if (allowHistorical && connectionMeta.has(requested)) return requested
      throw new Error('unknown SSH connection: ' + requested)
    }

    const active = activeSessionId ? sessions.get(activeSessionId) : null
    if (active && (allowHistorical || (active.connected && !active.exited))) return activeSessionId
    for (const [connectionId, s] of sessions) {
      if (s.connected && !s.exited) {
        activeSessionId = connectionId
        return connectionId
      }
    }
    return null
  }

  async function doConnect(opts) {
    opts = opts || {}
    const host = opts.host, user = opts.user, port = opts.port || 22
    if (!host || !user) throw new Error('ssh_connect requires host and user')

    const connectionId = opts.connectionId ? String(opts.connectionId) : makeConnectionId()
    if (sessions.has(connectionId)) await doDisconnect(connectionId)

    let sshBin = 'ssh'
    try { sshBin = await ctx.subprocess.resolveExecutable('ssh') }
    catch (e) { throw new Error('ssh executable not found: ' + ((e && e.message) || e)) }
    const argv = [sshBin, '-tt', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20']
    if (port && String(port) !== '22') argv.push('-p', String(port))
    if (opts.identity) argv.push('-i', String(opts.identity))
    argv.push(user + '@' + host)
    let cwd = '.'
    try {
      if (fs) { const t = await fs.resolve('.', {}); const p = fs.processPath(t); if (p) cwd = p }
    } catch (e) {}
    let handle
    try { handle = await ctx.subprocess.spawnTerminal({ argv, cwd, rows: 30, cols: 120, graceMs: 5000 }) }
    catch (e) { throw new Error('failed to spawn ssh: ' + ((e && e.message) || e)) }

    const target = user + '@' + host + (String(port) !== '22' ? ':' + port : '')
    const label = opts.label ? String(opts.label) : ''
    const drainState = { stopped: false }
    const s = {
      connectionId,
      label,
      handle,
      log: '',
      lastActivityAt: Date.now(),
      target,
      connected: false,
      exited: false,
      exitCode: null,
      busy: false,
      queue: Promise.resolve(),
      passwordPending: opts.password || null, passwordSent: false,
      drainState,
    }
    sessions.set(connectionId, s)
    activeSessionId = connectionId
    lastTarget = target
    const meta = ensureMeta(connectionId)
    meta.target = target
    meta.label = label
    meta.connected = false
    meta.lastActivityAt = s.lastActivityAt

    s.drain = startDrain(s)
    Promise.resolve(handle.done).then((o) => {
      if (sessions.get(connectionId) !== s) return
      s.exited = true
      s.connected = false
      s.exitCode = o && o.exitCode
      const currentMeta = ensureMeta(connectionId)
      currentMeta.connected = false
      currentMeta.lastActivityAt = Date.now()
    }).catch(() => {
      if (sessions.get(connectionId) !== s) return
      s.exited = true
      s.connected = false
      ensureMeta(connectionId).connected = false
    })

    appendStep(connectionId, 'system', 'Connecting to ' + target + ' ...', { target, label })
    const start = Date.now()
    let ready = false
    let lateFail = null
    while (Date.now() - start < 25000) {
      if (sessions.get(connectionId) !== s) throw new Error('SSH connection was closed')
      if (s.exited) break
      tryPassword(s)
      const t = s.log.trimEnd()
      if (t.length > 0 && /[$#%>]\s*$/.test(t)) { ready = true; break }
      if (/PERMISSION DENIED|CONNECTION REFUSED|CONNECTION TIMED OUT|NO ROUTE TO HOST|HOST KEY VERIFICATION FAILED|TOO MANY AUTHENTICATION|AUTHENTICATION FAILED|UNABLE TO NEGOTIATE/.test(s.log.toUpperCase())) { lateFail = s.log; break }
      await ctx.timeout(250)
    }
    if (ready) {
      s.connected = true
      lastTarget = s.target
      meta.connected = true
      appendStep(connectionId, 'connect', 'Connected to ' + s.target, { target: s.target, label: s.label })
      return { ok: true, connectionId, label: s.label, target: s.target, connected: true, logLength: s.log.length, logTail: tail(s, 300) }
    }
    if (s.exited || lateFail) {
      const info = ((lateFail || tail(s, 400)) || 'host unreachable').trim()
      await doDisconnect(connectionId)
      throw new Error('SSH connection failed: ' + info)
    }
    s.connected = true
    lastTarget = s.target
    meta.connected = true
    appendStep(connectionId, 'connect', 'Connected to ' + s.target, { target: s.target, label: s.label })
    return { ok: true, connectionId, label: s.label, target: s.target, connected: true, logLength: s.log.length, logTail: tail(s, 300) }
  }

  function stripEcho(delta, cmd) {
    if (!cmd) return delta
    const nl = delta.indexOf('\n')
    if (nl >= 0) { const first = delta.slice(0, nl); if (first.indexOf(cmd) >= 0) return delta.slice(nl + 1) }
    else if (delta === cmd) return ''
    return delta
  }

  function enqueue(s, task) {
    const previous = s.queue || Promise.resolve()
    const current = previous.catch(() => {}).then(task)
    s.queue = current.catch(() => {})
    return current
  }

  async function doExecNow(s, command, opts) {
    if (sessions.get(s.connectionId) !== s || !s.connected || s.exited) throw new Error('no active SSH connection; call ssh_connect first')
    const waitMs = opts.waitMs && Number(opts.waitMs) > 0 ? Number(opts.waitMs) : 12000
    const idleMs = 700
    s.busy = true
    try {
      appendStep(s.connectionId, 'cmd', command, { target: s.target, label: s.label })
      const offset = s.log.length
      s.lastActivityAt = Date.now()
      try { await s.handle.write(command + '\n') }
      catch (e) { throw new Error('failed to write to SSH: ' + ((e && e.message) || e)) }
      const start = Date.now()
      while (Date.now() - start < waitMs) {
        await ctx.timeout(150)
        if (s.exited) break
        if (Date.now() - s.lastActivityAt >= idleMs && Date.now() - start >= 300) break
      }
      let delta = s.log.slice(offset)
      delta = stripEcho(delta, command)
      delta = delta.replace(/\r/g, '').replace(/[\t ]+$/gm, '').replace(/\s+$/, '')
      if (delta) appendStep(s.connectionId, 'out', delta, { target: s.target, label: s.label })
      return { ok: true, connectionId: s.connectionId, output: delta, exited: !!s.exited, exitCode: s.exitCode, logLength: s.log.length, logTail: tail(s, 300) }
    } finally {
      s.busy = false
    }
  }

  async function doExec(command, opts) {
    opts = opts || {}
    const cmd = String(command == null ? '' : command)
    if (!cmd) throw new Error('command is required')
    const connectionId = resolveConnectionId(opts.connectionId, false)
    const s = connectionId ? sessions.get(connectionId) : null
    if (!s) throw new Error('no active SSH connection; call ssh_connect first')
    return await enqueue(s, () => doExecNow(s, cmd, opts))
  }

  async function doDisconnect(requestedId) {
    const connectionId = resolveConnectionId(requestedId, true)
    if (!connectionId) return { ok: true, disconnected: false }
    const s = sessions.get(connectionId)
    if (!s) return { ok: true, connectionId, disconnected: false }

    appendStep(connectionId, 'disconnect', 'Disconnected from ' + s.target, { target: s.target, label: s.label })
    s.connected = false
    s.exited = true
    sessions.delete(connectionId)
    if (s.drainState) s.drainState.stopped = true
    if (activeSessionId === connectionId) {
      activeSessionId = null
      for (const [nextId, next] of sessions) {
        if (next.connected && !next.exited) { activeSessionId = nextId; break }
      }
    }
    const meta = ensureMeta(connectionId)
    meta.connected = false
    meta.lastActivityAt = Date.now()
    try { if (s.handle) await s.handle.terminate() } catch (e) {}
    return { ok: true, connectionId, disconnected: true, target: s.target }
  }

  function sessionSummary(s) {
    const meta = ensureMeta(s.connectionId)
    return {
      connectionId: s.connectionId,
      label: s.label,
      target: s.target,
      connected: !!(s.connected && !s.exited),
      exited: !!s.exited,
      busy: !!s.busy,
      historical: false,
      pinned: !!meta.pinned,
      lastActivityAt: s.lastActivityAt,
      stepCount: history.reduce((count, event) => count + (event.connectionId === s.connectionId ? 1 : 0), 0),
    }
  }

  function listSessions() {
    const listed = new Map()
    for (const s of sessions.values()) listed.set(s.connectionId, sessionSummary(s))
    for (const meta of connectionMeta.values()) {
      if (listed.has(meta.connectionId)) continue
      listed.set(meta.connectionId, {
        connectionId: meta.connectionId,
        label: meta.label || (meta.connectionId === LEGACY_SESSION_ID ? '历史记录' : ''),
        target: meta.target || (meta.connectionId === LEGACY_SESSION_ID ? '历史记录' : ''),
        connected: false,
        exited: true,
        busy: false,
        historical: true,
        pinned: !!meta.pinned,
        lastActivityAt: meta.lastActivityAt,
        stepCount: history.reduce((count, event) => count + (event.connectionId === meta.connectionId ? 1 : 0), 0),
      })
    }
    const sessionsList = Array.from(listed.values()).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt - a.lastActivityAt)
    return { sessions: sessionsList, activeConnectionId: activeSessionId && sessions.has(activeSessionId) ? activeSessionId : null }
  }

  function transcriptFor(connectionId) {
    const s = sessions.get(connectionId)
    const meta = connectionMeta.get(connectionId)
    return {
      connectionId,
      label: s ? s.label : (meta && meta.label) || (connectionId === LEGACY_SESSION_ID ? '历史记录' : ''),
      connected: !!(s && s.connected && !s.exited),
      exited: !!(!s || s.exited),
      busy: !!(s && s.busy),
      target: s ? s.target : (meta && meta.target) || (connectionId === LEGACY_SESSION_ID ? '历史记录' : lastTarget),
      steps: history.filter((event) => event.connectionId === connectionId).slice(-MAX_STEPS),
    }
  }

  function transcript(requestedId) {
    const connectionId = resolveConnectionId(requestedId, true)
    if (connectionId) return transcriptFor(connectionId)
    return { connectionId: null, connected: false, target: lastTarget, steps: history.slice(-MAX_STEPS) }
  }

  function clearHistory(requestedId) {
    const connectionId = requestedId == null || requestedId === '' ? null : String(requestedId)
    if (connectionId) {
      history = history.filter((event) => event.connectionId !== connectionId)
      if (!sessions.has(connectionId)) {
        connectionMeta.delete(connectionId)
        pinnedConnectionIds.delete(connectionId)
      }
    } else {
      history = []
      connectionMeta.clear()
      pinnedConnectionIds.clear()
    }
    persist()
    return { ok: true, cleared: true, connectionId }
  }

  function togglePinned(requestedId) {
    const connectionId = resolveConnectionId(requestedId, true)
    if (!connectionId) throw new Error('connectionId is required')
    const meta = ensureMeta(connectionId)
    meta.pinned = !meta.pinned
    if (meta.pinned) pinnedConnectionIds.add(connectionId)
    else pinnedConnectionIds.delete(connectionId)
    persist()
    return { ok: true, connectionId, pinned: meta.pinned }
  }

  function deleteHistory(requestedId) {
    const connectionId = requestedId == null || requestedId === '' ? null : String(requestedId)
    if (!connectionId || (!sessions.has(connectionId) && !connectionMeta.has(connectionId))) {
      throw new Error('unknown SSH connection: ' + (connectionId || ''))
    }
    history = history.filter((event) => event.connectionId !== connectionId)
    pinnedConnectionIds.delete(connectionId)
    if (!sessions.has(connectionId)) connectionMeta.delete(connectionId)
    else ensureMeta(connectionId).pinned = false
    persist()
    return { ok: true, deleted: true, connectionId }
  }

  function textOut(a, v) {
    let s = (v && typeof v === 'object') ? ((v.output !== undefined ? String(v.output) : JSON.stringify(v))) : String(v)
    if (s.length > 6000) s = s.slice(0, 6000) + '\n...[truncated]'
    return [{ type: 'text', text: s }]
  }

  const objParams = (properties, required) => ({ type: 'object', additionalProperties: true, properties, ...(required && required.length ? { required } : {}) })
  const connectionIdParam = { type: 'string', description: 'Connection ID returned by ssh_connect; omit only for legacy active-session behavior' }

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_connect',
    description: 'Open an interactive SSH session. Each call creates an independent connection unless connectionId is supplied to replace that connection. Always keep and reuse the returned connectionId when several tasks are active.',
    parameters: objParams({
      connectionId: connectionIdParam,
      label: { type: 'string', description: 'Optional human-readable name for this task/connection' },
      host: { type: 'string', description: 'Remote hostname or IP' },
      user: { type: 'string', description: 'SSH username' },
      port: { type: 'number', description: 'Port (default 22)' },
      password: { type: 'string', description: 'Password for password auth' },
      identity: { type: 'string', description: 'Path to a private key file (-i)' },
    }, ['host', 'user']),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    timeoutMs: 30000,
    async execute(args) { try { return await doConnect(args) } catch (e) { return { ok: false, error: ((e && e.message) || String(e)) } } },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_exec',
    description: 'Send one command to a specific SSH connection and return its output. Pass the connectionId from ssh_connect to keep concurrent tasks isolated; omit it only for the legacy active connection.',
    parameters: objParams({
      connectionId: connectionIdParam,
      command: { type: 'string', description: 'Shell command to run on the remote host' },
      waitMs: { type: 'number', description: 'Max milliseconds to wait for the command to settle (default 12000)' },
    }, ['command']),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    timeoutMs: 16000,
    async execute(args) { try { return await doExec(args.command, args) } catch (e) { return { ok: false, error: ((e && e.message) || String(e)) } } },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_disconnect',
    description: 'Close one SSH connection. Pass connectionId for a specific task; omit it only for the legacy active connection.',
    parameters: objParams({ connectionId: connectionIdParam }, []),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    timeoutMs: 8000,
    async execute(args) { try { return await doDisconnect(args && args.connectionId) } catch (e) { return { ok: false, error: ((e && e.message) || String(e)) } } },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_status',
    description: 'Show one SSH connection transcript. Pass connectionId to inspect a specific task; omit it for the legacy active-session behavior.',
    parameters: objParams({ connectionId: connectionIdParam }, []),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    async execute(args) { return transcript(args && args.connectionId) },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_list',
    description: 'List active and recently recorded SSH connections so concurrent tasks can select the correct connectionId.',
    parameters: objParams({}, []),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    async execute() { return listSessions() },
  }))

  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? JSON.parse(text) : {}
  }
  function send(res, obj) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(obj))
  }
  function isLocal(req) {
    const host = String(req.headers.host || '')
    return /127\.0\.0\.1|localhost|\[::1\]/.test(host)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/ssh-terminal/api',
    handler: async (req, res) => {
      if (!isLocal(req)) { send(res, { ok: false, error: 'forbidden' }); return }
      try {
        const data = await readBody(req)
        const action = data && data.action
        let out
        if (action === 'clear') out = clearHistory(data.connectionId)
        else if (action === 'pin') out = togglePinned(data.connectionId)
        else if (action === 'delete') out = deleteHistory(data.connectionId)
        else if (action === 'list') out = listSessions()
        else if (action === 'connect') out = await doConnect(data)
        else if (action === 'exec') out = await doExec(data.command, data)
        else if (action === 'disconnect') out = await doDisconnect(data.connectionId)
        else out = transcript(data.connectionId)
        send(res, out)
      } catch (e) {
        send(res, { ok: false, error: ((e && e.message) || String(e)) })
      }
    },
  }))

  ctx.effect(() => () => {
    for (const connectionId of Array.from(sessions.keys())) void doDisconnect(connectionId)
  })
}
