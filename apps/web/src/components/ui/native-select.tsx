import * as React from "react";

import { cn } from "@/lib/utils";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input dark:bg-input/30 dark:hover:bg-input/50 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        "bg-ink-800 border-line-600 text-text-100 font-mono text-[11px] focus-visible:border-accent-500 focus-visible:ring-0",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { NativeSelect };
