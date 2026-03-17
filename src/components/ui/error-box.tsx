import type { ReactNode } from "react";

interface ErrorBoxProps {
  children: ReactNode;
  className?: string;
}

/** Consistent error message container with red background and border */
export function ErrorBox({ children, className = "" }: ErrorBoxProps) {
  return (
    <div className={`bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 ${className}`}>
      <p className="text-xs text-red-400">{children}</p>
    </div>
  );
}
