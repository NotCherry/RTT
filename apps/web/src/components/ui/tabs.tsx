import * as React from "react";

import { cn } from "@/lib/utils";

function Tabs({
  className,
  ...props
}: React.ComponentProps<"div"> & { defaultValue?: string; value?: string; onValueChange?: (v: string) => void }) {
  return (
    <div
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tabs-list"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
        "bg-[#0d131b] border border-line-650 rounded-md grid grid-cols-3 gap-[3px] h-auto p-[3px] w-full",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  active,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean; value?: string }) {
  return (
    <button
      data-slot="tabs-trigger"
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50",
        "font-mono text-[11px] text-slate-500 data-[state=active]:bg-accent-deep data-[state=active]:text-blue-100 data-[state=active]:shadow-[0_2px_10px_rgba(0,0,0,0.2)] data-[state=active]:border-0 rounded-[4px] px-[7px] py-[9px]",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
