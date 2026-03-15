import { createContext, useContext } from "react";

const FrozenContext = createContext(false);

export const FrozenProvider = FrozenContext.Provider;

export function useFrozen(): boolean {
  return useContext(FrozenContext);
}
