import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { layerStack } from "@/lib/layers";
import { cn } from "@/lib/utils";

// What every dialog and popover does the same way (lib/layers.ts keeps the order): Escape closes the
// newest only, focus moves in when it opens and back where it was when it closes, and a modal leaves
// the rest of the window inert under it, so Tab and the pointer can't reach behind it.

const layers = layerStack();
let listening = false;
// What had focus before the latest move: a layer whose field takes focus on mount (autoFocus) has
// already moved it by the time the layer starts, so this is where it returns to.
let lastLeft: HTMLElement | null = null;
if (typeof document !== "undefined") document.addEventListener("focusin", (e) => (lastLeft = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : lastLeft));

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function onEscape(e: KeyboardEvent) {
  // A terminal owns its Escape: the CLI in it may be asking for one.
  if (e.key !== "Escape" || e.defaultPrevented || (e.target as Element | null)?.closest?.(".xterm")) return;
  const top = layers.top();
  if (!top) return;
  e.preventDefault();
  top.close();
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
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const before = focused && el?.contains(focused) ? lastLeft : focused;
    const pop = layers.push({ el, modal, close: () => close.current() });
    if (modal) syncInert();
    // An autoFocus field inside has focus already; otherwise the first thing to use, or the layer itself.
    if (focus && el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    return () => {
      pop();
      if (modal) syncInert();
      const now = document.activeElement;
      // Back where the owner was, unless they've moved on to something else meanwhile.
      if (focus && before?.isConnected && (!now || now === document.body || el?.contains(now))) before.focus();
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
