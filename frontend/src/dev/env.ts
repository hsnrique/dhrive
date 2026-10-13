import type { EnvView } from "@/lib/api";

// The Keychain vault (env.rs) in memory, for the browser preview: the same rules, one company's
// worth, with a .env.example that names two keys.

const EXAMPLE = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"];
const vars = new Map<string, string>([["RESEND_API_KEY", "re_test_8d2c41f7a9b3e6c1"]]);
const removed: { name: string; value: string }[] = [];

const hint = (value: string) => (value.length < 12 ? "" : value.slice(-4));

export function view(): EnvView {
  return {
    vars: [...vars].map(([name, value]) => ({ name, hint: hint(value), public: /^(NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_)/.test(name) })),
    missing: EXAMPLE.filter((name) => !vars.has(name)),
    removed: [...new Set(removed.map((r) => r.name))].filter((name) => !vars.has(name)),
  };
}

export function set(name: string, value: string): EnvView {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw "A name is letters, digits and underscores, starting with a letter.";
  vars.set(name, value);
  return view();
}

export function remove(name: string): EnvView {
  const value = vars.get(name);
  if (value === undefined) throw "That variable is already gone.";
  vars.delete(name);
  removed.unshift({ name, value });
  return view();
}

export function restore(name: string): EnvView {
  const at = removed.findIndex((r) => r.name === name);
  if (at < 0) throw "There's nothing to put back under that name.";
  vars.set(name, removed.splice(at, 1)[0].value);
  return view();
}

export const reveal = (name: string) => vars.get(name) ?? "";
