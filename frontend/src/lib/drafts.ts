import { useEffect, useState } from "react";

import { readSaved, save } from "@/lib/storage";

// What the owner was typing in each composer (a conversation's, a company's chat or its next task,
// the founding sentence), so switching away and back keeps it, even across a restart. Only the most
// recent ones are kept.

const KEY = "drafts";
const MAX_DRAFTS = 50;

function all(): Record<string, string> {
  const saved = readSaved(KEY);
  return saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, string>) : {};
}

export function readDraft(key: string): string {
  const draft = all()[key];
  return typeof draft === "string" ? draft : "";
}

export function writeDraft(key: string, text: string) {
  const { [key]: _old, ...rest } = all();
  const next = text.trim() ? { ...rest, [key]: text } : rest;
  const keys = Object.keys(next);
  save(KEY, Object.fromEntries(keys.slice(Math.max(0, keys.length - MAX_DRAFTS)).map((k) => [k, next[k]])));
}

// A composer's text, kept as the draft under `key` as it's typed; set it to "" once it's sent.
export function useKeptText(key: string) {
  const [text, setText] = useState(() => readDraft(key));
  useEffect(() => writeDraft(key, text), [key, text]);
  return [text, setText] as const;
}
