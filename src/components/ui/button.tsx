import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "copper";
  size?: "sm" | "md";
};

export function Button({ className, variant = "primary", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-[15px]",
        variant === "primary" && "bg-teal text-white hover:bg-teal-deep",
        variant === "ghost" && "border border-line bg-panel hover:bg-paper",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        variant === "copper" && "bg-copper text-white hover:opacity-90",
        className
      )}
      {...props}
    />
  );
}
