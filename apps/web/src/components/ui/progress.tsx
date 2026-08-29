import * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
  className,
  value = 0,
  ...props
}: React.ComponentProps<"div"> & { value?: number | null }) {
  return (
    <div
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-[#25303b]",
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="bg-primary h-full transition-all bg-blue-400"
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
      />
    </div>
  );
}

export { Progress };
