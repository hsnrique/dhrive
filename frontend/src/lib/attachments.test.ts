import { describe, expect, it } from "vitest";

import { attachmentFor, pastedImage, pastedKind, withAdded } from "./attachments";

describe("attachments", () => {
  it("are named by their file and told apart as images", () => {
    expect(attachmentFor("/Users/ana/Desktop/Shot 1.PNG")).toEqual({ path: "/Users/ana/Desktop/Shot 1.PNG", name: "Shot 1.PNG", image: true });
    expect(attachmentFor("/a/spec.pdf").image).toBe(false);
  });

  it("take only pasted images, shown as what they are", () => {
    expect(pastedKind("image/jpeg")).toBe("jpg");
    expect(pastedKind("text/html")).toBeNull();
    expect(withAdded([], [pastedImage("/data/attachments/pasted-1a0e.png")])).toEqual([{ path: "/data/attachments/pasted-1a0e.png", name: "Pasted image", image: true }]);
  });

  it("aren't added twice and stop at the limit", () => {
    const once = withAdded([], ["/a/x.png", "/a/x.png", "/a/y.pdf"]);
    expect(once.map((a) => a.name)).toEqual(["x.png", "y.pdf"]);
    expect(withAdded(once, Array.from({ length: 20 }, (_, i) => `/b/${i}.txt`))).toHaveLength(10);
  });
});
