import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { getMe, getIdentityId } from "../lib/auth";
import { getUserOverrides } from "../lib/userOverrides";

const ExpertModeContext = createContext<{ expert: boolean; ready: boolean; setExpert: (v: boolean) => void }>({ expert: false, ready: true, setExpert: () => {} });

export const useExpertMode = () => useContext(ExpertModeContext).expert;
/** false until the saved choice has been read (route guards wait for it). */
export const useExpertModeReady = () => useContext(ExpertModeContext).ready;
export const useSetExpertMode = () => useContext(ExpertModeContext).setExpert;

export function ExpertModeProvider({ children }: { children: ReactNode }) {
  // Off unless the user turned it on (new users and users who never chose have no saved value).
  const [expert, setExpertState] = useState(false);
  const [ready, setReady] = useState(false);
  const chosen = useRef(false); // a toggle made while the saved value was loading wins

  useEffect(() => {
    getMe().then((me) => {
      const uid = me?.id ?? getIdentityId() ?? undefined;
      const overrides = getUserOverrides(uid);
      if (!chosen.current) setExpertState(overrides.preferences?.expert_mode ?? false);
    }).catch(() => {}).finally(() => setReady(true));
  }, []);

  const setExpert = useCallback((v: boolean) => {
    chosen.current = true;
    setExpertState(v);
  }, []);

  return (
    <ExpertModeContext.Provider value={{ expert, ready, setExpert }}>
      {children}
    </ExpertModeContext.Provider>
  );
}
