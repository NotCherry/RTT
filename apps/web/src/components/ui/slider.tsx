import * as React from "react";

import { cn } from "@/lib/utils";

type SliderProps = Omit<React.ComponentProps<"input">, "value" | "defaultValue"> & {
  value?: number[];
  defaultValue?: number[];
};

function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  ...props
}: SliderProps & { onValueChange?: (value: number[]) => void }) {
  // Simplified slider backed by native <input type="range"> for compatibility
  // without requiring full Radix runtime. Preserves the shadcn data-slot API.
  const current = value?.[0] ?? defaultValue?.[0] ?? min;
  return (
    <div
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none accent-accent-500",
        className,
      )}
    >
      <input
        type="range"
        data-slot="slider-thumb"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onValueChange?.([Number(e.target.value)])}
        className="w-full cursor-pointer accent-accent-500"
        {...props}
      />
    </div>
  );
}

export { Slider };
