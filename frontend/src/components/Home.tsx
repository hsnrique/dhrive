import { FolderOpen } from "lucide-react";

import { useApp } from "@/store/app";
import { openFolderAsCompany } from "@/store/company";
import { useFounding } from "@/store/founding";
import { BrandLogo } from "./BrandLogo";
import { Founding } from "./company/Founding";
import { NoCli } from "./NoCli";

// Where dhrive opens: a company to start, from a sentence or a surprise, and the way into a project
// the owner already has.
export function Home() {
  const clis = useApp((s) => s.clis);
  const booted = useApp((s) => s.booted);
  const noCli = booted && !clis.some((cli) => cli.installed);
  const founding = useFounding((s) => s.phase !== "idle");

  return (
    <div data-tauri-drag-region className="flex h-full overflow-y-auto">
      <div className="m-auto w-full max-w-[680px] px-8 py-16">
        <BrandLogo className="mb-7 h-9 w-9" />
        {noCli ? (
          <NoCli />
        ) : (
          <>
            <Founding />
            {!founding && (
            <button type="button" className="mt-8 flex items-center gap-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground" onClick={() => void openFolderAsCompany()}>
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              Or open a project you already have
              <kbd className="font-sans text-[11px] text-muted-foreground">⌘O</kbd>
            </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
