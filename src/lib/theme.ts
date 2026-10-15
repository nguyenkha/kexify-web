import { useSyncExternalStore } from "react";

// UX spec settings.md: theme = System (default) with an optional Light / Dark override.
type Theme = "light" | "dark";
export type ThemePreference = "system" | Theme;

const STORAGE_KEY = "secretkey-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** The theme currently in effect (resolves "system"). */
export function getStoredTheme(): Theme {
  const pref = getThemePreference();
  return pref === "system" ? systemTheme() : pref;
}

function applyTheme() {
  // Recovery mode forces its own monochrome dark theme
  if (document.documentElement.hasAttribute("data-recovery")) return;
  document.documentElement.setAttribute("data-theme", getStoredTheme());
}

function notify() {
  for (const l of listeners) l();
}

export function setThemePreference(pref: ThemePreference) {
  if (pref === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, pref);
  applyTheme();
  notify();
}

/** Explicit Light / Dark override (quick toggles). */
export function setTheme(theme: Theme) {
  setThemePreference(theme);
}

export function initTheme() {
  applyTheme();
  // Follow the device live while on "system"
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (getThemePreference() !== "system") return;
    applyTheme();
    notify();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Current preference, re-rendering on any change (Settings selector, toggles, device). */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference);
}

/** Effective theme, re-rendering on any change. */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribe, getStoredTheme);
}
