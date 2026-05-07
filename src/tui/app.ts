import blessed from "blessed";
import { spawnSync } from "node:child_process";
import { isUnusableAccountUsage } from "../core/account-health";
import {
  addAccount,
  ensureCurrentCodexLinked,
  getActiveAccount,
  listState,
  refreshUsage,
  reloginAccount,
  removeAccount,
  useAccount,
} from "../core/accounts";
import { runDoctor } from "../core/doctor";
import type { Account, AppState, SortMode, UsageHealth } from "../core/types";
import {
  dynamicBarColor,
  inlineUsageBadge,
  nextSortMode,
  relativeTime,
  sortAccountsList,
  sortModeLabel,
  spinnerFrame,
} from "./tui-utils";

type Tone = "info" | "success" | "warn" | "error";

const AUTO_REFRESH_MS = 60_000;
const ACCOUNTS_LIST_MIN_HEIGHT = 5;
const ACCOUNTS_LIST_MAX_HEIGHT_PCT = 0.55;
const NARROW_LIST_BREAKPOINT = 108;
const STACKED_DETAILS_BREAKPOINT = 96;
const MIN_RECOMMENDED_TERMINAL_WIDTH = 92;
const MIN_RECOMMENDED_TERMINAL_HEIGHT = 24;

const ASCII_LOGO_LINE =
  "{bold}{cyan-fg}⚡{/cyan-fg} {white-fg}C O D E X   S W I T C H{/white-fg}{/bold}";

function percentText(value: number | null) {
  return value == null ? "n/a" : `${value.toFixed(0)}%`;
}

function formatReset(value: number | null) {
  if (value == null) return "n/a";
  return new Date(value * 1000).toLocaleString();
}

function colorForHealth(status: UsageHealth) {
  switch (status) {
    case "ok":
      return "green";
    case "stale":
      return "yellow";
    case "relogin_required":
      return "red";
    case "error":
      return "red";
    case "never":
    default:
      return "gray";
  }
}

function toneToColor(tone: Tone) {
  switch (tone) {
    case "success":
      return "green";
    case "warn":
      return "yellow";
    case "error":
      return "red";
    case "info":
    default:
      return "cyan";
  }
}

function displayName(account: Account | null | undefined) {
  if (!account) return "none";
  return account.email ?? account.label;
}

function stripTags(text: string) {
  return text.replace(/\{[^}]*\}/g, "");
}

function visibleLength(text: string) {
  return stripTags(text).length;
}

function truncatePlain(text: string, maxLength: number) {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…";
  return `${text.slice(0, maxLength - 1)}…`;
}

function padTagged(text: string, targetLength: number) {
  const diff = targetLength - visibleLength(text);
  return diff > 0 ? text + " ".repeat(diff) : text;
}

function isSwitchBlocked(usage: Account["usage"]) {
  return isUnusableAccountUsage(usage) || usage.status === "relogin_required";
}

function renderBar(percent: number | null, width: number) {
  if (percent == null) {
    return `{gray-fg}${"░".repeat(width)}{/gray-fg}`;
  }

  const bounded = Math.max(0, Math.min(100, percent));
  const filled = Math.round((bounded / 100) * width);
  const empty = width - filled;
  const color = dynamicBarColor(100 - bounded); // remainingPercent → invert for "used" perspective
  const left =
    filled > 0 ? `{${color}-fg}${"█".repeat(filled)}{/${color}-fg}` : "";
  const right = empty > 0 ? `{gray-fg}${"░".repeat(empty)}{/gray-fg}` : "";
  return `${left}${right}`;
}

function renderGradientBar(remainingPercent: number | null, width: number) {
  if (remainingPercent == null) {
    return `{gray-fg}${"░".repeat(width)}{/gray-fg}`;
  }

  const bounded = Math.max(0, Math.min(100, remainingPercent));
  const filled = Math.round((bounded / 100) * width);
  const empty = width - filled;
  const color = dynamicBarColor(remainingPercent);
  const left =
    filled > 0 ? `{${color}-fg}${"█".repeat(filled)}{/${color}-fg}` : "";
  const right = empty > 0 ? `{gray-fg}${"░".repeat(empty)}{/gray-fg}` : "";
  return `${left}${right}`;
}

