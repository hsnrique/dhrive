import { useId } from "react";

import type { Engine } from "@/lib/api";
import { cn } from "@/lib/utils";

// Codex's mark: its scalloped cloud, lavender to deep blue, with a ">_" prompt. The eight lobes are
// arcs between points on a circle, so the shape stays even at 12 px.
const CODEX_CLOUD = "M14.76 5.35A2.89 2.89 0 0 1 18.65 9.24A2.89 2.89 0 0 1 18.65 14.76A2.89 2.89 0 0 1 14.76 18.65A2.89 2.89 0 0 1 9.24 18.65A2.89 2.89 0 0 1 5.35 14.76A2.89 2.89 0 0 1 5.35 9.24A2.89 2.89 0 0 1 9.24 5.35A2.89 2.89 0 0 1 14.76 5.35Z";

function CodexMark({ className }: { className?: string }) {
  // Each mark gets its own gradient id; a shared one breaks wherever its first copy is hidden.
  const gradient = useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5 flex-none", className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B8A6F8" />
          <stop offset="0.5" stopColor="#6E80F4" />
          <stop offset="1" stopColor="#3025EE" />
        </linearGradient>
      </defs>
      <path d={CODEX_CLOUD} fill={`url(#${gradient})`} />
      <path d="M8.6 9.3 10.7 12l-2.1 2.7M12.6 14.7h3.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Antigravity's mark: an arch rising off the ground, in Google's four colors.
function AntigravityMark({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5 flex-none", className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.38" stopColor="#EA4335" />
          <stop offset="0.66" stopColor="#FBBC04" />
          <stop offset="1" stopColor="#34A853" />
        </linearGradient>
      </defs>
      <path d="M4.5 20c0-8.5 3.4-15 7.5-15s7.5 6.5 7.5 15" fill="none" stroke={`url(#${gradient})`} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

// Small marks that tell the CLIs apart at a glance.
export function EngineMark({ engine, className }: { engine: Engine; className?: string }) {
  if (engine === "claude-code") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5 flex-none", className)}>
        <g stroke="#D97757" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
        </g>
      </svg>
    );
  }
  if (engine === "antigravity") return <AntigravityMark className={className} />;
  if (engine === "ollama") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5 flex-none", className)}>
        <path d="M8.5 3v5M15.5 3v5M6 21v-7.5a6 6 0 0 1 12 0V21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10" cy="14" r="1.2" fill="currentColor" />
        <circle cx="14" cy="14" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  return <CodexMark className={className} />;
}
