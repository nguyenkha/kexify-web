import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white",
  secondary:
    "bg-surface-tertiary hover:bg-border-primary text-text-secondary",
  danger:
    "bg-red-600 hover:bg-red-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white",
  ghost:
    "text-text-muted hover:text-text-secondary",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5",
  md: "text-sm px-4 py-2.5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${variantStyles[variant]} ${sizeStyles[size]} ${fullWidth ? "w-full" : ""} font-medium rounded-lg transition-colors disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
