import * as React from "react";

import { cn } from "@/lib/utils";

// Simplified Select facade: wraps native <select> for now while exposing
// the shadcn API surface (Select, SelectTrigger, SelectContent, etc.) so
// pages can migrate without behavioural risk. Full Radix implementation
// can be swapped in later without changing call sites.
function Select({ children, ...props }: React.ComponentProps<"div"> & { value?: string; onValueChange?: (v: string) => void; defaultValue?: string }) {
  return <div data-slot="select" {...props}>{children}</div>;
}
function SelectGroup({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-group" {...props} />;
}
function SelectValue({ children, placeholder, ...props }: React.ComponentProps<"span"> & { placeholder?: string }) {
  return <span data-slot="select-value" {...props}>{children ?? placeholder}</span>;
}
function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { size?: "sm" | "default" }) {
  return (
    <div
      data-slot="select-trigger"
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs bg-ink-800 border-line-600 text-text-100 font-mono text-[11px]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
function SelectContent({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-content"
      className={cn("bg-popover text-popover-foreground rounded-md border shadow-md bg-ink-850 border-line-650 p-1", className)}
      {...props}
    >
      {children}
    </div>
  );
}
function SelectLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-label" className={cn("text-muted-foreground px-2 py-1.5 text-xs font-mono text-[10px]", className)} {...props} />;
}
function SelectItem({ className, children, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-item" className={cn("relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 px-2 text-sm font-mono text-[11px] hover:bg-accent", className)} {...props}>{children}</div>;
}
function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-separator" className={cn("bg-border my-1 h-px bg-line-650", className)} {...props} />;
}
function SelectScrollUpButton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-scroll-up-button" className={cn("flex items-center justify-center py-1", className)} {...props} />;
}
function SelectScrollDownButton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-scroll-down-button" className={cn("flex items-center justify-center py-1", className)} {...props} />;
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
