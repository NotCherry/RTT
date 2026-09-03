import type * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
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
    return (
        <SliderPrimitive.Root
            data-slot="slider"
            value={value}
            defaultValue={defaultValue}
            min={min}
            max={max}
            step={step}
            onValueChange={onValueChange}
            className={cn(
                "relative flex w-full touch-none items-center select-none data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
                className,
            )}
            {...props}
        >
            <SliderPrimitive.Track
                data-slot="slider-track"
                className="bg-line-800 relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    className="bg-accent-500 absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
                />
            </SliderPrimitive.Track>
            {(value ?? defaultValue ?? [min]).map((_, i) => (
                <SliderPrimitive.Thumb
                    // SAFETY: radix thumb key is stable per value index
                    key={i}
                    data-slot="slider-thumb"
                    className="border-accent-500 bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
                />
            ))}
        </SliderPrimitive.Root>
    );
}

export { Slider };
