/// <reference lib="webworker" />
/**
 * 모아 뽑기 off the main thread: reading a file streams its whole model (a
 * second or two for a 100 MB sculpt) and writing streams all of them again,
 * which would freeze the window.
 */
import { GatherError, readGatherSource, writeGather } from "./gather";
import type { GatherReply, GatherRequest } from "./gatherClient";

const post = (reply: GatherReply) => (self as DedicatedWorkerGlobalScope).postMessage(reply);

self.onmessage = async (event: MessageEvent<GatherRequest>) => {
  const request = event.data;
  let last = 0;
  const progress = (done: number, total: number) => {
    const now = Date.now();
    if (now - last < 100 && done < total) return;
    last = now;
    post({ kind: "progress", done, total });
  };
  try {
    if (request.kind === "read") {
      let done = 0;
      const source = await readGatherSource(request.file, request.file.name, (bytes) => {
        done += bytes;
        progress(done, request.file.size);
      });
      post({ kind: "read", source });
    } else {
      const blob = await writeGather(request.files, request.sources, request.plan, { title: request.title, thumbnail: request.thumbnail, onProgress: progress });
      post({ kind: "write", blob });
    }
  } catch (error) {
    post(
      error instanceof GatherError
        ? { kind: "error", key: error.key, params: error.params }
        : { kind: "error", key: "unknown", params: { message: error instanceof Error ? error.message : String(error) } },
    );
  }
};
