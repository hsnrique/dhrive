// Remembered conveniences (last folder, last CLI/model per step). Storage can be missing or throw,
// and the app must work the same without it.
export function readSaved(key: string): unknown {
  try {
    const raw = localStorage.getItem(`dhrive.${key}`);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`dhrive.${key}`, JSON.stringify(value));
  } catch {
    // Not remembering a choice is fine.
  }
}
