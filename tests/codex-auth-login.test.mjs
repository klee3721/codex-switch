import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { runCodexChatGptLogin } = await import('../dist/core/codex-auth.js')

function fakeCodexScript({ writeAuth }) {
  const authWrite = writeAuth
    ? `
const authPath = path.join(process.env.CODEX_HOME, 'auth.json')
fs.writeFileSync(authPath, JSON.stringify({
  auth_mode: 'chatgpt',
  tokens: {
    access_token: 'access-token-from-login',
    refresh_token: 'refresh-token-from-login'
  }
}, null, 2) + '\\n', 'utf8')
`
    : ''

  return `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

fs.mkdirSync(process.env.CODEX_HOME, { recursive: true })
${authWrite}
setInterval(() => {}, 1000)
`
}

async function withFakeCodex(script, callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-switch-login-test-'))
  const binDir = path.join(tempDir, 'bin')
  const profileDir = path.join(tempDir, 'profile')
  const codexPath = path.join(binDir, 'codex')
  const originalPath = process.env.PATH

  try {
    await fs.mkdir(binDir, { recursive: true })
    await fs.writeFile(codexPath, script, 'utf8')
    await fs.chmod(codexPath, 0o755)
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`
    await callback({ profileDir })
  } finally {
    if (originalPath == null) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

test('runCodexChatGptLogin completes when piped login writes auth but keeps running', async () => {
  await withFakeCodex(fakeCodexScript({ writeAuth: true }), async ({ profileDir }) => {
    const startedAt = Date.now()

    await runCodexChatGptLogin(profileDir, {
      stdio: 'pipe',
      timeoutMs: 5_000,
    })

    const elapsedMs = Date.now() - startedAt
    const authPath = path.join(profileDir, 'auth.json')
    const authJson = JSON.parse(await fs.readFile(authPath, 'utf8'))

    assert.equal(authJson.auth_mode, 'chatgpt')
    assert.ok(elapsedMs < 4_000)
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(authPath)).mode & 0o777, 0o600)
    }
  })
})

test('runCodexChatGptLogin does not accept an unchanged existing auth file as relogin success', async () => {
  await withFakeCodex(fakeCodexScript({ writeAuth: false }), async ({ profileDir }) => {
    await fs.mkdir(profileDir, { recursive: true })
    await fs.writeFile(
      path.join(profileDir, 'auth.json'),
      `${JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'existing-access-token',
          refresh_token: 'existing-refresh-token',
        },
      })}\n`,
      'utf8'
    )

    await assert.rejects(
      runCodexChatGptLogin(profileDir, {
        stdio: 'pipe',
        timeoutMs: 250,
      }),
      /Timed out waiting for authentication/
    )
  })
})
