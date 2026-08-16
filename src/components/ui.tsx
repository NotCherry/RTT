import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "recording";
type ButtonSize = "default" | "small";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  children: ReactNode;
};

const buttonBase =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[5px] border-0 font-semibold transition duration-150 ease-out hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent-500 text-[#07111e] hover:bg-accent-300",
  secondary: "bg-[#243346] text-blue-100 hover:bg-[#30445b]",
  ghost:
    "border border-[#334252] bg-transparent text-slate-300 hover:border-[#5b82aa] hover:text-slate-100",
  recording: "bg-[#5b2d38] text-[#ffd6d7] hover:bg-[#773a48]",
};
const buttonSizes: Record<ButtonSize, string> = {
  default: "px-[13px] py-[11px] text-xs",
  small: "px-[11px] py-2 text-[11px]",
};

export function Button({
  variant = "secondary",
  size = "default",
  full = false,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${full ? "w-full" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Panel({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`overflow-hidden rounded-[9px] border border-line-700 bg-ink-900/95 shadow-[0_16px_42px_rgba(0,0,0,0.09)] ${className}`}
      {...props}
    >
      {children}
    </section>
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
      className={`flex items-center justify-between border-b border-[#25303b] ${compact ? "px-[18px] pb-[14px] pt-[17px]" : "px-5 pb-[17px] pt-[19px]"} ${className}`}
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
      className={`font-mono text-[10px] tracking-[0.16em] text-text-600 ${className}`}
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
    <span
      className={`inline-flex items-center gap-[7px] rounded-full border px-[10px] py-[7px] font-mono text-[11px] ${online ? "border-[#315943] text-green-200" : "border-[#303b49] text-slate-400"} ${className}`}
    >
      <span
        className={`h-[6px] w-[6px] rounded-full ${online ? "bg-success-400" : "bg-slate-500"}`}
      />
      {children}
    </span>
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
      className={`cursor-pointer rounded-[4px] border-0 px-[7px] py-[9px] font-mono text-[11px] transition hover:text-slate-300 ${active ? "bg-accent-deep text-blue-100 shadow-[0_2px_10px_rgba(0,0,0,0.2)]" : "bg-transparent text-slate-500"} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
