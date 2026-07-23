import { useEffect, useState } from "react";
import { type ChromeTicker, sharedChromeTicker } from "../chrome-ticker";

// The equality-gated chrome read (3b): subscribe a derived engine value to the
// shared chrome ticker instead of a private setInterval. Call sites MUST pass
// a stable `read` (useCallback on [ce]) and a stable `equal` (module-level) —
// an inline closure would resubscribe every render.

export function useChromeValue<T>(
  read: () => T,
  everyMs: number,
  equal: (a: T, b: T) => boolean = Object.is,
  ticker?: ChromeTicker,
): T {
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const apply = (): void => {
      setValue((prev) => {
        const next = read();
        return equal(prev, next) ? prev : next;
      });
    };
    apply(); // an engine swap must not wait out one cadence window
    return (ticker ?? sharedChromeTicker()).subscribe(everyMs, apply);
  }, [read, everyMs, equal, ticker]);
  return value;
}
