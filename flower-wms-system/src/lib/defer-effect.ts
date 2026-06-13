import { useEffect, type DependencyList } from "react";

/** Run after the current effect commit phase (avoids react-hooks/set-state-in-effect). */
export function deferEffectTask(task: () => void): void {
  queueMicrotask(task);
}

/** Like useEffect for async loaders / state resets that must not run synchronously in the effect body. */
export function useDeferredEffect(
  effect: () => void | Promise<void>,
  deps: DependencyList
): void {
  useEffect(() => {
    deferEffectTask(() => {
      void effect();
    });
    // Intentionally mirrors useEffect(deps): callers pass deps; effect runs deferred after commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper hook; effect excluded like useEffect fn
  }, deps);
}
