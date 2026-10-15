import { cva } from "class-variance-authority";

// Every text field in dhrive: a well a shade under the surface, one hairline that lights when it has
// focus. Single-line fields share the buttons' heights, so a field and its Save line up in a row.
export const fieldVariants = cva(
  "min-w-0 rounded-lg border border-border bg-black/30 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring disabled:opacity-40",
  {
    variants: {
      size: {
        xs: "h-6 px-2 text-[11.5px]",
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-8 px-2.5 text-[12.5px]",
        lg: "h-9 px-3 text-[13px]",
        // A textarea: as tall as its rows, padded for reading.
        area: "px-3 py-2.5 text-[13px] leading-relaxed",
      },
    },
    defaultVariants: { size: "md" },
  },
);
