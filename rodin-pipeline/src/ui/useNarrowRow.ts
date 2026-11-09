import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Whether a wrapping row (the stage toolbar) has run onto a second line, so its owner can show a shorter form of
 * it (11-09: at 1280 and 1440 the view tools dropped to a line of their own and took 38px off the 3D view).
 *
 * The full form is tried first; when it wraps, the row goes narrow and remembers the width it wrapped at, and it
 * goes back to the full form only once the row is clearly wider than that (so it never flips back and forth).
 * `key` — the step, the language, anything that changes what the row holds — starts it over.
 *
 * Returns the flag and a ref for the row (a ResizeObserver keeps watching it: a resize, or a button appearing in
 * it, which makes it taller when it wraps).
 */
export function useNarrowRow(key: string, oneLinePx: number): [boolean, (element: HTMLElement | null) => void] {
  const [narrow, setNarrow] = useState(false);
  const state = useRef({ element: null as HTMLElement | null, observer: null as ResizeObserver | null, wrapAt: 0, narrow: false });
  state.current.narrow = narrow;

  const check = useCallback(() => {
    const s = state.current;
    const element = s.element;
    if (!element) return;
    const width = element.clientWidth;
    if (width === 0) return; // hidden: nothing to measure
    if (!s.narrow) {
      if (element.scrollHeight > oneLinePx) {
        s.wrapAt = width;
        s.narrow = true;
        setNarrow(true);
      }
    } else if (width > s.wrapAt + 40) {
      s.narrow = false;
      setNarrow(false);
    }
  }, [oneLinePx]);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      const s = state.current;
      s.observer?.disconnect();
      s.observer = null;
      s.element = element;
      if (!element) return;
      if (typeof ResizeObserver !== "undefined") {
        s.observer = new ResizeObserver(() => check());
        s.observer.observe(element);
      }
      check();
    },
    [check],
  );

  // New content: back to the full form, then measure it again (before the browser paints).
  useLayoutEffect(() => {
    const s = state.current;
    s.wrapAt = 0;
    if (s.narrow) {
      s.narrow = false;
      setNarrow(false);
    } else check();
  }, [key, check]);
  // Back in the full form: does it fit now?
  useLayoutEffect(() => {
    if (!narrow) check();
  }, [narrow, check]);

  return [narrow, ref];
}
