import blessed from 'blessed'
import {
  addAccount,
  ensureCurrentCodexLinked,
  getActiveAccount,
  listState,
  refreshUsage,
  removeAccount,
  useAccount,
} from '../core/accounts'
import type { Account, AppState, UsageHealth } from '../core/types'

type Tone = 'info' | 'success' | 'warn' | 'error'

const AUTO_REFRESH_MS = 60_000
const ACCOUNTS_PANE_MIN_WIDTH = 36
const ACCOUNTS_PANE_MAX_WIDTH = 72

function percentText(value: number | null) {
  return value == null ? 'n/a' : `${value.toFixed(0)}%`
}

function formatReset(value: number | null) {
  if (value == null) return 'n/a'
  return new Date(value * 1000).toLocaleString()
}

function formatUpdated(value: number | null) {
  if (value == null) return 'never'
  return new Date(value).toLocaleString()
}

function colorForHealth(status: UsageHealth) {
  switch (status) {
    case 'ok':
      return 'green'
    case 'stale':
      return 'yellow'
    case 'relogin_required':
      return 'red'
    case 'error':
      return 'red'
    case 'never':
    default:
      return 'gray'
  }
}

function toneToColor(tone: Tone) {
  switch (tone) {
    case 'success':
      return 'green'
    case 'warn':
      return 'yellow'
    case 'error':
      return 'red'
    case 'info':
    default:
      return 'cyan'
  }
}

function displayName(account: Account | null | undefined) {
  if (!account) return 'none'
  return account.email ?? account.label
}

function renderBar(percent: number | null, color: string, width: number) {
  if (percent == null) {
    return `{gray-fg}${'░'.repeat(width)}{/gray-fg}`
  }

  const bounded = Math.max(0, Math.min(100, percent))
  const filled = Math.round((bounded / 100) * width)
  const empty = width - filled
  const left = filled > 0 ? `{${color}-fg}${'█'.repeat(filled)}{/${color}-fg}` : ''
  const right = empty > 0 ? `{gray-fg}${'░'.repeat(empty)}{/gray-fg}` : ''
  return `${left}${right}`
}

function computeAccountsPaneWidth(accounts: Account[], screenWidth: number) {
  const longestName = accounts.reduce((max, account) => Math.max(max, displayName(account).length), 10)
  const desired = Math.min(ACCOUNTS_PANE_MAX_WIDTH, Math.max(ACCOUNTS_PANE_MIN_WIDTH, longestName + 8))
  const maxAllowed = Math.max(ACCOUNTS_PANE_MIN_WIDTH, Math.floor(screenWidth * 0.5))
  return Math.min(desired, maxAllowed)
}

function promptText(screen: blessed.Widgets.Screen, title: string, placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 9,
      border: 'line',
      style: {
        border: { fg: 'cyan' },
        bg: '#101820',
      },
      label: ` ${title} `,
    })

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      right: 2,
      content: 'Enter value and press Enter. Esc to cancel.',
      style: { fg: 'gray' },
    })

    const input = blessed.textbox({
      parent: modal,
      top: 3,
      left: 2,
      right: 2,
      height: 3,
      border: 'line',
      inputOnFocus: true,
      keys: true,
      mouse: true,
      value: placeholder,
      style: {
        fg: 'white',
        border: { fg: 'white' },
      },
    })

    const cleanup = (value: string | null) => {
      modal.destroy()
      screen.render()
      resolve(value)
    }

    input.on('submit', (value) => cleanup((value ?? '').trim() || null))
    input.key(['escape', 'C-c'], () => cleanup(null))

    input.focus()
    input.readInput()
    screen.render()
  })
}

function promptConfirm(screen: blessed.Widgets.Screen, title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '58%',
      height: 8,
      border: 'line',
      label: ` ${title} `,
      style: {
        border: { fg: 'yellow' },
        bg: '#101820',
      },
    })

    blessed.text({
      parent: modal,
      top: 2,
      left: 2,
      right: 2,
      content: message,
      tags: true,
    })

    blessed.text({
      parent: modal,
      bottom: 1,
      left: 2,
      content: 'Press Y to confirm, N or Esc to cancel',
      style: { fg: 'gray' },
    })

    const done = (ok: boolean) => {
      modal.destroy()
      screen.render()
      resolve(ok)
    }

    modal.key(['y', 'Y'], () => done(true))
    modal.key(['n', 'N', 'escape', 'C-c'], () => done(false))
    modal.focus()
    screen.render()
  })
}

