import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Every button in dhrive is one of these: a few looks and the four heights the app uses, always
// near-square. Focus is the page's own outline (index.css), so a button never draws a ring of its own.
const buttonVariants = cva("inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition disabled:opacity-40", {
  variants: {
    variant: {
      primary: "bg-foreground font-medium text-background hover:opacity-90",
      outline: "border border-border hover:bg-hover",
      soft: "bg-selected font-medium hover:bg-pressed",
      ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
      danger: "text-failure hover:bg-failure/10",
      // What can't be taken back, once the owner has said so.
      destroy: "bg-failure font-medium text-background hover:opacity-90",
    },
    size: {
      xs: "h-6 px-2.5 text-[11.5px]",
      sm: "h-7 px-3 text-[12px]",
      md: "h-8 px-3.5 text-[12.5px]",
      lg: "h-9 px-5 text-[13.5px]",
      "icon-xs": "h-6 w-6",
      "icon-sm": "h-7 w-7",
      icon: "h-8 w-8",
    },
  },
  defaultVariants: { variant: "outline", size: "md" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export { buttonVariants };
