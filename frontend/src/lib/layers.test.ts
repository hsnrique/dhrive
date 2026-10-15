import { describe, expect, it } from "vitest";

import { layerStack, type Layer } from "./layers";

const el = (name: string) => ({ name }) as unknown as HTMLElement;
const layer = (name: string, modal: boolean): Layer & { name: string } => ({ name, el: el(name), modal, close: () => {} });

describe("the open layers", () => {
  it("give Escape to the newest, whatever order they close in", () => {
    const stack = layerStack();
    const sidebar = stack.push(layer("sidebar", true));
    const confirm = stack.push(layer("confirm", true));
    expect((stack.top() as unknown as { name: string }).name).toBe("confirm");
    sidebar();
    expect((stack.top() as unknown as { name: string }).name).toBe("confirm");
    confirm();
    confirm();
    expect(stack.top()).toBeUndefined();
  });

  it("keep within reach only the newest modal and what opened above it", () => {
    const stack = layerStack();
    expect(stack.reachable()).toBeNull();
    stack.push(layer("menu", false));
    expect(stack.reachable(), "a popover alone doesn't wall anything off").toBeNull();
    const dialog = stack.push(layer("dialog", true));
    stack.push(layer("picker", false));
    expect(stack.reachable()?.map((e) => (e as unknown as { name: string }).name)).toEqual(["dialog", "picker"]);
    dialog();
    expect(stack.reachable()).toBeNull();
  });
});