export async function runTui(options?: { deferCurrentLink?: boolean }) {
  let state: AppState = await listState()
  let selectedAccountId: string | null = getActiveAccount(state)?.id ?? state.accounts[0]?.id ?? null
  let busy = false
  let statusMessage = 'Ready'
  let statusTone: Tone = 'info'

  const screen = blessed.screen({
    smartCSR: true,
    title: 'codex-switch',
    dockBorders: true,
    fullUnicode: true,
  })

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    border: 'line',
    style: {
      border: { fg: 'cyan' },
      fg: 'white',
      bg: '#0f1216',
    },
  })

  const accountsList = blessed.list({
    parent: screen,
    top: 3,
    left: 0,
    width: ACCOUNTS_PANE_MIN_WIDTH,
    bottom: 3,
    border: 'line',
    label: ' Accounts ',
    keys: true,
    mouse: true,
    vi: true,
    style: {
      fg: 'white',
      bg: '#101820',
      border: { fg: '#2bb3a3' },
      selected: {
        fg: 'black',
        bg: '#2bb3a3',
      },
      item: {
        fg: 'white',
      },
    },
  })

  const details = blessed.box({
    parent: screen,
    top: 3,
    left: ACCOUNTS_PANE_MIN_WIDTH,
    right: 0,
    bottom: 3,
    border: 'line',
    label: ' Usage ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
    },
    style: {
      fg: 'white',
      bg: '#11161d',
      border: { fg: '#2bb3a3' },
    },
  })

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    tags: true,
    style: {
      border: { fg: 'cyan' },
      fg: 'white',
      bg: '#0f1216',
    },
  })

  function selectedAccount() {
    if (!state.accounts.length) return null
    if (!selectedAccountId) return state.accounts[0]
    return state.accounts.find((account) => account.id === selectedAccountId) ?? state.accounts[0]
  }

  function setStatus(message: string, tone: Tone = 'info') {
    statusMessage = message
    statusTone = tone
  }

  function refreshView() {
    const terminalWidth = typeof screen.width === 'number' ? screen.width : 120
    const accountsPaneWidth = computeAccountsPaneWidth(state.accounts, terminalWidth)
    accountsList.width = accountsPaneWidth
    details.left = accountsPaneWidth

    const active = getActiveAccount(state)
    const activeLabel = displayName(active)
    header.setContent(
      ` {bold}codex-switch{/bold}   Active: {green-fg}${activeLabel}{/green-fg}   Accounts: ${state.accounts.length} `
    )

    const listItems = state.accounts.map((account) => {
      const isActive = active?.id === account.id
      const activePrefix = isActive ? '●' : '○'
      return `${activePrefix} ${displayName(account)}`
    })

    accountsList.setItems(listItems.length > 0 ? listItems : ['No accounts yet'])

    const selected = selectedAccount()
    if (!selected) {
      details.setContent(
        [
          '{bold}No accounts configured{/bold}',
          '',
          'Press {cyan-fg}A{/cyan-fg} to add an account.',
          'You will log in through direct ChatGPT browser auth.',
        ].join('\n')
      )
    } else {
      const healthColor = colorForHealth(selected.usage.status)
      const five = selected.usage.last5Hours
      const weekly = selected.usage.weekly
      const usagePaneWidth =
        typeof details.width === 'number' ? details.width : Math.max(terminalWidth - accountsPaneWidth, 60)
      const usageBarWidth = Math.max(28, Math.min(72, usagePaneWidth - 8))
      const content = [
        `{bold}${displayName(selected)}{/bold}`,
        '',
        `Status: {${healthColor}-fg}${selected.usage.status}{/${healthColor}-fg}`,
        `Source: ${selected.usage.source}`,
        `Plan: ${selected.usage.planType ?? 'unknown'}`,
        `Updated: ${formatUpdated(selected.usage.updatedAt)}`,
        selected.usage.error ? `Error: {red-fg}${selected.usage.error}{/red-fg}` : 'Error: none',
        '',
        '{bold}5-hour window{/bold}',
        `${renderBar(five.remainingPercent, 'yellow', usageBarWidth)}`,
        `Used: ${percentText(five.usedPercent)}   Remaining: ${percentText(five.remainingPercent)}`,
        `Resets: ${formatReset(five.resetAt)}`,
        '',
        '{bold}Weekly window{/bold}',
        `${renderBar(weekly.remainingPercent, 'cyan', usageBarWidth)}`,
        `Used: ${percentText(weekly.usedPercent)}   Remaining: ${percentText(weekly.remainingPercent)}`,
        `Resets: ${formatReset(weekly.resetAt)}`,
      ]
      details.setContent(content.join('\n'))
    }

    if (state.accounts.length > 0) {
      const index = state.accounts.findIndex((account) => account.id === selectedAccount()?.id)
      accountsList.select(Math.max(0, index))
    }

    const toneColor = toneToColor(statusTone)
    footer.setContent(
      ` {${toneColor}-fg}${statusMessage}{/${toneColor}-fg}  |  Keys: {cyan-fg}A{/cyan-fg} add  {cyan-fg}D{/cyan-fg} remove  {cyan-fg}Enter{/cyan-fg} use  {cyan-fg}R{/cyan-fg} refresh  {cyan-fg}Q{/cyan-fg} quit `
    )

    screen.render()
  }

  async function syncState() {
    state = await listState()
    if (!selectedAccountId || !state.accounts.find((account) => account.id === selectedAccountId)) {
      selectedAccountId = getActiveAccount(state)?.id ?? state.accounts[0]?.id ?? null
    }
  }

  async function runBusy(taskName: string, fn: () => Promise<void>) {
    if (busy) {
      setStatus('Another operation is already running.', 'warn')
      refreshView()
      return
    }

    busy = true
    setStatus(taskName, 'info')
    refreshView()

    try {
      await fn()
    } catch (error) {
      setStatus((error as Error).message, 'error')
    } finally {
      busy = false
      await syncState()
      refreshView()
    }
  }

  async function handleAdd() {
    const label = await promptText(screen, 'Add account', 'My account')
    if (!label) {
      setStatus('Add canceled.', 'warn')
      refreshView()
      return
    }

    await runBusy('Starting ChatGPT login…', async () => {
      const result = await addAccount(label, { loginMode: 'browser', loginStdio: 'pipe' })
      selectedAccountId = result.account.id
      setStatus(result.warning ?? `Added account "${displayName(result.account)}".`, result.warning ? 'warn' : 'success')
    })
  }

  async function handleDelete() {
    const account = selectedAccount()
    if (!account) {
      setStatus('No account selected.', 'warn')
      refreshView()
      return
    }

    const confirm = await promptConfirm(
      screen,
      'Remove account',
      `Remove {bold}${displayName(account)}{/bold}? This removes metadata only.`
    )
    if (!confirm) {
      setStatus('Remove canceled.', 'warn')
      refreshView()
      return
    }

    await runBusy(`Removing ${displayName(account)}…`, async () => {
      const result = await removeAccount(account.id, false)
      selectedAccountId = result.activeAccountId
      setStatus(`Removed account "${displayName(result.removed)}".`, 'success')
    })
  }

  async function handleSwitch() {
    const account = selectedAccount()
    if (!account) {
      setStatus('No account selected.', 'warn')
      refreshView()
      return
    }

    await runBusy(`Switching to ${displayName(account)}…`, async () => {
      const result = await useAccount(account.id)
      selectedAccountId = result.account.id

      if (result.switchResult.codexStatusExitCode === 0 && !result.warning) {
        setStatus(`Switched to "${displayName(result.account)}".`, 'success')
      } else if (result.switchResult.codexStatusExitCode === 0 && result.warning) {
        setStatus(`Switched to "${displayName(result.account)}" with warning: ${result.warning}`, 'warn')
      } else {
        const reason = (result.switchResult.codexStatusStderr || result.switchResult.codexStatusStdout).trim()
        setStatus(`Switched, but codex login status check failed: ${reason}`, 'warn')
      }
    })
  }

  async function handleRefresh() {
    const account = selectedAccount()
    if (!account) {
      setStatus('No account selected.', 'warn')
      refreshView()
      return
    }

    await runBusy(`Refreshing usage for ${displayName(account)}…`, async () => {
      const result = await refreshUsage({ accountId: account.id })
      const refreshed = result.updated.find((entry) => entry.id === account.id)
      if (refreshed?.usage.status === 'ok') {
        setStatus(`Usage refreshed for "${displayName(account)}".`, 'success')
      } else {
        setStatus(
          `Usage refresh finished with ${refreshed?.usage.status ?? 'unknown'} state for "${displayName(account)}".`,
          'warn'
        )
      }
    })
  }

  function handleSelectionChange() {
    const index = (accountsList as unknown as { selected: number }).selected
    const account = state.accounts[index]
    if (account) {
      selectedAccountId = account.id
      refreshView()
    }
  }

  accountsList.on('keypress', (_ch, key) => {
    if (key.name === 'up' || key.name === 'down' || key.name === 'k' || key.name === 'j') {
      setTimeout(handleSelectionChange, 0)
    }
  })

  accountsList.on('click', () => setTimeout(handleSelectionChange, 0))
  accountsList.key(['enter'], () => {
    void handleSwitch()
  })

  screen.key(['a', 'A'], () => {
    void handleAdd()
  })

  screen.key(['d', 'D'], () => {
    void handleDelete()
  })

  screen.key(['r', 'R'], () => {
    void handleRefresh()
  })

  const autoRefreshTimer = setInterval(() => {
    if (busy) return
    const active = getActiveAccount(state)
    if (!active) return

    void refreshUsage({ accountId: active.id })
      .then(async () => {
        await syncState()
        setStatus(`Auto-refreshed usage for ${displayName(active)}.`, 'info')
        refreshView()
      })
      .catch((error) => {
        setStatus(`Auto-refresh failed: ${(error as Error).message}`, 'warn')
        refreshView()
      })
  }, AUTO_REFRESH_MS)

  await syncState()
  refreshView()
  accountsList.focus()

  if (options?.deferCurrentLink) {
    void runBusy('Syncing current Codex account…', async () => {
      const result = await ensureCurrentCodexLinked()
      if (result.linked && result.account) {
        selectedAccountId = result.account.id
        if (result.warning) {
          setStatus(`Current account synced with warning: ${result.warning}`, 'warn')
        } else {
          setStatus(`Current account synced: ${displayName(result.account)}.`, 'success')
        }
      } else if (result.warning) {
        setStatus(result.warning, 'warn')
      } else {
        setStatus('Current Codex account was not linked.', 'warn')
      }
    })
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(autoRefreshTimer)
      screen.destroy()
      resolve()
    }

    screen.key(['q', 'Q', 'C-c'], shutdown)
  })
}
