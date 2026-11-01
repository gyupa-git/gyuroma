/**
 * Anonymous counts for the copy everyone uses (GoatCounter: no cookies,
 * nothing that tells people apart, never anything about the model or its
 * colours) — how often the app is opened, a model loaded, a file exported and
 * 모아 뽑기 used, so the owner can tell whether and how 규로마 is used.  Only
 * the build for everyone (`npm run build:dist`, VITE_DIST=1) counts; the
 * owner's own app never does, and GoatCounter itself skips localhost.
 */
const ENDPOINT = "https://gyupa.goatcounter.com/count";
const ON = import.meta.env.VITE_DIST === "1";

declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string; title?: string; event?: boolean }) => void };
  }
}

/** Loads GoatCounter, which counts this visit. */
export function startCounting(): void {
  if (!ON || typeof document === "undefined") return;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = ENDPOINT;
  document.head.appendChild(script);
}

/** One count of an action, by its name only (e.g. "export/prusa-xl5"). */
export function countAction(name: string): void {
  if (!ON) return;
  try {
    window.goatcounter?.count?.({ path: name, title: name, event: true });
  } catch {
    // counting never gets in the way
  }
}
