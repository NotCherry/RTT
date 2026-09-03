import * as React from "react";

import { cn } from "@/lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center border-line-600 bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex flex-col items-center gap-1.5", className)}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "text-lg font-semibold text-text-100 text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-muted-foreground text-sm text-[11px] text-text-500 leading-[1.5]",
        className,
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn("flex flex-col items-center gap-4", className)}
      {...props}
    />
  );
}

function EmptyMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-media"
      className={cn("text-accent-500 text-[30px] leading-none mb-1", className)}
      {...props}
    />
  );
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
};
