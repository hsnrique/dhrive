import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight } from "lucide-react";

import { BRANDS } from "@/lib/brands";
import { cn } from "@/lib/utils";

// A tool's own mark on a small tile tinted with its color, and the link to its site. Both are
// what makes a row in the Tools menu recognizable at a glance, before its name is read.

const LIGHT = "#f2f2f2";

export function ToolMark({ id, size = 30 }: { id: string; size?: number }) {
  const brand = BRANDS[id];
  if (!brand) return <span className="flex-none rounded-md bg-white/[0.06]" style={{ width: size, height: size }} />;
  // Eight-digit hex: the brand color at about an eighth, so the tile carries it without shouting.
  const tint = brand.color === LIGHT ? "rgba(255,255,255,0.06)" : `${brand.color}20`;
  return (
    <span className="flex flex-none items-center justify-center rounded-md border border-white/[0.06]" style={{ width: size, height: size, background: tint }}>
      <svg viewBox={brand.viewBox} aria-hidden fill="currentColor" style={{ color: brand.color, width: size * 0.52, height: size * 0.52 }}>
        {brand.paths.map((d) => <path key={d.slice(0, 24)} d={d} />)}
      </svg>
    </span>
  );
}

export const hostOf = (site: string) => site.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");

export function SiteLink({ site, className }: { site: string; className?: string }) {
  return (
    <button type="button" title={hostOf(site)} aria-label={`Open ${hostOf(site)}`} className={cn("flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground", className)} onClick={() => void openUrl(site).catch(() => undefined)}>
      <ArrowUpRight className="h-3 w-3" />
    </button>
  );
}
