import { turns } from "@/lib/turns";

// One writer at a time per folder, whoever it is: a conversation's code step, a company task working
// in the company's own folder, an army task merging back into it, an undo, a backup's commit. Two at
// once mix their edits, and every change list, undo and commit with them (an army task works in its
// own copy and takes the folder only to land).
export const editing = turns();

// Holds the folder for as long as `work` runs, after every writer before it.
export async function inFolder<T>(folder: string, work: () => Promise<T>): Promise<T> {
  // Free, it starts in this very tick; busy, it waits its turn.
  const release = editing.takeNow(folder) ?? (await editing.take(folder));
  try {
    return await work();
  } finally {
    release();
  }
}
