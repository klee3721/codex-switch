import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { getPaths } from './store'
import type { Account, SwitchResult } from './types'

const CODEX_APP_PATH = '/Applications/Codex.app'

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function restartCodexDesktopApp() {
  if (process.platform !== 'darwin') return

  try {
    await fs.access(CODEX_APP_PATH)
  } catch {
    return
  }

  const isRunning = () =>
    (spawnSync('pgrep', ['-f', '/Applications/Codex.app'], {
      stdio: 'ignore',
    }).status ?? 1) === 0

  if (isRunning()) {
    spawnSync('osascript', ['-e', 'tell application "Codex" to quit'], {
      stdio: 'ignore',
    })

    await sleep(900)

    if (isRunning()) {
      spawnSync('pkill', ['-TERM', '-f', '/Applications/Codex.app'], {
        stdio: 'ignore',
      })
      await sleep(600)
    }
  }

  spawnSync('open', ['-a', CODEX_APP_PATH], {
    stdio: 'ignore',
  })
}

export async function switchToAccount(account: Account): Promise<SwitchResult> {
  const paths = getPaths()
  const sourceAuth = path.join(account.profileDir, 'auth.json')

  await fs.mkdir(paths.codexHome, { recursive: true })
  await fs.mkdir(paths.backupsDir, { recursive: true })

  await fs.access(sourceAuth)

  let backupPath: string | null = null
  try {
    await fs.access(paths.codexAuthPath)
    backupPath = path.join(paths.backupsDir, `${timestampForFile()}-auth.json`)
    await fs.copyFile(paths.codexAuthPath, backupPath)
  } catch {
    backupPath = null
  }

  await fs.copyFile(sourceAuth, paths.codexAuthPath)
  await restartCodexDesktopApp()

  const statusResult = spawnSync('codex', ['login', 'status'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })

  return {
    backupPath,
    codexStatusExitCode: statusResult.status ?? 1,
    codexStatusStdout: statusResult.stdout ?? '',
    codexStatusStderr: statusResult.stderr ?? '',
  }
}
