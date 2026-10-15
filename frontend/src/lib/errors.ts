// The errors on screen, newest first. One toast that each new error replaced lost the one before it
// whenever two came close together (a failed save and the retry's own failure); the same message
// again moves to the top with a count rather than stacking a copy.

export interface Shown {
  id: number;
  text: string;
  count: number;
}

export const MAX_SHOWN = 3;

export function withError(shown: Shown[], text: string, id: number): Shown[] {
  const same = shown.find((e) => e.text === text);
  return [{ id, text, count: (same?.count ?? 0) + 1 }, ...shown.filter((e) => e !== same)].slice(0, MAX_SHOWN);
}
