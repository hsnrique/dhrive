import type { AccountStatus } from "./api";

// How an account reads at a glance: who it is and where its plan stands, in the few words the
// sidebar has room for and the fuller lines the account panel shows. The links are dhrive.app's own
// routes, each signing the owner in on the web first if it has to.

export const TRIAL_DAYS = 14;
export const ACCOUNT_URL = "https://dhrive.app/account";
export const PORTAL_URL = "https://dhrive.app/api/portal";
export const checkoutUrl = (plan: "monthly" | "yearly") => `https://dhrive.app/api/checkout?plan=${plan}`;

const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export const emailOf = (status: AccountStatus) => ("email" in status ? status.email : null) ?? null;

export const initialOf = (email: string | null) => (email?.trim()[0] ?? "?").toUpperCase();

export function planName(status: AccountStatus): string {
  if (status.state === "subscribed") return status.plan ? `dhrive Pro · ${status.plan === "yearly" ? "Yearly" : "Monthly"}` : "dhrive Pro";
  if (status.state === "trial") return "Free trial";
  if (status.state === "ended") return "No plan";
  return "dhrive";
}

// The sidebar's line under the email.
export function standing(status: AccountStatus): string {
  if (status.state === "trial") return `Trial · ${days(status.daysLeft)} left`;
  if (status.state === "subscribed") return `${status.plan === "yearly" ? "Pro yearly" : status.plan === "monthly" ? "Pro monthly" : "Pro"} · ${status.canceling ? "ends" : "renews"} ${dateOf(status.renewsAt)}`;
  if (status.state === "ended") return "Trial over";
  return "";
}

// The panel's line under the plan's name.
export function planLine(status: AccountStatus): string {
  if (status.state === "trial") return `${days(status.daysLeft)} left of ${TRIAL_DAYS}. No card until you subscribe.`;
  if (status.state === "subscribed") return status.canceling ? `Canceled. It stays yours until ${dateOf(status.renewsAt)}.` : `Renews ${dateOf(status.renewsAt)}.`;
  if (status.state === "ended") return status.reason;
  return "";
}

export const urgent = (status: AccountStatus) => status.state === "ended" || (status.state === "trial" && status.daysLeft <= 3);
