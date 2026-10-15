import { create } from "zustand";

import { accountStatus, cancelSignIn, signIn, signOut, signedOutHere, type AccountStatus } from "@/lib/api";

// This Mac's account as the backend decides it: not signed in, the free days, subscribed, or ended.
// The backend also refuses to start a run without an account in good standing, so this only mirrors it.

const CANCELLED = "Sign-in cancelled.";

interface AccountState {
  status: AccountStatus | null;
  // Whether the gate knows to show; the app stays covered until then, so it never shows and then hides.
  decided: boolean;
  signingIn: boolean;
  signingOut: boolean;
  error: string | null;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  load: () => Promise<void>;
  signIn: () => Promise<void>;
  cancelSignIn: () => void;
  signOut: () => Promise<void>;
}

// Answers come back out of order: a check started before a sign-in or sign-out finishes describes
// the account from before it, and must not replace what the sign-in or sign-out just set. A check
// takes its turn when it starts; signing in or out takes the newest turn when it finishes.
let turn = 0;

export const useAccount = create<AccountState>((set, get) => ({
  status: null,
  decided: false,
  signingIn: false,
  signingOut: false,
  error: null,
  sheetOpen: false,
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),

  load: async () => {
    // Signed out is known on this Mac at once; the full answer may wait on dhrive.app. No answer
    // opens the app: the backend still refuses a run without an account.
    if (!get().decided) {
      const out = await signedOutHere().catch(() => false);
      set((s) => ({ decided: true, status: out && !s.status ? { state: "signedOut" } : s.status }));
    }
    const mine = ++turn;
    try {
      const status = await accountStatus();
      if (mine === turn) set({ status });
    } catch {
      // Without an answer nothing changes; the backend still decides at the next run.
    }
  },

  signIn: async () => {
    set({ signingIn: true, error: null });
    try {
      const status = await signIn();
      turn++;
      set({ status, sheetOpen: false });
    } catch (e) {
      set({ error: String(e) === CANCELLED ? null : String(e) });
    } finally {
      set({ signingIn: false });
    }
  },

  cancelSignIn: () => void cancelSignIn(),

  // Once at a time; a failure says so where the owner asked, instead of vanishing into the console.
  signOut: async () => {
    if (get().signingOut) return;
    set({ signingOut: true, error: null });
    try {
      const status = await signOut();
      turn++;
      set({ status, sheetOpen: false });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ signingOut: false });
    }
  },
}));

export const runsBlocked = (status: AccountStatus | null) => status?.state === "ended" || status?.state === "signedOut";
