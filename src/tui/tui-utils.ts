import type { Account, SortMode } from "../core/types";

const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

export function relativeTime(timestamp: number | null): string {
  if (timestamp == null) return "never";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

export function dynamicBarColor(remainingPercent: number | null): string {
  if (remainingPercent == null) return "gray";
  if (remainingPercent <= 20) return "red";
  if (remainingPercent <= 50) return "yellow";
  return "green";
}

export function spinnerFrame(tick: number): string {
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

export function inlineUsageBadge(account: Account): string {
  const remaining = account.usage.last5Hours.remainingPercent;
  if (remaining == null) return "{gray-fg}[░░░░ n/a]{/gray-fg}";

  const width = 4;
  const bounded = Math.max(0, Math.min(100, remaining));
  const filled = Math.round((bounded / 100) * width);
  const empty = width - filled;
  const color = dynamicBarColor(remaining);
  const bar = `${"▓".repeat(filled)}${"░".repeat(empty)}`;
  return `{${color}-fg}[${bar} ${bounded.toFixed(0)}%]{/${color}-fg}`;
}

export function compactUsageText(account: Account): string {
  const five = account.usage.last5Hours.usedPercent;
  const week = account.usage.weekly.usedPercent;
  const fiveColor = dynamicBarColor(five != null ? 100 - five : null);
  const weekColor = dynamicBarColor(week != null ? 100 - week : null);
  const fiveText =
    five != null
      ? `{${fiveColor}-fg}${five.toFixed(0)}%{/${fiveColor}-fg}`
      : "{gray-fg}n/a{/gray-fg}";
  const weekText =
    week != null
      ? `{${weekColor}-fg}${week.toFixed(0)}%{/${weekColor}-fg}`
      : "{gray-fg}n/a{/gray-fg}";
  return `5h:${fiveText} w:${weekText}`;
}

export function sortAccountsList(
  accounts: Account[],
  mode: SortMode
): Account[] {
  const copy = [...accounts];
  switch (mode) {
    case "name":
      return copy.sort((a, b) => {
        const nameA = (a.email ?? a.label).toLowerCase();
        const nameB = (b.email ?? b.label).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    case "usage_5h":
      return copy.sort((a, b) => {
        const usedA = a.usage.last5Hours.usedPercent ?? -1;
        const usedB = b.usage.last5Hours.usedPercent ?? -1;
        return usedA - usedB;
      });
    case "usage_weekly":
      return copy.sort((a, b) => {
        const usedA = a.usage.weekly.usedPercent ?? -1;
        const usedB = b.usage.weekly.usedPercent ?? -1;
        return usedA - usedB;
      });
    default:
      return copy;
  }
}

export function nextSortMode(current: SortMode): SortMode {
  const modes: SortMode[] = ["name", "usage_5h", "usage_weekly"];
  const index = modes.indexOf(current);
  return modes[(index + 1) % modes.length];
}

export function sortModeLabel(mode: SortMode): string {
  switch (mode) {
    case "name":
      return "Name";
    case "usage_5h":
      return "5h Usage";
    case "usage_weekly":
      return "Weekly Usage";
  }
}
