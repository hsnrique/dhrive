import { describe, expect, it } from "vitest";

import { outside, parseReview, reviewFixPrompt, reviewPrompt, territoryNote, territoryOf } from "./review";

describe("an army task's territory", () => {
  it("reads folders from what the owner wrote, never one that climbs out", () => {
    expect(territoryOf(" server, ./api/\nlib/db , ../etc, ")).toEqual(["server/", "api/", "lib/db/"]);
    expect(territoryOf("src/config.ts")).toEqual(["src/config.ts"]);
  });

  it("names the files changed outside it, the shared ones and an empty territory never counting", () => {
    const files = ["server/api.ts", "app/page.tsx", "docs/api/billing.md", "package.json", "package-lock.json", "README.md"];
    expect(outside(files, "server")).toEqual(["app/page.tsx"]);
    expect(outside(files, "")).toEqual([]);
    expect(outside(["server-two/x.ts"], "server"), "a folder's name isn't a prefix of another's").toEqual(["server-two/x.ts"]);
  });

  it("tells the agent what it owns only when it owns something", () => {
    expect(territoryNote("server")).toContain("You own server/");
    expect(territoryNote(" ")).toBe("");
  });
});

describe("a review before landing", () => {
  it("hands the reviewer the task, the diff and the standard, and asks for a plain verdict", () => {
    const prompt = reviewPrompt("API", "Add the billing API", "+export const bill = 1;");
    expect(prompt).toContain('"API"');
    expect(prompt).toContain("+export const bill = 1;");
    expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("engineering standard");
  });

  it("holds the task back only for changes it can name", () => {
    expect(parseReview("APPROVE\nLooks good")).toEqual({ approve: true, issues: [] });
    expect(parseReview("**CHANGES**\n- Validate the amount\n- Add a test\nThanks")).toEqual({ approve: false, issues: ["Validate the amount", "Add a test"] });
    expect(parseReview("CHANGES but I won't say which")).toEqual({ approve: true, issues: [] });
    expect(parseReview("")).toEqual({ approve: true, issues: [] });
    expect(reviewFixPrompt(["Add a test"])).toContain("- Add a test");
  });
});
