import { describe, expect, it } from "vitest";

import { createUser } from "./users";

describe("users", () => {
  it("get an id", () => {
    expect(createUser("Ana", "ana@shop.test").id).toBeTruthy();
  });
});
