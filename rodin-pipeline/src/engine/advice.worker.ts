/// <reference lib="webworker" />
/**
 * The slow planning questions — what the shelf could do, which colours are
 * worth buying, how every mixing setting would score — answered off the main
 * thread.  Each one plans the whole palette many times over (tens of seconds
 * with eight tools), which used to freeze the window while it ran.
 */
import { scoreMixOptions } from "@core/mixAdvice";
import { bestSwapFor, fidelityScore, recommendSpools, scoreSlotSet, wantedSpoolColours } from "@core/spoolAdvice";
import type { AdviceRequest } from "./adviceClient";

function answer(request: AdviceRequest): unknown {
  switch (request.kind) {
    case "shelf": {
      const { palette, slots, shelf, count, options } = request;
      const swaps: Array<[string, ReturnType<typeof bestSwapFor>]> = shelf.map((entry) => [entry.key, bestSwapFor(palette, slots, entry.filament, options)]);
      const filaments = shelf.map((entry) => entry.filament);
      const owned = filaments.length > 0 ? recommendSpools(palette, filaments, slots, count, { score: options, searchBudget: 120 }) : null;
      const ideal = wantedSpoolColours(palette, slots, count, filaments, { score: options, searchBudget: 120 });
      const current = scoreSlotSet(palette, slots, options);
      return {
        swaps,
        owned: owned ? fidelityScore(owned.score) : null,
        ideal: ideal ? fidelityScore(ideal.score) : null,
        current,
      };
    }
    case "recommend":
      return recommendSpools(request.palette, request.shelf, request.slots, request.count, { suggestion: { maxComponents: request.maxComponents }, score: request.options });
    case "wanted":
      return wantedSpoolColours(request.palette, request.slots, request.count, request.shelf, { score: request.options });
    case "rate":
      return scoreMixOptions(request.palette, request.slots, request.options);
  }
}

self.onmessage = (event: MessageEvent<{ id: number; request: AdviceRequest }>) => {
  const { id, request } = event.data;
  try {
    self.postMessage({ id, result: answer(request) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
