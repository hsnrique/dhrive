import type { ReactNode } from "react";

// Every section of the company's screen opens the same way: its name in the serif, a hairline under
// it, and its actions on the right, which drop under the name when a column is too narrow for both.

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-end gap-x-3 gap-y-2 border-b border-border pb-2.5">
      <h2 className="display-section">{title}</h2>
      {children && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>}
    </div>
  );
}
