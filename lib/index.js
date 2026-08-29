// dsh-ssh-terminal — Host half
// Open an interactive SSH session on the DSH host, expose agent tools (via the
// tools service) and an HTTP route (via webServer) that the better-sidebar tab
// fetches for connect/exec/disconnect/status.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const inject = ['timer', 'subprocess', 'webServer', 'tools']

export function apply(ctx) {
  const fs = ctx.get('fs')
  let session = null
  const HISTORY_PATH = join(homedir(), '.dsh', 'ssh-terminal-history.json')
  let history = []
  try {
    const raw = readFileSync(HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) history = parsed
  } catch (e) {}
  if (history.length > 600) history = history.slice(-600)
  let lastTarget = ''
  function persist() {
    try {
      mkdirSync(dirname(HISTORY_PATH), { recursive: true })
      writeFileSync(HISTORY_PATH, JSON.stringify(history))
    } catch (e) {}
  }

  function cleanStream(s) {
    s = String(s)
    s = s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    s = s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    s = s.replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    return s
  }

  function appendStep(kind, text) {
    history.push({ kind, text, ts: Date.now() })
    if (history.length > 600) history.shift()
    persist()
  }

  function startDrain(handle, drainState) {
    const decoder = new TextDecoder()
    const run = (async () => {
      try {
        for await (const chunk of handle.output) {
          if (drainState.stopped || !session) break
          const text = cleanStream(decoder.decode(chunk, { stream: true }))
          session.log += text
          session.lastActivityAt = Date.now()
          tryPassword()
        }
      } catch (e) { try { console.error('ssh output stream error', e) } catch (e2) {} }
      if (session && !drainState.stopped) session.exited = true
    })()
    return run
  }

  function tail(n) { return session ? session.log.slice(-n) : '' }

  function tryPassword() {
    if (!session || !session.passwordPending || session.passwordSent) return
    const t = session.log.trimEnd()
    if (/password\s*:\s*$/i.test(t) || /password.*:\s*$/i.test(t.slice(-90))) {
      const p = session.passwordPending
      session.passwordPending = null
      session.passwordSent = true
      if (session.handle) session.handle.write(p + '\n').catch(() => {})
    }
  }

  async function doConnect(opts) {
    opts = opts || {}
    const host = opts.host, user = opts.user, port = opts.port || 22
    if (!host || !user) throw new Error('ssh_connect requires host and user')
    if (session) await doDisconnect()
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
    const drainState = { stopped: false }
    session = {
      handle, steps: [], log: '', lastActivityAt: Date.now(),
      target: user + '@' + host + (String(port) !== '22' ? ':' + port : ''),
      connected: false, exited: false, exitCode: null,
      passwordPending: opts.password || null, passwordSent: false,
      drainState,
    }
    session.drain = startDrain(handle, drainState)
    handle.done.then((o) => { if (session) { session.exited = true; session.exitCode = o.exitCode } }).catch(() => { if (session) session.exited = true })
    appendStep('system', 'Connecting to ' + session.target + ' ...')
    const start = Date.now()
    let ready = false
    let lateFail = null
    while (Date.now() - start < 25000) {
      if (session.exited) break
      tryPassword()
      const t = session.log.trimEnd()
      if (t.length > 0 && /[$#%>]\s*$/.test(t)) { ready = true; break }
      if (/PERMISSION DENIED|CONNECTION REFUSED|CONNECTION TIMED OUT|NO ROUTE TO HOST|HOST KEY VERIFICATION FAILED|TOO MANY AUTHENTICATION|AUTHENTICATION FAILED|UNABLE TO NEGOTIATE/.test(session.log.toUpperCase())) { lateFail = session.log; break }
      await ctx.timeout(250)
    }
    if (ready) {
      session.connected = true
      lastTarget = session.target
      appendStep('connect', 'Connected to ' + session.target)
      return { ok: true, target: session.target, connected: true, logLength: session.log.length, logTail: tail(300) }
    }
    if (session.exited || lateFail) {
      const info = ((lateFail || tail(400)) || 'host unreachable').trim()
      await doDisconnect()
      throw new Error('SSH connection failed: ' + info)
    }
    session.connected = true
    lastTarget = session.target
    appendStep('connect', 'Connected to ' + session.target)
    return { ok: true, target: session.target, connected: true, logLength: session.log.length, logTail: tail(300) }
  }

  function stripEcho(delta, cmd) {
    if (!cmd) return delta
    const nl = delta.indexOf('\n')
    if (nl >= 0) { const first = delta.slice(0, nl); if (first.indexOf(cmd) >= 0) return delta.slice(nl + 1) }
    else if (delta === cmd) return ''
    return delta
  }

  async function doExec(command, opts) {
    opts = opts || {}
    if (!session || !session.connected || session.exited) throw new Error('no active SSH connection; call ssh_connect first')
    const cmd = String(command == null ? '' : command)
    if (!cmd) throw new Error('command is required')
    const waitMs = opts.waitMs ? Number(opts.waitMs) : 12000
    const idleMs = 700
    appendStep('cmd', cmd)
    const offset = session.log.length
    session.lastActivityAt = Date.now()
    try { await session.handle.write(cmd + '\n') }
    catch (e) { throw new Error('failed to write to SSH: ' + ((e && e.message) || e)) }
    const start = Date.now()
    while (Date.now() - start < waitMs) {
      await ctx.timeout(150)
      if (session.exited) break
      if (Date.now() - session.lastActivityAt >= idleMs && Date.now() - start >= 300) break
    }
    let delta = session.log.slice(offset)
    delta = stripEcho(delta, cmd)
    delta = delta.replace(/\r/g, '').replace(/[\t ]+$/gm, '').replace(/\s+$/, '')
    if (delta) appendStep('out', delta)
    return { output: delta, exited: !!session.exited, exitCode: session.exitCode, logLength: session.log.length, logTail: tail(300) }
  }

  async function doDisconnect() {
    const s = session
    if (!s) return { ok: true, disconnected: false }
    appendStep('disconnect', 'Disconnected from ' + s.target)
    session = null
    if (s.drainState) s.drainState.stopped = true
    try { if (s.handle) await s.handle.terminate() } catch (e) {}
    return { ok: true, disconnected: true, target: s.target }
  }

  function transcript() {
    return { connected: !!(session && session.connected && !session.exited), target: (session ? session.target : lastTarget), steps: history.slice() }
  }

  function textOut(a, v) {
    let s = (v && typeof v === 'object') ? ((v.output !== undefined ? String(v.output) : JSON.stringify(v))) : String(v)
    if (s.length > 6000) s = s.slice(0, 6000) + '\n...[truncated]'
    return [{ type: 'text', text: s }]
  }

  const objParams = (properties, required) => ({ type: 'object', additionalProperties: true, properties, ...(required && required.length ? { required } : {}) })

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_connect',
    description: 'Open an interactive SSH session to a remote server so the agent can run commands with ssh_exec. Prefer key-based auth via "identity"; "password" is supported but should not be reused elsewhere.',
    parameters: objParams({
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
    description: 'Send one command to the active SSH session, wait for it to settle, and return its output. Use one command per call for step-by-step transparency.',
    parameters: objParams({
      command: { type: 'string', description: 'Shell command to run on the remote host' },
      waitMs: { type: 'number', description: 'Max milliseconds to wait for the command to settle (default 12000)' },
    }, ['command']),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    timeoutMs: 16000,
    async execute(args) { try { return await doExec(args.command, args) } catch (e) { return { ok: false, error: ((e && e.message) || String(e)) } } },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_disconnect',
    description: 'Close the active SSH session, if any.',
    parameters: objParams({}, []),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    timeoutMs: 8000,
    async execute() { try { return await doDisconnect() } catch (e) { return { ok: false, error: ((e && e.message) || String(e)) } } },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'ssh_status',
    description: 'Report whether an SSH session is active and show its transcript steps.',
    parameters: objParams({}, []),
    output: { schema: { type: 'object', additionalProperties: true }, render: textOut },
    async execute() { return transcript() },
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
        if (action === 'clear') { history.length = 0; persist(); out = { ok: true, cleared: true } }
        else if (action === 'connect') out = await doConnect(data)
        else if (action === 'exec') out = await doExec(data.command, data)
        else if (action === 'disconnect') out = await doDisconnect()
        else out = transcript()
        send(res, out)
      } catch (e) {
        send(res, { ok: false, error: ((e && e.message) || String(e)) })
      }
    },
  }))

  ctx.effect(() => () => { const s = session; if (s) doDisconnect() })
}
