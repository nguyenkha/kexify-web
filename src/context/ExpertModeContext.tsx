import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { getMe } from "../lib/auth";
import { getUserOverrides } from "../lib/userOverrides";

const ExpertModeContext = createContext(false);

export const useExpertMode = () => useContext(ExpertModeContext);

export function ExpertModeProvider({ children }: { children: ReactNode }) {
  const [expert, setExpert] = useState(false);

  useEffect(() => {
    getMe().then((me) => {
      const overrides = getUserOverrides(me?.id);
      setExpert(overrides.preferences?.expert_mode ?? false);
    });
  }, []);

  // Listen for changes (e.g. user toggles in Config page)
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key?.startsWith("kexify:config:")) {
        try {
          const overrides = e.newValue ? JSON.parse(e.newValue) : {};
          setExpert(overrides.preferences?.expert_mode ?? false);
        } catch {}
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <ExpertModeContext.Provider value={expert}>
      {children}
    </ExpertModeContext.Provider>
  );
}
