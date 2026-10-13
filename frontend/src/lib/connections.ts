import type { Connected, McpServer, ServerStatus } from "@/lib/api";

// How a CLI's connections read on its screen: servers in the order the owner should look at them,
// and one line of counts per list.

export const STATUS_ORDER: ServerStatus[] = ["connected", "needs-auth", "failed", "connecting", "configured", "disabled"];

export const STATUS_LABEL: Record<ServerStatus, string> = {
  connected: "connected",
  "needs-auth": "need sign-in",
  failed: "failed",
  connecting: "connecting",
  configured: "set up",
  disabled: "off",
};

export function sortServers(servers: McpServer[]): McpServer[] {
  const rank = (s: McpServer) => STATUS_ORDER.indexOf(s.status);
  return [...servers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// "8 connected · 38 need sign-in · 11 failed"
export function serverSummary(servers: McpServer[]): string {
  return STATUS_ORDER.map((status) => [status, servers.filter((s) => s.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${STATUS_LABEL[status]}`)
    .join(" · ");
}

// "97 from plugins · 10 claude.ai sync · 2 user", biggest first; anything off is counted apart.
export function itemSummary(items: Connected[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const from = item.source?.endsWith(" plugin") ? "from plugins" : (item.source ?? "built in");
    counts.set(from, (counts.get(from) ?? 0) + 1);
  }
  const off = items.filter((i) => !i.on).length;
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([from, count]) => `${count} ${from}`);
  return [...(counts.size > 1 ? parts : []), ...(off ? [`${off} off`] : [])].join(" · ");
}
