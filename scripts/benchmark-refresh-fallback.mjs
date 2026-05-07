import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const ACCOUNT_COUNT = 6
const SESSION_FILE_COUNT = 12
const NOISE_LINES_PER_FILE = 20_000
const ITERATIONS = 5

function buildAuthPayload(index) {
  return {
    auth_mode: 'api_key',
    OPENAI_API_KEY: `benchmark-key-${index}`,
  }
}

function buildUsageEventLine(offsetMinutes) {
  const timestamp = new Date(Date.now() - offsetMinutes * 60_000).toISOString()
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      token_count: 42,
      rate_limits: {
        plan_type: 'plus',
        primary: {
          used_percent: 18,
          window_minutes: 300,
          resets_at: Math.floor(Date.now() / 1000) + 12_345,
        },
        secondary: {
          used_percent: 35,
          window_minutes: 10_080,
          resets_at: Math.floor(Date.now() / 1000) + 234_567,
        },
      },
    },
  })
}

async function createFixture(tempHome) {
  const switchHome = path.join(tempHome, '.codex-switch')
  const profilesDir = path.join(switchHome, 'profiles')
  const sessionsDayDir = path.join(tempHome, '.codex', 'sessions', '2026', '04', '22')

  await fs.mkdir(profilesDir, { recursive: true })
  await fs.mkdir(sessionsDayDir, { recursive: true })

  const accounts = []
  for (let index = 0; index < ACCOUNT_COUNT; index += 1) {
    const id = `account-${index + 1}`
    const profileDir = path.join(profilesDir, id)
    await fs.mkdir(profileDir, { recursive: true })
    await fs.writeFile(path.join(profileDir, 'auth.json'), `${JSON.stringify(buildAuthPayload(index), null, 2)}\n`, 'utf8')
    await fs.writeFile(path.join(profileDir, 'config.toml'), 'chatgpt_base_url = "https://chatgpt.com/backend-api"\n', 'utf8')
    accounts.push({
      id,
      label: `Account ${index + 1}`,
      email: `bench${index + 1}@example.com`,
      profileDir,
      authSignature: `sig-${index + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usage: {
        source: 'wham_usage',
        planType: null,
        status: 'never',
        error: null,
        updatedAt: null,
        last5Hours: {
          usedPercent: null,
          remainingPercent: null,
          resetAt: null,
          windowSeconds: null,
        },
        weekly: {
          usedPercent: null,
          remainingPercent: null,
          resetAt: null,
          windowSeconds: null,
        },
      },
    })
  }

  await fs.writeFile(
    path.join(switchHome, 'state.json'),
    `${JSON.stringify({ activeAccountId: accounts[0]?.id ?? null, accounts }, null, 2)}\n`,
    'utf8'
  )

  const filler = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'event_msg',
    payload: {
      type: 'noise',
      token_count: 1,
      message: 'x'.repeat(1_500),
    },
  })

  for (let fileIndex = 0; fileIndex < SESSION_FILE_COUNT; fileIndex += 1) {
    const lines = []
    for (let lineIndex = 0; lineIndex < NOISE_LINES_PER_FILE; lineIndex += 1) {
      lines.push(filler)
    }
    if (fileIndex === SESSION_FILE_COUNT - 1) {
      lines.push(buildUsageEventLine(1))
    }
    const filePath = path.join(sessionsDayDir, `session-${String(fileIndex + 1).padStart(2, '0')}.jsonl`)
    await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const averageMs = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const medianMs = sorted[Math.floor(sorted.length / 2)]
  const minMs = sorted[0]
  const maxMs = sorted[sorted.length - 1]
  return {
    averageMs,
    medianMs,
    minMs,
    maxMs,
    samplesMs: samples,
  }
}

async function runWorker() {
  globalThis.fetch = async () => {
    throw new Error('benchmark offline')
  }

  const [{ fetchLatestUsageFromCodexSessions }, { refreshUsage }] = await Promise.all([
    import(path.join(repoRoot, 'dist/core/usage.js')),
    import(path.join(repoRoot, 'dist/core/accounts.js')),
  ])

  await fetchLatestUsageFromCodexSessions()
  await refreshUsage({ all: true })

  const sessionSamples = []
  for (let index = 0; index < ITERATIONS; index += 1) {
    const start = performance.now()
    await fetchLatestUsageFromCodexSessions()
    sessionSamples.push(performance.now() - start)
  }

  const refreshSamples = []
  for (let index = 0; index < ITERATIONS; index += 1) {
    const start = performance.now()
    await refreshUsage({ all: true })
    refreshSamples.push(performance.now() - start)
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        config: {
          accountCount: ACCOUNT_COUNT,
          sessionFileCount: SESSION_FILE_COUNT,
          noiseLinesPerFile: NOISE_LINES_PER_FILE,
          iterations: ITERATIONS,
        },
        fetchLatestUsageFromCodexSessions: summarize(sessionSamples),
        refreshUsageAllFallback: summarize(refreshSamples),
      },
      null,
      2
    )}\n`
  )
}

async function runDriver() {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-switch-bench-'))
  try {
    await createFixture(tempHome)

    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [__filename, '--worker'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: tempHome,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
          return
        }
        reject(new Error(stderr || `Benchmark worker exited with code ${code}`))
      })
    })

    process.stdout.write(result)
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true })
  }
}

if (process.argv.includes('--worker')) {
  await runWorker()
} else {
  await runDriver()
}
