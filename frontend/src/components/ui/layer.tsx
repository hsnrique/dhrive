import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { layerStack } from "@/lib/layers";
import { cn } from "@/lib/utils";

// What every dialog and popover does the same way (lib/layers.ts keeps the order): Escape closes the
// newest only, focus moves in when it opens and back where it was when it closes, and a modal leaves
// the rest of the window inert under it, so Tab and the pointer can't reach behind it.

const layers = layerStack();
let listening = false;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function onEscape(e: KeyboardEvent) {
  // A terminal owns its Escape: the CLI in it may be asking for one.
  if (e.key !== "Escape" || e.defaultPrevented || (e.target as Element | null)?.closest?.(".xterm")) return;
  const top = layers.top();
  if (!top) return;
  e.preventDefault();
  top.close();
}

// Where an element sits, as child positions from the body: a row that swapped its trigger for a
// question puts a new trigger back in the same place, and focus finds it there.
const pathOf = (el: Element) => {
  const path: number[] = [];
  for (let at: Element | null = el; at?.parentElement && at !== document.body; at = at.parentElement) path.unshift(Array.prototype.indexOf.call(at.parentElement.children, at));
  return path;
};
const atPath = (path: number[]) => path.reduce<Element | null>((at, i) => at?.children[i] ?? null, document.body);

// The last two things that had focus, each with where it sat while it was there: by the time a layer
// starts, a field inside it may have taken focus (autoFocus), or the trigger may be gone already (a
// row that swapped it for a question), and focus goes back to what came before either.
type Spot = { el: HTMLElement; path: number[] };
let current: Spot | null = null;
let previous: Spot | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    previous = current;
    current = { el: e.target, path: pathOf(e.target) };
  });
}

function giveBack({ el, path }: Spot) {
  if (el.isConnected) return el.focus();
  requestAnimationFrame(() => {
    const again = atPath(path);
    if (document.activeElement === document.body && again instanceof HTMLElement && again.matches(FOCUSABLE)) again.focus();
  });
}

function syncInert() {
  const reachable = layers.reachable();
  for (const child of Array.from(document.body.children)) {
    if (child instanceof HTMLElement) child.inert = reachable ? !reachable.some((el) => child.contains(el)) : false;
  }
}

// `active` lets a popover that renders only while open call this unconditionally.
export function useLayer(ref: RefObject<HTMLElement | null>, onClose: () => void, { modal = false, focus = true, active = true } = {}) {
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    if (!active) return;
    if (!listening) window.addEventListener("keydown", onEscape);
    listening = true;
    const el = ref.current;
    const focused = document.activeElement;
    const before = !focused || focused === document.body ? current : el?.contains(focused) ? previous : focused instanceof HTMLElement ? { el: focused, path: pathOf(focused) } : null;
    const pop = layers.push({ el, modal, close: () => close.current() });
    if (modal) syncInert();
    // An autoFocus field inside has focus already; otherwise the first thing to use, or the layer itself.
    if (focus && el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    return () => {
      pop();
      if (modal) syncInert();
      const now = document.activeElement;
      // Back where the owner was, unless they've moved on to something else meanwhile.
      if (focus && before && (!now || now === document.body || el?.contains(now))) giveBack(before);
    };
  }, [ref, modal, focus, active]);
}

// A modal over the window: the dim behind it closes it, as Escape does.
export function Dialog({ onClose, label, labelledBy, role = "dialog", top = false, className, children }: { onClose: () => void; label?: string; labelledBy?: string; role?: "dialog" | "alertdialog"; top?: boolean; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayer(panel, onClose, { modal: true });
  return createPortal(
    <div className={cn("fade-in fixed inset-0 z-50 flex justify-center bg-black/55 p-6", top ? "items-start pt-[14vh]" : "items-center")} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role={role} aria-modal="true" aria-label={label} aria-labelledby={labelledBy} tabIndex={-1} className={cn("pop-in w-full rounded-2xl border border-border bg-popover shadow-dialog outline-none", className)}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
