import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Check, Copy, Star, X } from "lucide-react";

import { hostOf, recordNameFor } from "@/lib/domains";
import { cn } from "@/lib/utils";
import { useDomains, useDomainsOf } from "@/store/domains";
import { useAddress, useFavorite } from "@/store/favorite";
import { usePublishedOf } from "@/store/publish";
import { buttonVariants } from "@/components/ui/button";
import { TypeToConfirm } from "../TypeToConfirm";

// The owner's own domain for the site: type it, set the two DNS records shown, check. Live ones open;
// one still waiting shows exactly what to set, and after a check what its DNS still gets wrong, until
// it points at dhrive and names the site. Once there's one, the site's own address is listed with it,
// and the owner stars the one the company goes by (store/favorite.ts).

const MAX = 3;
const pill = buttonVariants({ variant: "soft", size: "sm" });

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500))).catch(() => undefined);
  return (
    <button type="button" title={`Copy ${value}`} className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-foreground transition-colors hover:text-foreground/80" onClick={copy}>
      <span className="min-w-0 truncate">{value}</span>
      {copied ? <Check className="h-3 w-3 flex-none" /> : <Copy className="h-3 w-3 flex-none text-muted-foreground" />}
    </button>
  );
}

function Live({ host }: { host: string }) {
  return (
    <button type="button" className="flex items-center gap-1.5 text-[12px] text-foreground/85 transition-colors hover:text-foreground" onClick={() => void openUrl(`https://${host}`).catch(() => undefined)}>
      <span className="h-1.5 w-1.5 rounded-full bg-live" />
      Live
      <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

function Favorite({ projectId, host, on }: { projectId: string; host: string; on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `${host} is the favorite` : `Make ${host} the favorite`}
      title={on ? "The favorite: the toolbar opens this one" : "Make it the favorite"}
      className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      onClick={() => useFavorite.getState().pick(projectId, host)}
    >
      <Star className={cn("h-3.5 w-3.5", on && "fill-attention text-attention")} />
    </button>
  );
}

function Records({ domain, records }: { domain: string; records: { kind: string; value: string }[] }) {
  return (
    <div className="grid gap-2 rounded-xl bg-black/30 px-3 py-2.5">
      <p className="text-[12px] text-muted-foreground">At your domain's DNS, add these records, then check:</p>
      {/* Long names and values shorten (copied whole) rather than push the column wider. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        {["Type", "Name", "Value"].map((head) => <span key={head} className="text-[11.5px] text-muted-foreground">{head}</span>)}
        {records.map(({ kind, value }) => (
          <div key={kind} className="contents">
            <span className="font-mono text-[12px]">{kind}</span>
            <Copyable value={recordNameFor(kind, domain)} />
            <Copyable value={value} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OwnDomains({ projectId }: { projectId: string }) {
  const { domains, records, busy, error } = useDomainsOf(projectId);
  const toSet = (records ?? []).filter((r): r is { kind: string; value: string } => r.value !== null);
  const [typed, setTyped] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const { load, add, check, remove } = useDomains.getState();
  const { url } = usePublishedOf(projectId);
  const address = useAddress(projectId);
  const favorite = address && hostOf(address);
  const own = url && hostOf(url);
  useEffect(() => void load(projectId), [projectId, load]);
  const connect = async () => {
    if (typed.trim() && (await add(projectId, typed))) setTyped("");
  };
  return (
    <div className="grid gap-2">
      <h3 className="flex h-7 items-center px-1 text-[12px] font-medium text-muted-foreground">Domains</h3>
      <ul className="grid gap-1.5">
        {own && (domains?.length ?? 0) > 0 && (
          <li className="flex min-h-11 items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2">
            <span className="min-w-0 truncate text-[13px]">{own}</span>
            <span className="ml-auto" />
            <Live host={own} />
            <Favorite projectId={projectId} host={own} on={favorite === own} />
            <span className="h-6 w-6 flex-none" aria-hidden />
          </li>
        )}
        {(domains ?? []).map(({ domain, live, waiting }) => (
          <li key={domain} className="group grid gap-2.5 rounded-xl border border-border bg-card px-3 py-2">
            <div className="flex min-h-7 items-center gap-2.5">
              <span className="min-w-0 truncate text-[13px]">{domain}</span>
              <span className="ml-auto" />
              {live ? (
                <>
                  <Live host={domain} />
                  <Favorite projectId={projectId} host={domain} on={favorite === domain} />
                </>
              ) : (
                <button type="button" disabled={busy !== null} className={pill} onClick={() => void check(projectId, domain)}>
                  {busy === domain ? "Checking…" : "Check again"}
                </button>
              )}
              <button type="button" aria-label={`Remove ${domain}`} title="Remove" disabled={busy !== null} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100" onClick={() => setRemoving(domain)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {!live && waiting && waiting.length > 0 && (
              <ul className="grid gap-1 px-0.5" aria-label={`What ${domain} still needs`}>
                {waiting.map((line) => (
                  <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-attention">
                    <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-attention" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {!live && toSet.length > 0 && <Records domain={domain} records={toSet} />}
          </li>
        ))}
        {(domains?.length ?? 0) < MAX && (
          <li className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-1 focus-within:border-ring">
            <input
              value={typed}
              aria-label="Your domain"
              placeholder="acme.com"
              spellCheck={false}
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-muted-foreground"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void connect()}
            />
            <button type="button" disabled={!typed.trim() || busy !== null} className={pill} onClick={() => void connect()}>
              {busy !== null && busy === typed.trim() ? "Connecting…" : "Connect"}
            </button>
          </li>
        )}
      </ul>
      {error && <p className="px-1 text-[12.5px] text-failure">{error}</p>}
      {removing && (
        <TypeToConfirm
          title={`Remove ${removing}?`}
          detail={`The site stops answering at ${removing}. Its DNS records can stay; connecting it again later works the same way.`}
          word={removing}
          action="Remove"
          doing="Removing…"
          onConfirm={() => remove(projectId, removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
