import { openUrl } from "@tauri-apps/plugin-opener";

import { useApp } from "@/store/app";
import { Button } from "@/components/ui/button";
import { EngineMark } from "./EngineMark";

// Shown until a supported CLI is installed: dhrive drives the CLIs, it doesn't replace them.
export function NoCli() {
  const clis = useApp((s) => s.clis);
  const boot = useApp((s) => s.boot);
  return (
    <section className="grid gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="grid gap-1">
        <h2 className="text-[15px] font-semibold">Install an AI CLI first</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">Install one, sign in from your terminal, then check again.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {clis.map((cli) => (
          <Button key={cli.engine} variant="soft" size="lg" onClick={() => void openUrl(cli.docsUrl)}>
            <EngineMark engine={cli.engine} />
            Install {cli.label}
          </Button>
        ))}
        <Button variant="ghost" size="lg" onClick={() => void boot()}>
          Check again
        </Button>
      </div>
    </section>
  );
}
