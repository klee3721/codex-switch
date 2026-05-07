import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { fetchLatestUsageFromCodexSessions } = await import('../dist/core/usage.js')

function buildRateLimitLine({ timestamp, usedPercent, weeklyPercent, extra = '' }) {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      token_count: 42,
      extra,
      rate_limits: {
        plan_type: 'plus',
        primary: {
          used_percent: usedPercent,
          window_minutes: 300,
          resets_at: 1_700_000_000,
        },
        secondary: {
          used_percent: weeklyPercent,
          window_minutes: 10_080,
          resets_at: 1_700_100_000,
        },
      },
    },
  })
}

async function withTempSessions(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-switch-usage-test-'))
  try {
    const sessionsRoot = path.join(tempDir, '.codex', 'sessions')
    await callback({ tempDir, sessionsRoot })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

test('fetchLatestUsageFromCodexSessions finds the newest rate-limit event across chunk boundaries', async () => {
  await withTempSessions(async ({ sessionsRoot }) => {
    const dayDir = path.join(sessionsRoot, '2026', '04', '22')
    await fs.mkdir(dayDir, { recursive: true })

    const olderLine = buildRateLimitLine({
      timestamp: '2026-04-22T09:00:00.000Z',
      usedPercent: 55,
      weeklyPercent: 70,
    })
    const newerLine = buildRateLimitLine({
      timestamp: '2026-04-22T10:00:00.000Z',
      usedPercent: 18,
      weeklyPercent: 35,
      extra: 'x'.repeat(400),
    })

    await fs.writeFile(path.join(dayDir, 'session-01.jsonl'), `${olderLine}\n`, 'utf8')
    await fs.writeFile(
      path.join(dayDir, 'session-02.jsonl'),
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'noise' } })}\n${newerLine}\n`,
      'utf8'
    )

    const snapshot = await fetchLatestUsageFromCodexSessions({
      sessionsRoot,
      chunkBytes: 64,
      maxBytesPerFile: 1024,
    })

    assert.ok(snapshot)
    assert.equal(snapshot.source, 'codex_session_logs')
    assert.equal(snapshot.planType, 'plus')
    assert.equal(snapshot.last5Hours.usedPercent, 18)
    assert.equal(snapshot.weekly.usedPercent, 35)
    assert.equal(snapshot.updatedAt, Date.parse('2026-04-22T10:00:00.000Z'))
  })
})

test('fetchLatestUsageFromCodexSessions returns null when no rate-limit events exist', async () => {
  await withTempSessions(async ({ sessionsRoot }) => {
    const dayDir = path.join(sessionsRoot, '2026', '04', '22')
    await fs.mkdir(dayDir, { recursive: true })
    await fs.writeFile(
      path.join(dayDir, 'session-01.jsonl'),
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'noise', token_count: 1 } })}\n`,
      'utf8'
    )

    const snapshot = await fetchLatestUsageFromCodexSessions({
      sessionsRoot,
      chunkBytes: 64,
      maxBytesPerFile: 1024,
    })

    assert.equal(snapshot, null)
  })
})
