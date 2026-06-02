import { useLayoutEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

type FitBox = { width: number; height: number };

type UseFitScaleOptions = {
  // Element whose UNTRANSFORMED layout size (offsetWidth/Height) is measured.
  // Read inside the layout effect, so refs resolved post-commit work.
  getTarget: () => HTMLElement | null;
  // Available space to fit the target into.
  getBox: () => FitBox | null;
  // Extra elements to observe for size changes (e.g. a resizing container).
  getObserved?: () => Array<HTMLElement | null>;
  // Recompute on window resize. Use when the box derives from the viewport
  // rather than from an observed element.
  watchWindow?: boolean;
  // Upper clamp on the returned scale.
  maxScale?: number;
  // When false the hook stays at scale 1 and registers no listeners.
  enabled?: boolean;
  // Extra reactive inputs that change the target's natural size (variant,
  // theme, …). The getters are read fresh each run, so only these belong here.
  deps?: DependencyList;
};

// Contain-fit scale. Measures the target's offsetWidth/offsetHeight — the
// untransformed layout size, so the scale we return never feeds back into the
// measurement — and returns the largest scale that fits it inside the box,
// optionally clamped by maxScale. Keeps it current via a ResizeObserver on the
// target (plus any getObserved elements) and an optional window-resize
// listener. Returns 1 while disabled or unmeasurable.
export function useFitScale({
  getTarget,
  getBox,
  getObserved,
  watchWindow = false,
  maxScale = Number.POSITIVE_INFINITY,
  enabled = true,
  deps = [],
}: UseFitScaleOptions): number {
  const [scale, setScale] = useState(1);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setScale(1);
      return;
    }

    const target = getTarget();

    if (!target) {
      return;
    }

    const fit = () => {
      const w = target.offsetWidth;
      const h = target.offsetHeight;
      const box = getBox();

      if (!w || !h || !box || !box.width || !box.height) {
        return;
      }

      const nextScale = Math.min(box.width / w, box.height / h, maxScale);
      setScale((current) =>
        Object.is(current, nextScale) ? current : nextScale
      );
    };

    const scheduleFit = () => {
      if (rafRef.current !== null) {
        return;
      }

      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        fit();
      });
    };

    fit();

    if (watchWindow) {
      window.addEventListener("resize", scheduleFit);
    }

    let observer: ResizeObserver | undefined;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleFit);
      observer.observe(target);

      for (const el of getObserved?.() ?? []) {
        if (el) {
          observer.observe(el);
        }
      }
    }

    return () => {
      if (watchWindow) {
        window.removeEventListener("resize", scheduleFit);
      }

      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      observer?.disconnect();
    };
    // The getters are intentionally read fresh each run; callers pass the
    // reactive inputs that matter via `deps`.
  }, [enabled, watchWindow, maxScale, ...deps]);

  return scale;
}
