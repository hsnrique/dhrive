import { beforeEach, describe, expect, it, vi } from "vitest";

const servers = vi.hoisted(() => ({ ports: [] as number[] }));
vi.mock("@/lib/api", () => ({ devServers: async () => servers.ports }));

import { previewOf, usePreview } from "./preview";

const preview = (folder: string) => previewOf(usePreview.getState(), folder);

describe("the browser tab", () => {
  beforeEach(() => usePreview.setState({ byFolder: {} }));

  it("shows the first dev server found in the project and keeps the owner's own pick", async () => {
    servers.ports = [3000, 5173];
    await usePreview.getState().detect("/shop");
    expect(preview("/shop")).toMatchObject({ url: "http://localhost:3000/", ports: [3000, 5173] });
    usePreview.getState().show("/shop", "http://localhost:5173/");
    await usePreview.getState().detect("/shop");
    expect(preview("/shop").url).toBe("http://localhost:5173/");
    expect(preview("/blog").url).toBeNull();
  });

  it("reloads the page and looks for servers again", async () => {
    servers.ports = [];
    await usePreview.getState().detect("/shop");
    expect(preview("/shop").url).toBeNull();
    servers.ports = [4321];
    usePreview.getState().reload("/shop");
    await vi.waitFor(() => expect(preview("/shop").url).toBe("http://localhost:4321/"));
    expect(preview("/shop").version).toBe(1);
  });
});
