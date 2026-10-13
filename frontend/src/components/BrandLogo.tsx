import { cn } from "@/lib/utils";

// The dhrive wordmark/glyph, drawn in the current text color via a mask (same technique as the
// old CSS) so it inherits theme color. Size comes from the className (e.g. "h-5 w-5").
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="dhrive"
      className={cn("inline-block flex-none bg-current", className)}
      style={{
        WebkitMaskImage: "url(/dhrive-logo-sf.png)",
        maskImage: "url(/dhrive-logo-sf.png)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
