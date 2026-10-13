import { describe, expect, it } from "vitest";

import { favoriteAddress, hostOf, newlyLive, recordName, recordNameFor } from "./domains";

describe("own domains", () => {
  it("names the DNS record the way providers ask for it", () => {
    expect(recordName("acme.com")).toBe("@");
    expect(recordName("www.acme.com")).toBe("www");
    expect(recordName("shop.eu.acme.com")).toBe("shop.eu");
    expect(recordNameFor("TXT", "acme.com")).toBe("_dhrive");
    expect(recordNameFor("TXT", "www.acme.com")).toBe("_dhrive.www");
    expect(recordNameFor("A", "www.acme.com")).toBe("www");
  });

  it("notices a domain going live", () => {
    expect(newlyLive([{ domain: "acme.com", live: false }], [{ domain: "acme.com", live: true }, { domain: "www.acme.com", live: false }])).toEqual(["acme.com"]);
    expect(newlyLive([{ domain: "acme.com", live: true }], [{ domain: "acme.com", live: true }])).toEqual([]);
  });

  it("goes by the favorite only while it's live, and by the site's own address otherwise", () => {
    const site = "https://acme.dhrive.site";
    const domains = [{ domain: "acme.com", live: true }, { domain: "shop.acme.com", live: false }];
    expect(favoriteAddress(site, "acme.com", domains)).toBe("https://acme.com");
    expect(favoriteAddress(site, "acme.dhrive.site", domains)).toBe(site);
    expect(favoriteAddress(site, "shop.acme.com", domains), "not live yet").toBe(site);
    expect(favoriteAddress(site, "acme.com", []), "removed since").toBe(site);
    expect(favoriteAddress(site, undefined, domains)).toBe(site);
    expect(favoriteAddress(null, "acme.com", domains), "never published").toBeNull();
    expect(hostOf("https://acme.dhrive.site/")).toBe("acme.dhrive.site");
  });
});