function refreshSummary(account: Account) {
  const status = account.usage.status;
  if (isUnusableAccountUsage(account.usage)) {
    return "{red-fg}Remove or replace this account{/red-fg}";
  }
  if (status === "relogin_required") {
    return "{yellow-fg}Press L to re-login before switching{/yellow-fg}";
  }
  if (status === "stale") {
    return "{yellow-fg}Refresh usage before relying on these numbers{/yellow-fg}";
  }
  if (status === "error") {
    return "{yellow-fg}Inspect the error below before switching{/yellow-fg}";
  }
  return "{green-fg}Ready to switch{/green-fg}";
}

const HEADER_HEIGHT = 3;
const FOOTER_HEIGHT = 5;

function computeAccountsListHeight(accountCount: number, screenHeight: number) {
  const availableHeight = screenHeight - HEADER_HEIGHT - FOOTER_HEIGHT;
  const maxHeight = Math.floor(availableHeight * ACCOUNTS_LIST_MAX_HEIGHT_PCT);
  // +2 for border
  const desired = Math.max(ACCOUNTS_LIST_MIN_HEIGHT, accountCount + 2);
  return Math.min(desired, maxHeight);
}

function promptText(
  screen: blessed.Widgets.Screen,
  title: string,
  placeholder = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "60%",
      height: 9,
      border: "line",
      style: {
        border: { fg: "cyan" },
        bg: "#101820",
      },
      label: ` ${title} `,
    });

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      right: 2,
      content: "Enter value and press Enter. Esc to cancel.",
      style: { fg: "gray" },
    });

    const input = blessed.textbox({
      parent: modal,
      top: 3,
      left: 2,
      right: 2,
      height: 3,
      border: "line",
      inputOnFocus: true,
      keys: true,
      mouse: true,
      value: placeholder,
      style: {
        fg: "white",
        border: { fg: "white" },
      },
    });

    const cleanup = (value: string | null) => {
      modal.destroy();
      screen.render();
      resolve(value);
    };

    input.on("submit", (value) => cleanup((value ?? "").trim() || null));
    input.key(["escape", "C-c"], () => cleanup(null));

    input.focus();
    input.readInput();
    screen.render();
  });
}

function promptConfirm(
  screen: blessed.Widgets.Screen,
  title: string,
  message: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "58%",
      height: 8,
      border: "line",
      label: ` ${title} `,
      style: {
        border: { fg: "yellow" },
        bg: "#101820",
      },
    });

    blessed.text({
      parent: modal,
      top: 2,
      left: 2,
      right: 2,
      content: message,
      tags: true,
    });

    blessed.text({
      parent: modal,
      bottom: 1,
      left: 2,
      content: "Press Y to confirm, N or Esc to cancel",
      style: { fg: "gray" },
    });

    const done = (ok: boolean) => {
      modal.destroy();
      screen.render();
      resolve(ok);
    };

    modal.key(["y", "Y"], () => done(true));
    modal.key(["n", "N", "escape", "C-c"], () => done(false));
    modal.focus();
    screen.render();
  });
}

function showModal(
  screen: blessed.Widgets.Screen,
  title: string,
  content: string,
  borderColor = "cyan"
): Promise<void> {
  return new Promise((resolve) => {
    const modal = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "72%",
      height: "70%",
      border: "line",
      label: ` ${title} `,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: " " },
      keys: true,
      vi: true,
      style: {
        border: { fg: borderColor },
        bg: "#0d1117",
        fg: "white",
      },
    });

    modal.setContent(content);

    const close = () => {
      modal.destroy();
      screen.render();
      resolve();
    };

    modal.key(["escape", "q", "C-c", "enter"], close);
    modal.focus();
    screen.render();
  });
}

