/// <reference lib="webworker" />
/**
 * Cuts the faces along the colour borders (@core/borderCut) off the main
 * thread.  The model is sent once and kept here; after that each request is
 * just the face groups, so the screen goes on while a million faces are
 * measured.
 */
import { buildEdgeAdjacency, type FaceAdjacency } from "@core/meshAdjacency";
import { cutAlongBorderLines } from "@core/borderCut";
import type { CutReply, CutRequest } from "./borderCutClient";

/**
 * The model as flat arrays and faces adjacent across a side only: about 90 MB
 * for 2.4 million faces, against several times that as points and triples
 * with every face sharing a vertex.
 */
let model: { id: number; positions: Float64Array; corners: Int32Array; adjacency: FaceAdjacency } | null = null;

self.onmessage = (event: MessageEvent<CutRequest>) => {
  const request = event.data;
  if (request.type === "forget") {
    model = null;
    return;
  }
  if (request.type === "model") {
    const { positions, corners } = request;
    model = null; // the old one goes before the new one is built
    model = { id: request.modelId, positions, corners, adjacency: buildEdgeAdjacency(corners, positions.length / 3) };
    return;
  }
  const reply = (message: CutReply, transfer: Transferable[] = []) => self.postMessage(message, transfer);
  if (!model || model.id !== request.modelId) {
    reply({ id: request.id, error: "model not loaded" });
    return;
  }
  try {
    const cut = cutAlongBorderLines(model.adjacency, model.corners, model.positions, request.groups, {
      span: request.span,
      protectedGroup: request.protectedGroup,
      settled: request.settled,
      cutFaces: request.cutFaces,
    });
    reply({ id: request.id, cut }, [cut.addedVertices.buffer, cut.pieces.buffer, cut.pieceGroups.buffer, cut.pieceFaces.buffer, cut.replaced.buffer]);
  } catch (err) {
    reply({ id: request.id, error: err instanceof Error ? err.message : String(err) });
  }
};
