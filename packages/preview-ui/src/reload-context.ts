import { createContext, useContext, type Accessor } from "solid-js";

export interface ReloadContextValue {
  paletteVersion: Accessor<number>;
  helpVersion: Accessor<number>;
  /** Bumps whenever the project's document set changes (add/remove). */
  docsVersion: Accessor<number>;
}

export const ReloadContext = createContext<ReloadContextValue>();

export function useReload(): ReloadContextValue {
  const ctx = useContext(ReloadContext);
  if (!ctx) {
    // Fallback for when a tab is rendered outside the provider (e.g. in unit
    // tests). Versions are constants in that case.
    const zero: Accessor<number> = () => 0;
    return { paletteVersion: zero, helpVersion: zero, docsVersion: zero };
  }
  return ctx;
}
