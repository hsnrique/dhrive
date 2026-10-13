import { describe, expect, it } from "vitest";

import { effortLabel } from "./names";

describe("effortLabel", () => {
  it("reads each CLI's level as a person would", () => {
    expect(["low", "xhigh", "max", "minimal"].map(effortLabel)).toEqual(["Low", "Extra high", "Max", "Minimal"]);
  });
});
