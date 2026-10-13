// What the owner types at their DNS provider for a domain: the record's name is "@" for the domain
// itself and the part in front of it otherwise; the TXT that proves it lives at _dhrive in front.
// ponytail: guesses the registered domain from its last two labels; "acme.co.uk" reads as a
// subdomain "acme" of "co.uk". A public suffix list fixes that if owners hit it.
export function recordName(domain: string): string {
  const labels = domain.split(".");
  return labels.length <= 2 ? "@" : labels.slice(0, -2).join(".");
}

export function recordNameFor(kind: string, domain: string): string {
  const name = recordName(domain);
  return kind === "TXT" ? (name === "@" ? "_dhrive" : `_dhrive.${name}`) : name;
}

// Domains that went live between two answers from the host.
export const newlyLive = (before: { domain: string; live: boolean }[], after: { domain: string; live: boolean }[]) =>
  after.filter((d) => d.live && !before.some((b) => b.domain === d.domain && b.live)).map((d) => d.domain);

// The address the company goes by, in the toolbar and the Website section: the owner's favorite while
// it's live (their own domain, or the site's own address), and the site's own address otherwise.
export function favoriteAddress(published: string | null, favorite: string | undefined, domains: { domain: string; live: boolean }[] | undefined): string | null {
  if (!published || !favorite) return published;
  const live = favorite === hostOf(published) || (domains ?? []).some((d) => d.domain === favorite && d.live);
  return live ? `https://${favorite}` : published;
}

export const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
