import { describe, expect, it } from "vitest";

import { foundedByDhrive } from "./founding";

describe("foundedByDhrive", () => {
  it("is only a company folder right under ~/dhrive", () => {
    expect(foundedByDhrive("/Users/ana/dhrive/acme")).toBe(true);
    expect(foundedByDhrive("/Users/ana/dhrive")).toBe(false);
    expect(foundedByDhrive("/Users/ana/dhrive/acme/web")).toBe(false);
    expect(foundedByDhrive("/Users/ana/code/acme")).toBe(false);
  });
});
