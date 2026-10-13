import { describe, expect, it } from "vitest";

import type { Connected, McpServer, ServerStatus } from "@/lib/api";
import { itemSummary, serverSummary, sortServers } from "./connections";

const server = (name: string, status: ServerStatus): McpServer => ({ name, status, source: null, tools: null, error: null });
const item = (name: string, source: string | null, on = true): Connected => ({ name, detail: null, source, on });

describe("a CLI's connections", () => {
  it("lists servers connected first, then the ones that need the owner, then the rest", () => {
    const sorted = sortServers([server("zeta", "failed"), server("slack", "needs-auth"), server("Canva", "connected"), server("off", "disabled"), server("Asana", "connected")]);
    expect(sorted.map((s) => s.name)).toEqual(["Asana", "Canva", "slack", "zeta", "off"]);
  });

  it("counts servers by state in that order, leaving out states nobody is in", () => {
    expect(serverSummary([server("a", "failed"), server("b", "connected"), server("c", "needs-auth"), server("d", "needs-auth")])).toBe("1 connected · 2 need sign-in · 1 failed");
    expect(serverSummary([])).toBe("");
  });

  it("counts where things come from only when there's more than one place, and what's off", () => {
    const skills = [item("pdf", "claude.ai sync"), item("a", "sales plugin"), item("b", "brand-voice plugin", false), item("mine", "user")];
    expect(itemSummary(skills)).toBe("2 from plugins · 1 claude.ai sync · 1 user · 1 off");
    expect(itemSummary([item("x", "user"), item("y", "user")])).toBe("");
  });
});
