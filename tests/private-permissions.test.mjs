import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const {
  copyPrivateFile,
  ensurePrivateDir,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  writePrivateFile,
} = await import('../dist/core/store.js')
const { readAuthFile } = await import('../dist/core/codex-auth.js')

function modeOf(stat) {
  return stat.mode & 0o777
}

const testPrivateModes = process.platform === 'win32' ? test.skip : test

testPrivateModes('private storage helpers create owner-only dirs and files', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-switch-perms-test-'))

  try {
    const privateDir = path.join(tempDir, 'private')
    await ensurePrivateDir(privateDir)
    assert.equal(modeOf(await fs.stat(privateDir)), PRIVATE_DIR_MODE)

    const authPath = path.join(privateDir, 'auth.json')
    await writePrivateFile(authPath, '{"ok":true}\n')
    assert.equal(modeOf(await fs.stat(authPath)), PRIVATE_FILE_MODE)

    await fs.chmod(privateDir, 0o777)
    await ensurePrivateDir(privateDir)
    assert.equal(modeOf(await fs.stat(privateDir)), PRIVATE_DIR_MODE)

    const sourcePath = path.join(tempDir, 'source-auth.json')
    await fs.writeFile(sourcePath, 'secret\n', { mode: 0o644 })

    const copiedPath = path.join(privateDir, 'copied-auth.json')
    await copyPrivateFile(sourcePath, copiedPath)
    assert.equal(modeOf(await fs.stat(copiedPath)), PRIVATE_FILE_MODE)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

testPrivateModes('readAuthFile tightens existing profile auth permissions', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-switch-auth-perms-test-'))

  try {
    const profileDir = path.join(tempDir, 'profile')
    const authPath = path.join(profileDir, 'auth.json')
    await fs.mkdir(profileDir, { recursive: true, mode: 0o755 })
    await fs.writeFile(
      authPath,
      `${JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'existing-access-token',
        },
      })}\n`,
      { mode: 0o644 }
    )

    const { json } = await readAuthFile(profileDir)

    assert.equal(json.auth_mode, 'chatgpt')
    assert.equal(modeOf(await fs.stat(profileDir)), PRIVATE_DIR_MODE)
    assert.equal(modeOf(await fs.stat(authPath)), PRIVATE_FILE_MODE)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
