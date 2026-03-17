type SpinnerSize = "xs" | "sm" | "md" | "lg";

const sizeStyles: Record<SpinnerSize, string> = {
  xs: "w-3 h-3 border",
  sm: "w-4 h-4 border",
  md: "w-6 h-6 border-2",
  lg: "w-16 h-16 border-2",
};

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

/** Consistent loading spinner using CSS border animation */
export function Spinner({ size = "sm", className = "" }: SpinnerProps) {
  return (
    <div
      className={`${sizeStyles[size]} border-blue-500 border-t-transparent rounded-full animate-spin shrink-0 ${className}`}
    />
  );
}
