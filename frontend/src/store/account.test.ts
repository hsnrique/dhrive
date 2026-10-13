import { describe, expect, it, vi } from "vitest";

import type { AccountStatus } from "@/lib/api";

// The backend's account, and every call left pending until the test settles it. A check answers with
// the account as it was when the check started; signing in or out changes it when it finishes.
type Call = { kind: "check" | "signIn" | "signOut"; seen: AccountStatus; resolve: (s: AccountStatus) => void; reject: (e: string) => void };
const pending: Call[] = [];
let backend: AccountStatus = { state: "signedOut" };
const TRIAL: AccountStatus = { state: "trial", email: "dev@example.com", daysLeft: 9 };

const call = (kind: Call["kind"]) => () => new Promise<AccountStatus>((resolve, reject) => pending.push({ kind, seen: backend, resolve, reject }));

vi.mock("@/lib/api", () => ({
  accountStatus: vi.fn(call("check")),
  signIn: vi.fn(call("signIn")),
  signOut: vi.fn(call("signOut")),
  cancelSignIn: vi.fn(async () => {
    const waiting = pending.findIndex((c) => c.kind === "signIn");
    // Tauri rejects with the backend's message, a plain string.
    if (waiting >= 0) pending.splice(waiting, 1)[0].reject("Sign-in cancelled.");
  }),
}));

const { runsBlocked, useAccount } = await import("./account");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

function settle(c: Call) {
  if (c.kind === "check") return c.resolve(c.seen);
  backend = c.kind === "signIn" ? TRIAL : { state: "signedOut" };
  c.resolve(backend);
}

describe("the account in the app", () => {
  it("never goes back to what the account was before a sign-in or sign-out finished", async () => {
    for (let seed = 1; seed <= 80; seed++) {
      const random = prng(seed);
      pending.length = 0;
      backend = { state: "signedOut" };
      useAccount.setState({ status: null, signingIn: false, error: null });
      // Which account every answer since the last sign-in or sign-out may show.
      let settled: AccountStatus | null = null;
      for (let step = 0; step < 40; step++) {
        const roll = random();
        if (roll < 0.35) void useAccount.getState().load();
        else if (roll < 0.45 && !useAccount.getState().signingIn) void useAccount.getState().signIn();
        else if (roll < 0.5) void useAccount.getState().signOut();
        else if (roll < 0.55) useAccount.getState().cancelSignIn();
        else if (pending.length > 0) {
          const c = pending.splice(Math.floor(random() * pending.length), 1)[0];
          settle(c);
          if (c.kind !== "check") settled = backend;
        }
        await flush();
        if (settled) expect(useAccount.getState().status, `seed ${seed}, step ${step}`).toEqual(settled.state === backend.state ? backend : settled);
      }
    }
    // 3,200 macrotask flushes: well under a second here, past the 5 s default on a busy CI runner,
    // where the timed-out loop then keeps running into the next test.
  }, 30_000);

  it("says why signing in failed, but not when the owner cancelled it", async () => {
    pending.length = 0;
    void useAccount.getState().signIn();
    expect(useAccount.getState().signingIn).toBe(true);
    useAccount.getState().cancelSignIn();
    await flush();
    expect(useAccount.getState()).toMatchObject({ signingIn: false, error: null });
    void useAccount.getState().signIn();
    pending.splice(0, 1)[0].reject("Couldn't reach dhrive.app.");
    await flush();
    expect(useAccount.getState().error).toContain("Couldn't reach dhrive.app.");
  });

  it("blocks runs when signed out or ended, never during the free days or a subscription", () => {
    const cases: [AccountStatus | null, boolean][] = [
      [null, false],
      [{ state: "free" }, false],
      [TRIAL, false],
      [{ state: "subscribed", email: "a@b.c", renewsAt: 1, canceling: false, plan: null }, false],
      [{ state: "signedOut" }, true],
      [{ state: "ended", email: null, reason: "x" }, true],
    ];
    for (const [status, blocked] of cases) expect(runsBlocked(status), JSON.stringify(status)).toBe(blocked);
  });
});
