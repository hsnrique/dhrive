// Actions that show while a card is pointed at or holds focus, laid over the end of its last line
// instead of pushing the list down. They stay in Tab order, show the moment one of them has focus,
// and stay while one of them has a picker open (its panel lives outside the card).
export const revealed = (surface: string) =>
  `pointer-events-none absolute bottom-1.5 right-2 flex items-center gap-1.5 pl-6 opacity-0 transition-opacity [mask-image:linear-gradient(to_right,transparent,#000_24px)] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-has-[[aria-expanded=true]]:pointer-events-auto group-has-[[aria-expanded=true]]:opacity-100 ${surface}`;
