import { describe, expect, it } from "vitest";

import { checkoutUrl, initialOf, planLine, planName, standing, urgent } from "./account";

const renews = Date.UTC(2026, 10, 8, 12);

describe("an account at a glance", () => {
  it("reads a trial by the days it has left", () => {
    const trial = { state: "trial" as const, email: "ana@acme.com", daysLeft: 9 };
    expect([planName(trial), standing(trial), planLine(trial), urgent(trial)]).toEqual(["Free trial", "Trial · 9 days left", "9 days left of 14. No card until you subscribe.", false]);
    expect(urgent({ ...trial, daysLeft: 2 })).toBe(true);
  });

  it("reads a subscription by its plan and its date", () => {
    const pro = { state: "subscribed" as const, email: "ana@acme.com", renewsAt: renews, canceling: false, plan: "yearly" as const };
    expect(planName(pro)).toBe("dhrive Pro · Yearly");
    expect(standing(pro)).toMatch(/^Pro yearly · renews /);
    expect(planLine({ ...pro, canceling: true })).toMatch(/^Canceled\. It stays yours until /);
    expect(planName({ ...pro, plan: null })).toBe("dhrive Pro");
  });

  it("says when it's over, and why", () => {
    const ended = { state: "ended" as const, email: null, reason: "Your free days are over." };
    expect([planName(ended), standing(ended), planLine(ended), urgent(ended)]).toEqual(["No plan", "Trial over", "Your free days are over.", true]);
  });

  it("knows who it is and where to subscribe", () => {
    expect(initialOf("ana@acme.com")).toBe("A");
    expect(initialOf(null)).toBe("?");
    expect(checkoutUrl("yearly")).toBe("https://dhrive.app/api/checkout?plan=yearly");
  });
});
