import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Single source of truth for type. Pages must not use raw <h1>/<h2>/p.kicker
// or ad-hoc text-[11px] / text-slate-400. Use these primitives — they map
// directly to tokens in src/styles.css @theme.

const headingVariants = cva("font-semibold tracking-[-0.03em] text-text-100", {
    variants: {
        level: {
            h1: "text-[17px] leading-none",
            h2: "text-[clamp(28px,3.1vw,46px)] leading-[1.02] tracking-[-0.06em]",
            h3: "text-[17px] leading-none",
        },
    },
    defaultVariants: { level: "h1" },
});

function H1({
    className,
    level = "h1",
    ...props
}: React.ComponentProps<"h1"> &
    VariantProps<typeof headingVariants> & { level?: "h1" | "h2" | "h3" }) {
    if (level === "h2")
        return (
            <h2
                data-slot="typography-h1"
                className={cn(headingVariants({ level, className }))}
                {...(props as React.ComponentProps<"h2">)}
            />
        );
    if (level === "h3")
        return (
            <h3
                data-slot="typography-h1"
                className={cn(headingVariants({ level, className }))}
                {...(props as React.ComponentProps<"h3">)}
            />
        );
    return (
        <h1
            data-slot="typography-h1"
            className={cn(headingVariants({ level, className }))}
            {...props}
        />
    );
}
function H2({ className, ...props }: React.ComponentProps<"h2">) {
    return (
        <h2
            data-slot="typography-h2"
            className={cn(headingVariants({ level: "h2", className }))}
            {...props}
        />
    );
}
function H3({ className, ...props }: React.ComponentProps<"h3">) {
    return (
        <h3
            data-slot="typography-h3"
            className={cn(headingVariants({ level: "h3", className }))}
            {...props}
        />
    );
}

function Kicker({ className, ...props }: React.ComponentProps<"p">) {
    return (
        <p
            data-slot="typography-kicker"
            className={cn(
                "font-mono text-[10px] tracking-[0.16em] text-accent-500 uppercase",
                className,
            )}
            {...props}
        />
    );
}
function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
    return (
        <p
            data-slot="typography-eyebrow"
            className={cn(
                "font-mono text-[10px] tracking-[0.16em] text-text-600",
                className,
            )}
            {...props}
        />
    );
}
function PanelLabelText({ className, ...props }: React.ComponentProps<"p">) {
    return (
        <p
            data-slot="typography-panel-label"
            className={cn(
                "font-mono text-[10px] tracking-[0.16em] text-text-600 uppercase",
                className,
            )}
            {...props}
        />
    );
}
function IntroCopy({ className, ...props }: React.ComponentProps<"p">) {
    return (
        <p
            data-slot="typography-intro"
            className={cn(
                "max-w-[530px] text-[14px] leading-[1.5] text-text-500",
                className,
            )}
            {...props}
        />
    );
}
function Body({ className, ...props }: React.ComponentProps<"p">) {
    return (
        <p
            data-slot="typography-body"
            className={cn("text-[13px] leading-[1.6] text-text-300", className)}
            {...props}
        />
    );
}
function Mono({ className, ...props }: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="typography-mono"
            className={cn("font-mono text-[11px] text-text-600", className)}
            {...props}
        />
    );
}
function Caption({ className, ...props }: React.ComponentProps<"p">) {
    return (
        <p
            data-slot="typography-caption"
            className={cn(
                "font-mono text-[10px] leading-[1.5] text-text-600",
                className,
            )}
            {...props}
        />
    );
}

export {
    H1,
    H2,
    H3,
    Kicker,
    Eyebrow,
    PanelLabelText,
    IntroCopy,
    Body,
    Mono,
    Caption,
    headingVariants,
};
