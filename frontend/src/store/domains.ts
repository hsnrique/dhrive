import { create } from "zustand";

import { addSiteDomain, checkSiteDomain, removeSiteDomain, siteDomains, type SiteDomains } from "@/lib/api";
import { newlyLive } from "@/lib/domains";
import { entry } from "@/lib/log";
import { useLog } from "./log";

// Each company's own domains, as the site host has them. Adding or checking one can take up to a
// minute when it goes live (the host waits for its certificate); a domain going live goes in the
// company's timeline.

export interface OwnDomains extends Partial<SiteDomains> {
  // The domain being added, checked or removed.
  busy: string | null;
  error: string | null;
}

export const NO_DOMAINS: OwnDomains = { busy: null, error: null };

interface DomainsState {
  byProject: Record<string, OwnDomains>;
  load: (projectId: string) => Promise<void>;
  add: (projectId: string, domain: string) => Promise<boolean>;
  check: (projectId: string, domain: string) => Promise<void>;
  remove: (projectId: string, domain: string) => Promise<void>;
}

export const useDomains = create<DomainsState>((set, get) => {
  const of = (projectId: string) => get().byProject[projectId] ?? NO_DOMAINS;
  const patch = (projectId: string, change: Partial<OwnDomains>) => set({ byProject: { ...get().byProject, [projectId]: { ...of(projectId), ...change } } });
  // One call to the host, its answer kept and any domain that went live told to the timeline.
  const ask = async (projectId: string, busy: string, call: () => Promise<SiteDomains>) => {
    if (of(projectId).busy) return false;
    patch(projectId, { busy, error: null });
    try {
      const answer = await call();
      for (const domain of newlyLive(of(projectId).domains ?? [], answer.domains)) useLog.getState().add(projectId, entry("published", `${domain} is live`, { url: `https://${domain}` }));
      patch(projectId, { ...answer, busy: null });
      return true;
    } catch (error) {
      patch(projectId, { busy: null, error: String(error) });
      return false;
    }
  };
  return {
    byProject: {},
    load: async (projectId) => {
      try {
        patch(projectId, { ...(await siteDomains(projectId)), error: null });
      } catch (error) {
        patch(projectId, { error: String(error) });
      }
    },
    add: (projectId, domain) => ask(projectId, domain.trim(), () => addSiteDomain(projectId, domain.trim())),
    check: async (projectId, domain) => void (await ask(projectId, domain, () => checkSiteDomain(projectId, domain))),
    remove: async (projectId, domain) => void (await ask(projectId, domain, () => removeSiteDomain(projectId, domain))),
  };
});

export const useDomainsOf = (projectId: string) => useDomains((s) => s.byProject[projectId] ?? NO_DOMAINS);
