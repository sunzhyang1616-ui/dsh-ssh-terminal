#!/usr/bin/env node

const API_URL = process.env.DSH_SSH_API || 'http://127.0.0.1:43120/ssh-terminal/api'
const timeoutValue = Number(process.env.DSH_SSH_API_TIMEOUT_MS || 30000)
const API_TIMEOUT_MS = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 30000

const connectionIdProperty = {
  type: 'string',
  description: 'Connection ID returned by ssh_connect. Pass it for every operation in a concurrent task.',
}

const toolDefinitions = [
  {
    name: 'ssh_connect',
    description: 'Open an interactive SSH connection through the running DSH dsh-ssh-terminal plugin. Each call creates an independent connection unless connectionId is supplied. Keep the returned connectionId for later calls.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        connectionId: connectionIdProperty,
        label: { type: 'string', description: 'Optional human-readable task name' },
        host: { type: 'string', description: 'Remote hostname or IP' },
        user: { type: 'string', description: 'SSH username' },
        port: { type: 'number', description: 'SSH port, default 22' },
        password: { type: 'string', description: 'Password for password authentication' },
        identity: { type: 'string', description: 'Path to a private key file' },
      },
      required: ['host', 'user'],
    },
  },
  {
    name: 'ssh_exec',
    description: 'Run one shell command on a DSH-managed SSH connection. Pass connectionId to keep concurrent Codex tasks isolated; commands on one connection are queued by DSH.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        connectionId: connectionIdProperty,
        command: { type: 'string', description: 'Shell command to run on the remote host' },
        waitMs: { type: 'number', description: 'Maximum wait time in milliseconds, default 12000' },
      },
      required: ['command'],
    },
  },
  {
    name: 'ssh_disconnect',
    description: 'Close one DSH-managed SSH connection. Pass connectionId for a specific concurrent task.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: { connectionId: connectionIdProperty },
    },
  },
  {
    name: 'ssh_status',
    description: 'Read the transcript and status of one DSH-managed SSH connection. Pass connectionId for a specific concurrent task.',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: { connectionId: connectionIdProperty },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'ssh_list',
    description: 'List active and recently recorded SSH connections managed by DSH, including their connectionId values.',
    inputSchema: { type: 'object', additionalProperties: true, properties: {} },
    annotations: { readOnlyHint: true },
  },
]

function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function writeError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id: id == null ? null : id, error: { code, message } })
}

function toolResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const result = {
    content: [{ type: 'text', text }],
  }
  if (value && typeof value === 'object') result.structuredContent = value
  if (value && value.ok === false) result.isError = true
  return result
}

async function callDsh(action, args) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...(args || {}) }),
      signal: controller.signal,
    })
    const body = await response.text()
    let value
    try { value = body ? JSON.parse(body) : {} }
    catch (error) { throw new Error('DSH returned invalid JSON') }
    if (!response.ok) throw new Error('DSH API returned HTTP ' + response.status)
    return value
  } finally {
    clearTimeout(timer)
  }
}

async function callTool(name, args) {
  switch (name) {
    case 'ssh_connect': return toolResult(await callDsh('connect', args))
    case 'ssh_exec': return toolResult(await callDsh('exec', args))
    case 'ssh_disconnect': return toolResult(await callDsh('disconnect', args))
    case 'ssh_status': return toolResult(await callDsh('status', args))
    case 'ssh_list': return toolResult(await callDsh('list', args))
    default: throw new Error('unknown SSH tool: ' + name)
  }
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0' || !message.method) return
  const id = message.id
  const params = message.params || {}

  if (message.method === 'notifications/initialized' || id === undefined) return
  if (message.method === 'ping') {
    writeMessage({ jsonrpc: '2.0', id, result: {} })
    return
  }
  if (message.method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dsh-ssh-terminal', version: '0.1.0' },
        instructions: 'Use ssh_connect first and keep its returned connectionId. For concurrent tasks, pass that ID to ssh_exec, ssh_status, and ssh_disconnect. Use ssh_list to inspect all active connections. DSH owns the SSH processes and the sidebar transcript.',
      },
    })
    return
  }
  if (message.method === 'tools/list') {
    writeMessage({ jsonrpc: '2.0', id, result: { tools: toolDefinitions } })
    return
  }
  if (message.method === 'tools/call') {
    try {
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
      writeMessage({ jsonrpc: '2.0', id, result: await callTool(params.name, args) })
    } catch (error) {
      const messageText = String((error && error.message) || error)
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: messageText }] },
      })
    }
    return
  }
  writeError(id, -32601, 'Method not found: ' + message.method)
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  let newline
  while ((newline = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, newline).trim()
    input = input.slice(newline + 1)
    if (!line) continue
    try {
      const message = JSON.parse(line)
      void handleMessage(message).catch((error) => {
        process.stderr.write(String((error && error.stack) || error) + '\n')
      })
    } catch (error) {
      writeError(null, -32700, 'Invalid JSON')
    }
  }
})
