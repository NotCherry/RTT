import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Button as ShadcnButton,
  buttonVariants as shadcnButtonVariants,
} from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ButtonVariant = "primary" | "secondary" | "ghost" | "recording";
type ButtonSize = "default" | "small";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  children: ReactNode;
};

const variantMap: Record<ButtonVariant, "default" | "secondary" | "ghost" | "destructive" | "outline"> = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  recording: "destructive",
};

const sizeMap: Record<ButtonSize, "default" | "sm"> = {
  default: "default",
  small: "sm",
};

// Preserve lab-console visual identity while delegating to shadcn Button's
// cva + focus-ring + disabled handling. Recording gets a custom override
// because the legacy #5b2d38 is distinct from the semantic destructive token.
export function Button({
  variant = "secondary",
  size = "default",
  full = false,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const shadcnVariant = variantMap[variant];
  const shadcnSize = sizeMap[size];
  const isRecording = variant === "recording";
  return (
    <ShadcnButton
      variant={isRecording ? "destructive" : shadcnVariant}
      size={shadcnSize}
      className={cn(
        "rounded-[5px] font-semibold hover:-translate-y-px",
        // legacy size-mapping (shadcn default is h-9 px-4 vs legacy px-[13px] py-[11px])
        size === "default" && "px-[13px] py-[11px] text-xs",
        size === "small" && "px-[11px] py-2 text-[11px] h-auto",
        isRecording && "bg-[#5b2d38] text-[#ffd6d7] hover:bg-[#773a48] border-0",
        variant === "primary" && "bg-accent-500 text-[#07111e] hover:bg-accent-300",
        variant === "secondary" && "bg-[#243346] text-blue-100 hover:bg-[#30445b] border-0",
        variant === "ghost" && "border border-[#334252] bg-transparent text-slate-300 hover:border-[#5b82aa] hover:text-slate-100 hover:bg-transparent",
        full && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </ShadcnButton>
  );
}

// Re-export shadcn variant helper for link-as-button usage per shadcn docs
export { shadcnButtonVariants as buttonVariants };

export function Panel({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-[9px] border border-line-700 bg-ink-900/95 shadow-[0_16px_42px_rgba(0,0,0,0.09)] py-0 gap-0",
        className,
      )}
      {...props}
    >
      {children}
    </Card>
  );
}

export function PanelHeader({
  compact = false,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-[#25303b]",
        compact ? "px-[18px] pb-[14px] pt-[17px]" : "px-5 pb-[17px] pt-[19px]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelLabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[10px] tracking-[0.16em] text-text-600",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function StatusPill({
  children,
  online = false,
  className = "",
}: {
  children: ReactNode;
  online?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant={online ? "default" : "outline"}
      className={cn(
        "inline-flex items-center gap-[7px] rounded-full border px-[10px] py-[7px] font-mono text-[11px] font-normal",
        online
          ? "border-[#315943] text-green-200 bg-transparent hover:bg-transparent"
          : "border-[#303b49] text-slate-400 bg-transparent hover:bg-transparent",
        className,
      )}
    >
      <span
        className={cn(
          "h-[6px] w-[6px] rounded-full",
          online ? "bg-success-400 shadow-[0_0_0_3px_rgba(105,214,150,0.12)]" : "bg-slate-500",
        )}
      />
      {children}
    </Badge>
  );
}

export function TabButton({
  active,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      className={cn(
        "cursor-pointer rounded-[4px] border-0 px-[7px] py-[9px] font-mono text-[11px] transition hover:text-slate-300",
        active
          ? "bg-accent-deep text-blue-100 shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
          : "bg-transparent text-slate-500",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