export async function runTui(options?: { deferCurrentLink?: boolean }) {
  let state: AppState = await listState();
  let selectedAccountId: string | null =
    getActiveAccount(state)?.id ?? state.accounts[0]?.id ?? null;
  let busy = false;
  let statusMessage = "Ready";
  let statusTone: Tone = "info";
  let sortMode: SortMode = "name";
  let filterText = "";
  let spinnerTick = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  const screen = blessed.screen({
    smartCSR: true,
    title: "codex-switch",
    dockBorders: true,
    fullUnicode: true,
  });

  // ── Header (compact single-line title bar) ─────────────
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: HEADER_HEIGHT,
    tags: true,
    border: "line",
    style: {
      border: { fg: "#2bb3a3" },
      fg: "white",
      bg: "#0d1117",
    },
  });

  // ── Accounts list (full-width) ─────────────────────────
  const initialListHeight = computeAccountsListHeight(
    state.accounts.length,
    typeof screen.height === "number" ? screen.height : 35
  );

  const accountsList = blessed.list({
    parent: screen,
    top: HEADER_HEIGHT,
    left: 0,
    width: "100%",
    height: initialListHeight,
    border: "line",
    label: " Accounts ",
    tags: true,
    keys: true,
    mouse: true,
    vi: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: " " },
    style: {
      fg: "white",
      bg: "#0d1117",
      border: { fg: "#2bb3a3" },
      selected: {
        fg: "#0d1117",
        bg: "#2bb3a3",
      },
      item: {
        fg: "white",
      },
    },
  });

  // ── Detail pane (full-width, fills middle) ─────────────
  const details = blessed.box({
    parent: screen,
    top: HEADER_HEIGHT + initialListHeight,
    left: 0,
    right: 0,
    bottom: FOOTER_HEIGHT,
    border: "line",
    label: " Usage Details ",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: " ",
    },
    style: {
      fg: "white",
      bg: "#0d1117",
      border: { fg: "#2bb3a3" },
    },
  });

  // ── Footer (status + context + keybindings) ────────────
  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: FOOTER_HEIGHT,
    border: "line",
    tags: true,
    style: {
      border: { fg: "#2bb3a3" },
      fg: "white",
      bg: "#0d1117",
    },
  });

  function selectedAccount() {
    if (!state.accounts.length) return null;
    if (!selectedAccountId) return state.accounts[0];
    return (
      state.accounts.find((account) => account.id === selectedAccountId) ??
      state.accounts[0]
    );
  }

  function setStatus(message: string, tone: Tone = "info") {
    statusMessage = message;
    statusTone = tone;
  }

  function startSpinner() {
    if (spinnerTimer) return;
    spinnerTick = 0;
    spinnerTimer = setInterval(() => {
      spinnerTick++;
      refreshFooter();
      screen.render();
    }, 80);
  }

  function stopSpinner() {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }

  function getDisplayAccounts(): Account[] {
    let accounts = sortAccountsList(state.accounts, sortMode);

    if (filterText) {
      const lower = filterText.toLowerCase();
      accounts = accounts.filter((account) => {
        const name = displayName(account).toLowerCase();
        return name.includes(lower);
      });
    }

    return accounts;
  }

  function refreshHeader() {
    const active = getActiveAccount(state);
    const activeLabel = displayName(active);
    const activeColor =
      active && isSwitchBlocked(active.usage) ? "red" : "green";
    const countText = `${state.accounts.length} account${state.accounts.length !== 1 ? "s" : ""}`;

    header.setContent(
      ` ${ASCII_LOGO_LINE}  {gray-fg}│{/gray-fg}  Active: {${activeColor}-fg}{bold}${activeLabel}{/bold}{/${activeColor}-fg}  {gray-fg}│{/gray-fg}  ${countText}  {gray-fg}│{/gray-fg}  Sort: {cyan-fg}${sortModeLabel(sortMode)}{/cyan-fg}${filterText ? `  {gray-fg}│{/gray-fg}  Filter: {yellow-fg}${filterText}{/yellow-fg}` : ""}`
    );
  }

  function refreshAccountsList() {
    const active = getActiveAccount(state);
    const displayAccounts = getDisplayAccounts();

    const terminalHeight =
      typeof screen.height === "number" ? screen.height : 35;
    const listHeight = computeAccountsListHeight(
      displayAccounts.length,
      terminalHeight
    );
    accountsList.height = listHeight;
    details.top = HEADER_HEIGHT + listHeight;

    const terminalWidth = typeof screen.width === "number" ? screen.width : 120;
    // Available content width = terminal - 2 (border) - 2 (padding)
    const contentWidth = terminalWidth - 4;

    const listItems = displayAccounts.map((account) => {
      const isActive = active?.id === account.id;
      const activePrefix = isActive ? "●" : "○";
      const badge = inlineUsageBadge(account);
      const isDead = isUnusableAccountUsage(account.usage);
      const name = displayName(account);
      const remaining = account.usage.last5Hours.remainingPercent;
      const remainingColor = dynamicBarColor(remaining);
      const remainingText =
        remaining == null
          ? "{gray-fg}n/a{/gray-fg}"
          : `{${remainingColor}-fg}${remaining.toFixed(0)}%{/${remainingColor}-fg}`;
      const used5h = account.usage.last5Hours.usedPercent;
      const usedWeek = account.usage.weekly.usedPercent;
      const updatedText = relativeTime(account.usage.updatedAt);
      const isNarrow = contentWidth < NARROW_LIST_BREAKPOINT;
      const maxNameLen = isNarrow
        ? Math.max(18, contentWidth - 18)
        : Math.max(20, Math.min(34, Math.floor(contentWidth * 0.3)));
      const displayLabel = truncatePlain(name, maxNameLen);
      const paddedName = padTagged(displayLabel, maxNameLen);

      const healthColor = colorForHealth(account.usage.status);
      const healthTag = isDead
        ? "{red-fg}dead{/red-fg}"
        : account.usage.status === "relogin_required"
          ? "{red-fg}relogin{/red-fg}"
          : `{${healthColor}-fg}${account.usage.status}{/${healthColor}-fg}`;
      const statusPrefixColor =
        isDead || account.usage.status === "relogin_required"
          ? "red"
          : isActive
            ? "green"
            : "white";

      if (isNarrow) {
        return `{${statusPrefixColor}-fg}${activePrefix}{/${statusPrefixColor}-fg} {bold}${displayLabel}{/bold} ${badge}  ${healthTag}  {gray-fg}${updatedText}{/gray-fg}`;
      }

      const planTag = account.usage.planType
        ? `{gray-fg}${truncatePlain(account.usage.planType, 10)}{/gray-fg}`
        : "{gray-fg}--{/gray-fg}";
      const row = `{${statusPrefixColor}-fg}${activePrefix}{/${statusPrefixColor}-fg} ${paddedName} ${badge}  5h rem ${remainingText}  ${healthTag}  ${planTag}  {gray-fg}${updatedText}{/gray-fg}`;

      if (used5h == null && usedWeek == null) {
        return `${row}  {gray-fg}no data{/gray-fg}`;
      }
      return row;
    });

    accountsList.setItems(
      listItems.length > 0 ? listItems : ["  No accounts yet. Press A to add."]
    );
    accountsList.setLabel(
      ` Accounts ${displayAccounts.length}/${state.accounts.length} • ${sortModeLabel(sortMode)} `
    );

    // Preserve selection
    const displayAccsLocal = displayAccounts;
    if (displayAccsLocal.length > 0) {
      const index = displayAccsLocal.findIndex(
        (account) => account.id === selectedAccount()?.id
      );
      accountsList.select(Math.max(0, index));
    }
  }

  function refreshDetails() {
    const selected = selectedAccount();
    const terminalWidth = typeof screen.width === "number" ? screen.width : 120;

    if (!selected) {
      details.setContent(
        [
          "",
          "  {bold}No accounts configured{/bold}",
          "",
          "  Press {cyan-fg}A{/cyan-fg} to add an account.",
          "  You will log in through ChatGPT browser auth.",
          "",
          "  Press {cyan-fg}?{/cyan-fg} for help.",
        ].join("\n")
      );
      return;
    }

    const healthColor = colorForHealth(selected.usage.status);
    const isDead = isUnusableAccountUsage(selected.usage);
    const active = getActiveAccount(state);
    const isActive = active?.id === selected.id;
    const five = selected.usage.last5Hours;
    const weekly = selected.usage.weekly;
    const detailsWidth =
      typeof details.width === "number" ? details.width : terminalWidth;
    const innerWidth = Math.max(32, detailsWidth - 4);
    const useStackedWindows = innerWidth < STACKED_DETAILS_BREAKPOINT;
    const detailsLabel = isActive
      ? " Usage Details • active "
      : " Usage Details • standby ";
    details.setLabel(detailsLabel);

    const statusIcon =
      selected.usage.status === "ok"
        ? "✓"
        : selected.usage.status === "error"
          ? "✗"
          : "●";

    const emailLabel = `{bold}{white-fg}${displayName(selected)}{/white-fg}{/bold}`;
    const roleBadge = isActive
      ? "{green-fg}[ACTIVE]{/green-fg}"
      : "{gray-fg}[STANDBY]{/gray-fg}";
    const sourceLabel =
      selected.usage.source === "wham_usage"
        ? "{green-fg}live{/green-fg}"
        : "{yellow-fg}session log{/yellow-fg}";
    const statusLine = `  ${roleBadge}  {${healthColor}-fg}${statusIcon} ${selected.usage.status}{/${healthColor}-fg}  {gray-fg}│{/gray-fg}  ${refreshSummary(selected)}`;
    const metaLine = `  Source ${sourceLabel}  {gray-fg}│{/gray-fg}  Plan ${selected.usage.planType ?? "{gray-fg}unknown{/gray-fg}"}  {gray-fg}│{/gray-fg}  Updated {bold}${relativeTime(selected.usage.updatedAt)}{/bold}`;
    const barWidth = useStackedWindows
      ? Math.max(16, innerWidth - 6)
      : Math.max(12, Math.floor((innerWidth - 6) / 2) - 4);
    const separator = "  {gray-fg}│{/gray-fg}  ";

    const fiveHeader = "{bold}5-Hour Window{/bold}";
    const weekHeader = "{bold}Weekly Window{/bold}";

    const fiveBar = renderGradientBar(five.remainingPercent, barWidth);
    const weekBar = renderGradientBar(weekly.remainingPercent, barWidth);

    const fiveStats = `Used: {bold}${percentText(five.usedPercent)}{/bold}  Rem: {bold}${percentText(five.remainingPercent)}{/bold}`;
    const weekStats = `Used: {bold}${percentText(weekly.usedPercent)}{/bold}  Rem: {bold}${percentText(weekly.remainingPercent)}{/bold}`;

    const fiveReset = `Resets: ${formatReset(five.resetAt)}`;
    const weekReset = `Resets: ${formatReset(weekly.resetAt)}`;

    const renderWindowBlock = (
      title: string,
      bar: string,
      stats: string,
      reset: string
    ) => [title, bar, stats, reset];

    const content: string[] = [`  ${emailLabel}`, statusLine, metaLine];

    if (selected.usage.error) {
      content.push(`  {red-fg}Error: ${selected.usage.error}{/red-fg}`);
    }
    if (isDead) {
      content.push(
        "  {red-fg}⚠ This account is deleted/deactivated. Remove it with D.{/red-fg}"
      );
    }
    if (selected.usage.status === "relogin_required") {
      content.push(
        "  {red-fg}⚠ Re-login required. Re-add this account to continue.{/red-fg}"
      );
    }

    content.push(`  {gray-fg}${"─".repeat(Math.min(innerWidth, 90))}{/gray-fg}`);

    if (useStackedWindows) {
      for (const line of renderWindowBlock(
        fiveHeader,
        fiveBar,
        fiveStats,
        fiveReset
      )) {
        content.push(`  ${line}`);
      }
      content.push("");
      for (const line of renderWindowBlock(
        weekHeader,
        weekBar,
        weekStats,
        weekReset
      )) {
        content.push(`  ${line}`);
      }
    } else {
      const colWidth = Math.floor((innerWidth - 6) / 2);
      const leftBlock = renderWindowBlock(
        fiveHeader,
        fiveBar,
        fiveStats,
        fiveReset
      );
      const rightBlock = renderWindowBlock(
        weekHeader,
        weekBar,
        weekStats,
        weekReset
      );
      for (let index = 0; index < leftBlock.length; index += 1) {
        content.push(
          `  ${padTagged(leftBlock[index], colWidth)}${separator}${rightBlock[index]}`
        );
      }
    }

    details.setContent(content.join("\n"));
  }

  function refreshFooter() {
    const toneColor = toneToColor(statusTone);
    const spinner = busy ? `${spinnerFrame(spinnerTick)} ` : "";
    const displayAccounts = getDisplayAccounts();
    const selectedIndex = displayAccounts.findIndex(
      (account) => account.id === selectedAccount()?.id
    );
    const terminalWidth = typeof screen.width === "number" ? screen.width : 120;
    const terminalHeight =
      typeof screen.height === "number" ? screen.height : 35;
    const sizeWarning =
      terminalWidth < MIN_RECOMMENDED_TERMINAL_WIDTH ||
      terminalHeight < MIN_RECOMMENDED_TERMINAL_HEIGHT
        ? "  {yellow-fg}Tight terminal: widen for full layout{/yellow-fg}"
        : "";
    const statusLine = ` ${spinner}{${toneColor}-fg}${statusMessage}{/${toneColor}-fg}${sizeWarning}`;
    const contextLine =
      displayAccounts.length > 0
        ? selectedIndex >= 0
          ? ` {gray-fg}Selected{/gray-fg} ${selectedIndex + 1}/${displayAccounts.length}  {gray-fg}Focus{/gray-fg} Accounts`
          : ` {yellow-fg}Selected account hidden by filter{/yellow-fg}`
        : " {gray-fg}No accounts loaded{/gray-fg}";
    const keysLine = ` {gray-fg}A{/gray-fg}dd  {gray-fg}L{/gray-fg}ogin  {gray-fg}D{/gray-fg}el  {gray-fg}⏎{/gray-fg}use  {gray-fg}R{/gray-fg}efr  {gray-fg}⇧R{/gray-fg}all  {gray-fg}S{/gray-fg}ort  {gray-fg}/{/gray-fg}find  {gray-fg}C{/gray-fg}opy  {gray-fg}?{/gray-fg}help  {gray-fg}Q{/gray-fg}uit`;
    footer.setContent(`${statusLine}\n${contextLine}\n${keysLine}`);
  }

  function refreshView() {
    refreshHeader();
    refreshAccountsList();
    refreshDetails();
    refreshFooter();
    screen.render();
  }

  async function syncState() {
    state = await listState();
    if (
      !selectedAccountId ||
      !state.accounts.find((account) => account.id === selectedAccountId)
    ) {
      selectedAccountId =
        getActiveAccount(state)?.id ?? state.accounts[0]?.id ?? null;
    }
  }

  async function runBusy(taskName: string, fn: () => Promise<void>) {
    if (busy) {
      setStatus("Another operation is already running.", "warn");
      refreshView();
      return;
    }

    busy = true;
    setStatus(taskName, "info");
    startSpinner();
    refreshView();

    try {
      await fn();
    } catch (error) {
      setStatus((error as Error).message, "error");
    } finally {
      busy = false;
      stopSpinner();
      await syncState();
      refreshView();
    }
  }

  async function handleAdd() {
    const label = await promptText(screen, "Add account", "My account");
    if (!label) {
      setStatus("Add canceled.", "warn");
      refreshView();
      return;
    }

    await runBusy("Starting ChatGPT login…", async () => {
      const result = await addAccount(label, {
        loginMode: "browser",
        loginStdio: "pipe",
      });
      selectedAccountId = result.account.id;
      setStatus(
        result.warning ?? `Added account "${displayName(result.account)}".`,
        result.warning ? "warn" : "success"
      );
    });
  }

  async function handleDelete() {
    const account = selectedAccount();
    if (!account) {
      setStatus("No account selected.", "warn");
      refreshView();
      return;
    }

    const confirm = await promptConfirm(
      screen,
      "Remove account",
      `Remove {bold}${displayName(account)}{/bold}? This removes metadata only.`
    );
    if (!confirm) {
      setStatus("Remove canceled.", "warn");
      refreshView();
      return;
    }

    await runBusy(`Removing ${displayName(account)}…`, async () => {
      const result = await removeAccount(account.id, false);
      selectedAccountId = result.activeAccountId;
      setStatus(`Removed account "${displayName(result.removed)}".`, "success");
    });
  }

  async function handleSwitch() {
    const account = selectedAccount();
    if (!account) {
      setStatus("No account selected.", "warn");
      refreshView();
      return;
    }
    if (isUnusableAccountUsage(account.usage)) {
      setStatus(`"${displayName(account)}" is deleted/deactivated.`, "error");
      refreshView();
      return;
    }
    if (account.usage.status === "relogin_required") {
      setStatus(`"${displayName(account)}" needs re-login first.`, "error");
      refreshView();
      return;
    }

    await runBusy(`Switching to ${displayName(account)}…`, async () => {
      const result = await useAccount(account.id);
      selectedAccountId = result.account.id;

      if (result.switchResult.codexStatusExitCode === 0 && !result.warning) {
        setStatus(`Switched to "${displayName(result.account)}".`, "success");
      } else if (result.warning) {
        setStatus(`Switched with warning: ${result.warning}`, "warn");
      } else {
        const reason = (
          result.switchResult.codexStatusStderr ||
          result.switchResult.codexStatusStdout
        ).trim();
        setStatus(`Switched, but status check failed: ${reason}`, "warn");
      }
    });
  }

  async function handleRefresh() {
    const account = selectedAccount();
    if (!account) {
      setStatus("No account selected.", "warn");
      refreshView();
      return;
    }

    await runBusy(`Refreshing ${displayName(account)}…`, async () => {
      const result = await refreshUsage({ accountId: account.id });
      const refreshed = result.updated.find((entry) => entry.id === account.id);
      if (refreshed?.usage.status === "ok") {
        setStatus(`Refreshed "${displayName(account)}".`, "success");
      } else {
        setStatus(
          `Refresh finished: ${refreshed?.usage.status ?? "unknown"} for "${displayName(account)}".`,
          "warn"
        );
      }
    });
  }

  async function handleRelogin() {
    const account = selectedAccount();
    if (!account) {
      setStatus("No account selected.", "warn");
      refreshView();
      return;
    }

    if (isUnusableAccountUsage(account.usage)) {
      setStatus(`"${displayName(account)}" is deleted/deactivated.`, "error");
      refreshView();
      return;
    }

    await runBusy(`Starting ChatGPT login for ${displayName(account)}…`, async () => {
      const result = await reloginAccount(account.id, {
        loginMode: "browser",
        loginStdio: "pipe",
      });
      selectedAccountId = result.account.id;
      setStatus(
        result.warning ?? `Re-logged in "${displayName(result.account)}".`,
        result.warning ? "warn" : "success"
      );
    });
  }

  async function handleRefreshAll() {
    if (state.accounts.length === 0) {
      setStatus("No accounts to refresh.", "warn");
      refreshView();
      return;
    }

    await runBusy(
      `Refreshing all ${state.accounts.length} accounts…`,
      async () => {
        const result = await refreshUsage({ all: true });
        const okCount = result.updated.filter(
          (a) => a.usage.status === "ok"
        ).length;
        setStatus(
          `Refreshed ${result.updated.length} accounts (${okCount} ok).`,
          "success"
        );
      }
    );
  }

  function handleSort() {
    sortMode = nextSortMode(sortMode);
    setStatus(`Sort: ${sortModeLabel(sortMode)}`, "info");
    refreshView();
  }

  async function handleFilter() {
    const text = await promptText(
      screen,
      "Filter accounts (Esc to clear)",
      filterText || ""
    );
    filterText = text ?? "";
    if (filterText) {
      setStatus(`Filtering: "${filterText}"`, "info");
    } else {
      setStatus("Filter cleared.", "info");
    }
    refreshView();
  }

  async function handleDoctor() {
    setStatus("Running diagnostics…", "info");
    refreshView();

    try {
      const report = await runDoctor();
      const lines = [
        `{bold}Doctor Report{/bold}  ${new Date(report.generatedAt).toLocaleString()}`,
        "",
      ];

      for (const check of report.checks) {
        const icon = check.ok ? "{green-fg}✓{/green-fg}" : "{red-fg}✗{/red-fg}";
        lines.push(`  ${icon}  {bold}${check.name}{/bold}`);
        lines.push(`     ${check.details}`);
        lines.push("");
      }

      const hasFailures = report.checks.some((c) => !c.ok);
      if (hasFailures) {
        lines.push(
          "{yellow-fg}Some checks failed. See details above.{/yellow-fg}"
        );
      } else {
        lines.push("{green-fg}All checks passed!{/green-fg}");
      }

      await showModal(
        screen,
        "Diagnostics",
        lines.join("\n"),
        hasFailures ? "yellow" : "green"
      );
      setStatus("Diagnostics complete.", hasFailures ? "warn" : "success");
    } catch (error) {
      setStatus(`Doctor failed: ${(error as Error).message}`, "error");
    }
    refreshView();
  }

  function handleCopy() {
    const account = selectedAccount();
    if (!account) {
      setStatus("No account selected.", "warn");
      refreshView();
      return;
    }

    const email = account.email ?? account.label;
    try {
      const clipboardCapableScreen = screen as blessed.Widgets.Screen & {
        copyToClipboard?: (text: string) => void;
      };
      if (typeof clipboardCapableScreen.copyToClipboard === "function") {
        clipboardCapableScreen.copyToClipboard(email);
        setStatus(`Copied "${email}" to clipboard.`, "success");
      } else {
        const result = spawnSync("pbcopy", [], {
          input: email,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        if ((result.status ?? 1) === 0) {
          setStatus(`Copied "${email}" to clipboard.`, "success");
        } else {
          setStatus("Clipboard copy failed in this terminal.", "error");
        }
      }
    } catch {
      setStatus("Copy failed. Clipboard integration unavailable.", "error");
    }
    refreshView();
  }

  async function handleHelp() {
    const helpContent = [
      "{bold}{cyan-fg}Keybindings{/cyan-fg}{/bold}",
      "",
      "  {cyan-fg}A{/cyan-fg}         Add a new account via ChatGPT browser login",
      "  {cyan-fg}L{/cyan-fg}         Re-login the selected account",
      "  {cyan-fg}D{/cyan-fg}         Remove the selected account",
      "  {cyan-fg}Enter{/cyan-fg}     Switch to the selected account",
      "  {cyan-fg}R{/cyan-fg}         Refresh usage for selected account",
      "  {cyan-fg}Shift+R{/cyan-fg}   Refresh usage for ALL accounts",
      "  {cyan-fg}S{/cyan-fg}         Cycle sort mode (name → 5h → weekly)",
      "  {cyan-fg}/{/cyan-fg}         Filter/search accounts by name",
      "  {cyan-fg}C{/cyan-fg}         Copy selected account email to clipboard",
      "  {cyan-fg}Ctrl+D{/cyan-fg}    Run doctor diagnostics",
      "  {cyan-fg}?{/cyan-fg}         Show this help",
      "  {cyan-fg}Q{/cyan-fg}         Quit",
      "",
      "{bold}{cyan-fg}Navigation{/cyan-fg}{/bold}",
      "",
      "  {cyan-fg}↑/↓{/cyan-fg}       Move selection in account list",
      "  {cyan-fg}j/k{/cyan-fg}       Vim-style up/down",
      "",
      "{bold}{cyan-fg}Account Status Icons{/cyan-fg}{/bold}",
      "",
      "  {green-fg}●{/green-fg}         Active account",
      "  ○         Inactive account",
      "  {red-fg}✗{/red-fg}         Dead/deactivated account",
      "  {red-fg}⚠{/red-fg}         Needs re-login",
      "",
      "{gray-fg}Press Esc, Q, or Enter to close this help.{/gray-fg}",
    ].join("\n");

    await showModal(screen, "Help", helpContent);
    refreshView();
  }

  function handleSelectionChange() {
    const index = (accountsList as unknown as { selected: number }).selected;
    const displayAccounts = getDisplayAccounts();
    const account = displayAccounts[index];
    if (account) {
      selectedAccountId = account.id;
      refreshDetails();
      refreshFooter();
      screen.render();
    }
  }

  // ── Key bindings ────────────────────────────────────────

  accountsList.on("keypress", (_ch, key) => {
    if (
      key.name === "up" ||
      key.name === "down" ||
      key.name === "k" ||
      key.name === "j"
    ) {
      setTimeout(handleSelectionChange, 0);
    }
  });

  accountsList.on("click", () => setTimeout(handleSelectionChange, 0));
  accountsList.key(["enter"], () => {
    void handleSwitch();
  });

  screen.key(["a"], () => {
    void handleAdd();
  });

  screen.key(["l"], () => {
    void handleRelogin();
  });

  screen.key(["d"], () => {
    void handleDelete();
  });

  screen.key(["r"], () => {
    void handleRefresh();
  });

  screen.key(["R", "S-r"], () => {
    void handleRefreshAll();
  });

  screen.key(["s"], () => {
    handleSort();
  });

  screen.key(["/"], () => {
    void handleFilter();
  });

  screen.key(["c"], () => {
    handleCopy();
  });

  screen.key(["C-d"], () => {
    void handleDoctor();
  });

  screen.key(["?"], () => {
    void handleHelp();
  });

  // ── Responsive resize ───────────────────────────────────
  screen.on("resize", () => {
    refreshView();
  });

  // ── Auto-refresh ────────────────────────────────────────
  const autoRefreshTimer = setInterval(() => {
    if (busy) return;
    const active = getActiveAccount(state);
    if (!active) return;

    void refreshUsage({ accountId: active.id })
      .then(async () => {
        await syncState();
        setStatus(`Auto-refreshed ${displayName(active)}.`, "info");
        refreshView();
      })
      .catch((error) => {
        setStatus(`Auto-refresh failed: ${(error as Error).message}`, "warn");
        refreshView();
      });
  }, AUTO_REFRESH_MS);

  // ── Initial render ──────────────────────────────────────
  await syncState();
  refreshView();
  accountsList.focus();

  if (options?.deferCurrentLink) {
    await runBusy("Syncing current Codex account…", async () => {
      const result = await ensureCurrentCodexLinked();
      if (result.linked && result.account) {
        selectedAccountId = result.account.id;
        if (result.warning) {
          setStatus(`Synced with warning: ${result.warning}`, "warn");
        } else {
          setStatus(`Synced: ${displayName(result.account)}.`, "success");
        }
      } else if (result.warning) {
        setStatus(result.warning, "warn");
      } else {
        setStatus("Current Codex account was not linked.", "warn");
      }
    });
  }

  if (state.accounts.length > 0) {
    await runBusy(`Refreshing all ${state.accounts.length} accounts…`, async () => {
      const result = await refreshUsage({ all: true });
      const okCount = result.updated.filter(
        (account) => account.usage.status === "ok"
      ).length;
      setStatus(
        `Startup refresh complete: ${result.updated.length} accounts (${okCount} ok).`,
        "success"
      );
    });
  }

  // ── Shutdown ────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(autoRefreshTimer);
      stopSpinner();
      screen.destroy();
      resolve();
    };

    screen.key(["q", "Q", "C-c"], shutdown);
  });
}
