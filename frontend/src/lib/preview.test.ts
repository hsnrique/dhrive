import { describe, expect, it } from "vitest";

import { localUrl, portUrl } from "./preview";

describe("the browser tab's address", () => {
  it("takes a port, a host and port, or a full local URL", () => {
    expect(localUrl("3000")).toBe("http://localhost:3000/");
    expect(localUrl(" localhost:5173/shop?x=1 ")).toBe("http://localhost:5173/shop?x=1");
    expect(localUrl("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080/");
    expect(localUrl("3000/admin")).toBe("http://localhost:3000/admin");
    expect(portUrl(4321)).toBe("http://localhost:4321/");
  });

  it("refuses anything that isn't this Mac's own dev server", () => {
    for (const input of ["", "example.com", "https://evil.test:443", "http://localhost", "javascript:alert(1)", "file:///etc/passwd", "https://localhost:3000"]) {
      expect(localUrl(input), input).toBeNull();
    }
  });
});
