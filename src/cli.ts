#!/usr/bin/env bun
import { Command } from 'commander'
import {
  bridgeAddAccount,
  bridgeDoctor,
  bridgeLinkCurrent,
  bridgeRefresh,
  bridgeRemoveAccount,
  bridgeStatus,
  bridgeUse,
  runBridgeCommand,
} from './bridge'
import {
  addAccount,
  ensureCurrentCodexLinked,
  formatStateSummary,
  listState,
  refreshUsage,
  removeAccount,
  useAccount,
} from './core/accounts'
import { runDoctor } from './core/doctor'
import { runTui } from './tui/app'

function displayAccountName(account: { email?: string | null; label: string }) {
  return account.email ?? account.label
}

function printStatusHuman() {
  return listState().then((state) => {
    const summary = formatStateSummary(state)
    const lines: string[] = []

    lines.push(`Active account: ${summary.activeEmail ?? summary.activeLabel ?? 'none'}`)
    lines.push(`Total accounts: ${summary.totalAccounts}`)

    if (summary.accounts.length === 0) {
      lines.push('No accounts configured. Add one with: codex-switch add --label "My Account"')
    } else {
      lines.push('')
      for (const account of summary.accounts) {
        const activeMark = account.isActive ? '*' : ' '
        const five = account.usage.last5Hours.usedPercent
        const weekly = account.usage.weekly.usedPercent
        const fiveText = five == null ? 'n/a' : `${five.toFixed(0)}%`
        const weeklyText = weekly == null ? 'n/a' : `${weekly.toFixed(0)}%`
        const displayName = displayAccountName(account)
        const source = account.usage.source

        lines.push(
          `${activeMark} ${displayName} | 5h: ${fiveText} | weekly: ${weeklyText} | status: ${account.usage.status} | source: ${source}`
        )
      }
    }

    console.log(lines.join('\n'))
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const isHelpRequest = argv.includes('--help') || argv.includes('-h') || argv[0] === 'help'
  const isTuiMode = argv.length === 0
  const isBridgeMode = argv[0] === 'bridge'

  if (!isHelpRequest && !isTuiMode && !isBridgeMode) {
    await ensureCurrentCodexLinked()
  }

  if (isTuiMode) {
    await runTui({ deferCurrentLink: true })
    return
  }

  const program = new Command()
  program
    .name('codex-switch')
    .description('Switch Codex ChatGPT accounts and monitor 5h/weekly usage limits')
    .showHelpAfterError()

  program
    .command('bridge')
    .description('Machine-readable JSON bridge for the macOS status bar app')
    .showHelpAfterError()
    .addCommand(
      new Command('status').description('Read cached account state as JSON').action(async () => {
        await runBridgeCommand(() => bridgeStatus())
      })
    )
    .addCommand(
      new Command('link-current').description('Link the current Codex login and return JSON').action(async () => {
        await runBridgeCommand(() => bridgeLinkCurrent())
      })
    )
    .addCommand(
      new Command('refresh')
        .description('Refresh usage data and return JSON')
        .option('--active', 'Refresh the active account only')
        .option('--all', 'Refresh every tracked account')
        .option('--account <id>', 'Refresh a specific account by id or label')
        .action(async (options: { active?: boolean; all?: boolean; account?: string }) => {
          await runBridgeCommand(() =>
            bridgeRefresh({
              active: options.active ?? false,
              all: options.all ?? false,
              accountId: options.account,
            })
          )
        })
    )
    .addCommand(
      new Command('use')
        .description('Switch the active account and return JSON')
        .requiredOption('--account <id>', 'Account id or exact label')
        .action(async (options: { account: string }) => {
          await runBridgeCommand(() => bridgeUse(options.account))
        })
    )
    .addCommand(
      new Command('add')
        .description('Add a new account and return JSON')
        .requiredOption('--label <name>', 'Account label')
        .option('--device-auth', 'Use device-code login instead of direct browser flow', false)
        .action(async (options: { label: string; deviceAuth?: boolean }) => {
          await runBridgeCommand(() =>
            bridgeAddAccount({
              label: options.label,
              deviceAuth: options.deviceAuth ?? false,
            })
          )
        })
    )
    .addCommand(
      new Command('remove')
        .description('Remove an account and return JSON')
        .requiredOption('--account <id>', 'Account id or exact label')
        .option('--purge', 'Delete the account profile folder after removal', false)
        .action(async (options: { account: string; purge?: boolean }) => {
          await runBridgeCommand(() =>
            bridgeRemoveAccount({
              accountId: options.account,
              purge: options.purge ?? false,
            })
          )
        })
    )
    .addCommand(
      new Command('doctor').description('Run diagnostics and return JSON').action(async () => {
        await runBridgeCommand(() => bridgeDoctor())
      })
    )

  program
    .command('add')
    .description('Add a new account using ChatGPT browser login (device auth optional)')
    .requiredOption('--label <name>', 'Account label')
    .option('--device-auth', 'Use device-code login instead of direct browser flow', false)
    .action(async (options: { label: string; deviceAuth?: boolean }) => {
      const result = await addAccount(options.label, {
        loginMode: options.deviceAuth ? 'device' : 'browser',
      })
      console.log(`Added account: ${displayAccountName(result.account)}`)
      if (result.warning) {
        console.log(`Warning: ${result.warning}`)
      }
    })

  program
    .command('remove')
    .description('Remove account metadata by id or exact label')
    .argument('<id-or-label>', 'Account id or exact label')
    .option('--purge', 'Delete account profile folder under ~/.codex-switch/profiles/<id>', false)
    .action(async (identifier: string, options: { purge: boolean }) => {
      const result = await removeAccount(identifier, options.purge)
      console.log(`Removed account: ${displayAccountName(result.removed)}`)
      if (options.purge) {
        console.log('Profile directory purged.')
      }
      console.log(`Active account is now: ${result.activeAccountId ?? 'none'}`)
    })

  program
    .command('use')
    .description('Switch active Codex account by id or exact label')
    .argument('<id-or-label>', 'Account id or exact label')
    .action(async (identifier: string) => {
      const result = await useAccount(identifier)
      console.log(`Switched active account to: ${displayAccountName(result.account)}`)
      if (result.warning) {
        console.log(`Warning: ${result.warning}`)
      }
      if (result.switchResult.backupPath) {
        console.log(`Previous auth backup: ${result.switchResult.backupPath}`)
      }
      if (result.switchResult.codexStatusExitCode === 0) {
        const output = result.switchResult.codexStatusStdout.trim()
        if (output) {
          console.log(output)
        }
      } else {
        const message = (result.switchResult.codexStatusStderr || result.switchResult.codexStatusStdout).trim()
        console.log(`Warning: codex login status check failed (${result.switchResult.codexStatusExitCode}): ${message}`)
      }
    })

  program
    .command('status')
    .description('Print account and usage status')
    .option('--json', 'Print JSON output', false)
    .action(async (options: { json: boolean }) => {
      if (options.json) {
        const state = await listState()
        console.log(JSON.stringify(formatStateSummary(state), null, 2))
      } else {
        await printStatusHuman()
      }
    })

  program
    .command('refresh')
    .description('Refresh usage and account status from backend-api/wham endpoint')
    .option('--all', 'Refresh all accounts')
    .option('--account <id-or-label>', 'Refresh specific account by id or label')
    .action(async (options: { all?: boolean; account?: string }) => {
      const useAll = options.all ?? false
      const result = await refreshUsage({
        all: useAll,
        accountId: options.account,
      })

      if (result.updated.length === 0) {
        console.log('No accounts were refreshed.')
        return
      }

      for (const account of result.updated) {
        const five = account.usage.last5Hours.usedPercent
        const weekly = account.usage.weekly.usedPercent
        console.log(
          `${displayAccountName(account)}: 5h=${five == null ? 'n/a' : `${five.toFixed(0)}%`} weekly=${
            weekly == null ? 'n/a' : `${weekly.toFixed(0)}%`
          } status=${account.usage.status}`
        )
      }
    })

  program
    .command('doctor')
    .description('Run local diagnostics for codex-switch setup')
    .action(async () => {
      const report = await runDoctor()
      const hasFailures = report.checks.some((check) => !check.ok)
      console.log(`Doctor report (${new Date(report.generatedAt).toLocaleString()})`)
      for (const check of report.checks) {
        console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.details}`)
      }
      if (hasFailures) {
        process.exitCode = 1
      }
    })

  program
    .command('link-current')
    .description('Link currently logged-in Codex account from ~/.codex/auth.json')
    .action(async () => {
      const result = await ensureCurrentCodexLinked()
      if (!result.linked || !result.account) {
        console.log(result.warning ?? 'Current Codex account is not available.')
        return
      }
      if (result.created) {
        console.log(`Linked current account as: ${displayAccountName(result.account)}`)
      } else {
        console.log(`Current account already linked and active: ${displayAccountName(result.account)}`)
      }
      if (result.warning) {
        console.log(`Warning: ${result.warning}`)
      }
    })

  await program.parseAsync(process.argv)
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`)
  process.exit(1)
})
