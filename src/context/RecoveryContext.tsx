import { createContext, useContext } from "react";
import type { KeyShare } from "../shared/types";

interface RecoveryContextValue {
  isRecovery: boolean;
  recoveryKeys: KeyShare[];
}

const RecoveryContext = createContext<RecoveryContextValue>({
  isRecovery: false,
  recoveryKeys: [],
});

export function RecoveryProvider({
  value,
  children,
}: {
  value: RecoveryContextValue;
  children: React.ReactNode;
}) {
  return (
    <RecoveryContext.Provider value={value}>
      {children}
    </RecoveryContext.Provider>
  );
}

export function useRecovery(): RecoveryContextValue {
  return useContext(RecoveryContext);
}
