import { archiveCompanyRecord, readCompanyRecord, saveCompanyRecord, type RecordName } from "@/lib/api";
import { useApp } from "./app";

// Keeps one of a company's records (records.rs, a file in its folder) in step with a store. Each
// project's file is read once and merged in before anything is written back, so a write never lands
// on data it hasn't seen. Writes go one at a time per project and always carry the latest state, so an
// older one never lands last. What the store let go of is archived before the save that drops it. A
// file that can't be read is never saved over: it stays as it is and the owner hears why.

export interface Keeper {
  open: (projectId: string) => Promise<void>;
  persist: (projectId: string, letGo?: unknown[]) => void;
}

// `apply` merges what the file holds (null when there's none) into the store, and says whether the
// result should be written back (a first save, or a merge with what was there before it was read).
export function keeper(name: RecordName, current: (projectId: string) => unknown, apply: (projectId: string, saved: unknown) => boolean): Keeper {
  const opened = new Map<string, Promise<void>>();
  const dirty = new Set<string>();
  const flushing = new Set<string>();
  const letGoBy = new Map<string, unknown[]>();

  const open = (projectId: string) => {
    let reading = opened.get(projectId);
    if (!reading) {
      reading = readCompanyRecord(projectId, name).then((saved) => {
        if (apply(projectId, saved ?? null)) persist(projectId);
      });
      // A read that failed is tried again the next time.
      reading.catch(() => opened.delete(projectId));
      opened.set(projectId, reading);
    }
    return reading;
  };

  const save = async (projectId: string) => {
    const letGo = letGoBy.get(projectId) ?? [];
    letGoBy.delete(projectId);
    if (letGo.length) {
      try {
        await archiveCompanyRecord(projectId, name, letGo);
      } catch (error) {
        letGoBy.set(projectId, [...letGo, ...(letGoBy.get(projectId) ?? [])]);
        throw error;
      }
    }
    await saveCompanyRecord(projectId, name, current(projectId));
  };

  const flush = async (projectId: string) => {
    if (flushing.has(projectId)) return;
    flushing.add(projectId);
    try {
      await open(projectId);
      while (dirty.delete(projectId)) {
        try {
          await save(projectId);
        } catch (error) {
          dirty.add(projectId);
          throw error;
        }
      }
    } catch (error) {
      useApp.getState().reportError(error);
    } finally {
      flushing.delete(projectId);
    }
  };

  const persist = (projectId: string, letGo: unknown[] = []) => {
    if (letGo.length) letGoBy.set(projectId, [...(letGoBy.get(projectId) ?? []), ...letGo]);
    dirty.add(projectId);
    void flush(projectId);
  };

  // Every project's record is read as soon as the project is known, so its company shows its history.
  useApp.subscribe((state, before) => {
    if (state.projects !== before.projects) state.projects.forEach((p) => void open(p.id).catch(useApp.getState().reportError));
  });

  return { open, persist };
}
