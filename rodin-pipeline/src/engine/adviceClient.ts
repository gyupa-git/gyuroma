import type { MixOptionScore } from "@core/mixAdvice";
import type { ColourWishlist, SlotScoreOptions, SlotSetScore, SpoolRecommendation, SwapOutcome } from "@core/spoolAdvice";
import type { Filament, PaletteEntry, PhysicalSlot } from "@core/types";

/**
 * Talks to the advice worker.  One worker per kind of question, so a newer
 * question of the same kind can stop an old one that is still running (the
 * worker is simply replaced), and answers are kept by their inputs so going
 * back to a screen shows them at once.
 */
export type AdviceRequest =
  | { kind: "shelf"; palette: PaletteEntry[]; slots: PhysicalSlot[]; shelf: Array<{ key: string; filament: Filament }>; count: number; options: SlotScoreOptions }
  | { kind: "recommend"; palette: PaletteEntry[]; slots: PhysicalSlot[]; shelf: Filament[]; count: number; maxComponents: 1 | 2 | 3; options: SlotScoreOptions }
  | { kind: "wanted"; palette: PaletteEntry[]; slots: PhysicalSlot[]; shelf: Filament[]; count: number; options: SlotScoreOptions }
  | { kind: "rate"; palette: PaletteEntry[]; slots: PhysicalSlot[]; options: Parameters<typeof import("@core/mixAdvice").scoreMixOptions>[2] };

export interface ShelfAnswer {
  swaps: Array<[string, SwapOutcome | null]>;
  owned: number | null;
  ideal: number | null;
  current: SlotSetScore;
}

export interface AdviceAnswers {
  shelf: ShelfAnswer;
  recommend: SpoolRecommendation;
  wanted: ColourWishlist | null;
  rate: MixOptionScore[];
}

type Kind = AdviceRequest["kind"];

interface Running {
  worker: Worker;
  id: number;
  reject: (reason: unknown) => void;
}

const running = new Map<Kind, Running>();
const idle = new Map<Kind, Worker>();
const answers = new Map<string, unknown>();
const ANSWER_LIMIT = 40;
let nextId = 1;

/** A stopped question: the caller asked something newer of the same kind. */
export class Superseded extends Error {}

function makeWorker(): Worker {
  return new Worker(new URL("./advice.worker.ts", import.meta.url), { type: "module" });
}

/** The answer already worked out for exactly these inputs, if any. */
export function knownAnswer<K extends Kind>(key: string): AdviceAnswers[K] | undefined {
  return answers.get(key) as AdviceAnswers[K] | undefined;
}

export function ask<R extends AdviceRequest>(request: R, key: string): Promise<AdviceAnswers[R["kind"]]> {
  const known = answers.get(key);
  if (known !== undefined) return Promise.resolve(known as AdviceAnswers[R["kind"]]);
  const kind = request.kind;
  const previous = running.get(kind);
  if (previous) {
    // Still busy with an older question of this kind: stop it outright.
    previous.worker.terminate();
    previous.reject(new Superseded());
    running.delete(kind);
  }
  const worker = idle.get(kind) ?? makeWorker();
  idle.delete(kind);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    running.set(kind, { worker, id, reject });
    worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      if (event.data.id !== id) return;
      running.delete(kind);
      idle.set(kind, worker);
      if (event.data.error !== undefined) {
        reject(new Error(event.data.error));
        return;
      }
      answers.set(key, event.data.result);
      if (answers.size > ANSWER_LIMIT) answers.delete(answers.keys().next().value as string);
      resolve(event.data.result as AdviceAnswers[R["kind"]]);
    };
    worker.onerror = (event) => {
      running.delete(kind);
      worker.terminate();
      reject(new Error(event.message || "advice worker failed"));
    };
    worker.postMessage({ id, request });
  });
}

/** A stable key for a set of inputs (palette and slots by value, not identity). */
export function adviceKey(kind: Kind, parts: unknown): string {
  return `${kind}:${JSON.stringify(parts)}`;
}
