// One at a time per key, in the order asked: `take` resolves once every earlier holder of the key has
// let go, with the function that lets go. Used so code steps in the same project never overlap.
export function turns() {
  const tails = new Map<string, Promise<void>>();
  return {
    take(key: string): Promise<() => void> {
      const before = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((resolve) => (release = resolve));
      const tail = before.then(() => mine);
      tails.set(key, tail);
      // The last one out leaves nothing behind for the key.
      void tail.then(() => tails.get(key) === tail && tails.delete(key));
      return before.then(() => release);
    },
    busy: (key: string) => tails.has(key),
  };
}
