import { useLayoutEffect, useState, type RefObject } from "react";

// How a company's screen is laid out by the room it has, not the window's: the sidebar folding or
// the chat docking changes the room without the window changing. Sections fill as many columns as
// fit (at most three), and the chat docks beside them only while they keep two columns.

export type SectionId = "overview" | "tasks" | "army" | "website" | "environment" | "documents" | "brief";

export const COLUMN_MIN = 290;
export const GAP = 24;
const MAX_COLUMNS = 3;
// Room for two columns of sections plus the docked chat; below it the chat slides over instead.
export const CHAT_DOCKS_AT = 1000;

export function columnCount(width: number): number {
  const fit = Math.floor((width - GAP * 2 + GAP) / (COLUMN_MIN + GAP));
  return Math.max(1, Math.min(MAX_COLUMNS, fit));
}

// What's happening and what's next lead, with the army that does it; the reference material
// (documents, brief) closes. The environment sits under the website, which is what most often needs it.
export function columnsFor(count: number): SectionId[][] {
  if (count >= 3) return [["overview", "website", "environment"], ["tasks"], ["army", "documents", "brief"]];
  if (count === 2) return [["overview", "tasks"], ["army", "website", "environment", "documents", "brief"]];
  return [["overview", "tasks", "army", "website", "environment", "documents", "brief"]];
}

// Measured before the first paint, so nothing lays out twice (the chat popping in a frame late).
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
