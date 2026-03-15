import { createContext, useContext, useState, type ReactNode } from "react";

const STORAGE_KEY = "kexify:hideBalances";

const HideBalancesContext = createContext<{
  hidden: boolean;
  toggle: () => void;
}>({ hidden: false, toggle: () => {} });

export function HideBalancesProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  function toggle() {
    setHidden((prev) => {
      const next = !prev;
      if (next) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
      return next;
    });
  }

  return (
    <HideBalancesContext.Provider value={{ hidden, toggle }}>
      {children}
    </HideBalancesContext.Provider>
  );
}

export function useHideBalances() {
  return useContext(HideBalancesContext);
}

/** Mask a balance string when hidden */
export function maskBalance(value: string, hidden: boolean): string {
  if (!hidden) return value;
  return "••••";
}
