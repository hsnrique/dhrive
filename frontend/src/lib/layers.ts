// Every dialog and popover open right now, oldest first. Escape and focus belong to the newest: a
// confirm opened from the folded-out sidebar closes alone, and the sidebar stays. While a modal is
// up, only it and what opened above it (a picker inside it) can be reached.

export interface Layer {
  el: HTMLElement | null;
  modal: boolean;
  close: () => void;
}

export function layerStack() {
  const open: Layer[] = [];
  return {
    push(layer: Layer) {
      open.push(layer);
      return () => {
        const at = open.indexOf(layer);
        if (at >= 0) open.splice(at, 1);
      };
    },
    top: (): Layer | undefined => open[open.length - 1],
    // null while no modal is up: everything is reachable.
    reachable(): HTMLElement[] | null {
      const modal = open.map((l) => l.modal).lastIndexOf(true);
      if (modal < 0) return null;
      return open.slice(modal).flatMap((l) => (l.el ? [l.el] : []));
    },
  };
}
