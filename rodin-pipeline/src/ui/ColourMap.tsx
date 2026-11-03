import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { RGB } from "@core/types";
import { faceAtAtlasPixel, paintAtlasImage, paintAtlasOutline, paintAtlasOverlay, type AtlasMasks, type FaceAtlas } from "../engine/atlas";
import type { PickInfo } from "./MeshViewer";
import { DEFAULT_BACKGROUND, fillBackground, type ViewBackground } from "./background";

export interface ColourMapHandle {
  /** Repaint the pixels of these faces from `colourOf`. */
  repaintFaces(faces: ArrayLike<number>): void;
  /** Brush circle mirrored from the 3D view (atlas pixels), or null to hide. */
  setRemoteCursor(position: [number, number] | null): void;
  /**
   * Where the pointer rests on the 3D model (atlas pixels), marked with a crosshair so the
   * spot can be found on the map; null hides it.  With `follow`, a spot out of view (the map
   * zoomed in elsewhere) pans the map just far enough to show it.
   */
  setPointer(position: [number, number] | null, follow?: boolean): void;
  /** Centre the view on an atlas-pixel box [x0, y0, x1, y1], zooming only when it is too small or too large to see. */
  focusOn(box: [number, number, number, number]): void;
}

export interface ColourMapProps {
  atlas: FaceAtlas | null;
  building: boolean;
  /** Reads the colour of a face (current colours, including an in-progress stroke). */
  colourOf: (face: number) => RGB;
  /** Bump to repaint every pixel. */
  coloursVersion: number;
  masks: AtlasMasks;
  /** The brush circle; `innerPx` the healing brush's inner circle (the biggest speck it takes). */
  brush: { active: boolean; radiusPx: number; hex: string; innerPx?: number };
  /** Next click samples a colour instead of picking/painting. */
  eyedropper?: boolean;
  /** Space held: a hand — the left button pans, and nothing is picked or painted. */
  hand?: boolean;
  background?: ViewBackground;
  onPick?: (face: number | null, info: PickInfo) => void;
  /** The face under the pointer and where on the map (atlas pixels); null when it leaves the map. */
  onHover?: (face: number | null, at?: [number, number]) => void;
  onBrushStart?: () => void;
  /** Paint around an atlas position: the caller knows the brush radius and the faces the surface has there. */
  onBrushPaintAt?: (x: number, y: number) => void;
  onBrushEnd?: () => void;
  label: string;
  hint: string;
  emptyLabel: string;
  buildingLabel: string;
}

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Same rhythm as the 3D viewer: a highlight opens with two flashes of the
 * whole area, each falling to nothing so the colour underneath is plain to
 * see, and then only its outline keeps breathing.
 */
const FLASH_PERIOD_MS = 620;
const FLASH_COUNT = 2;
const PULSE_INTERVAL_MS = 33;
/** Outline width on screen; in atlas pixels it has to grow as the map zooms out. */
const OUTLINE_SCREEN_PX = 2.5;
const OUTLINE_WIDTHS = [1, 2, 3, 4, 6, 8, 12, 16, 24];

function outlineWidthFor(scale: number): number {
  const want = OUTLINE_SCREEN_PX / Math.max(scale, 1e-3);
  let best = OUTLINE_WIDTHS[0];
  for (const w of OUTLINE_WIDTHS) if (Math.abs(w - want) < Math.abs(best - want)) best = w;
  return best;
}

export const ColourMap = forwardRef<ColourMapHandle, ColourMapProps>(function ColourMap(
  { atlas, building, colourOf, coloursVersion, masks, brush, eyedropper = false, hand = false, background = DEFAULT_BACKGROUND, onPick, onHover, onBrushStart, onBrushPaintAt, onBrushEnd, label, hint, emptyLabel, buildingLabel },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<{ canvas: HTMLCanvasElement; image: ImageData } | null>(null);
  const overlayRef = useRef<{ canvas: HTMLCanvasElement; image: ImageData; any: boolean } | null>(null);
  const outlineRef = useRef<{ canvas: HTMLCanvasElement; image: ImageData; any: boolean; width: number } | null>(null);
  const masksRef = useRef(masks);
  masksRef.current = masks;
  /** When the current highlight appeared, for the opening flash. */
  const startedAtRef = useRef(0);
  const pulseTimerRef = useRef<number | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const fittedForRef = useRef<FaceAtlas | null>(null);
  /** True once the user zoomed, panned or focused; the map then stops auto-fitting on resize. */
  const userAdjustedRef = useRef(false);
  const cursorRef = useRef<[number, number] | null>(null);
  const remoteCursorRef = useRef<[number, number] | null>(null);
  /** The spot the pointer last touched on the 3D model (atlas pixels). */
  const pointerRef = useRef<[number, number] | null>(null);
  const rafRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onPick, onHover, onBrushStart, onBrushPaintAt, onBrushEnd, colourOf });
  callbacksRef.current = { onPick, onHover, onBrushStart, onBrushPaintAt, onBrushEnd, colourOf };
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const eyedropperRef = useRef(eyedropper);
  eyedropperRef.current = eyedropper;
  const handRef = useRef(hand);
  handRef.current = hand;
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;

  const draw = useCallback(() => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fillBackground(ctx, width, height, backgroundRef.current);
    const base = baseRef.current;
    const view = viewRef.current;
    canvas.dataset.view = `${view.scale.toFixed(4)},${view.tx.toFixed(1)},${view.ty.toFixed(1)}`;
    if (base) {
      ctx.imageSmoothingEnabled = view.scale < 1;
      ctx.save();
      ctx.translate(view.tx, view.ty);
      ctx.scale(view.scale, view.scale);
      ctx.drawImage(base.canvas, 0, 0);
      const overlay = overlayRef.current;
      if (overlay?.any) {
        const now = performance.now();
        const elapsed = now - startedAtRef.current;
        if (elapsed < FLASH_PERIOD_MS * FLASH_COUNT) {
          ctx.globalAlpha = 0.5 - 0.5 * Math.cos((elapsed / FLASH_PERIOD_MS) * Math.PI * 2);
          ctx.drawImage(overlay.canvas, 0, 0);
          ctx.globalAlpha = 1;
        }
        const outline = outlineRef.current;
        const current = atlasRef.current;
        if (outline && current) {
          const want = outlineWidthFor(view.scale);
          if (outline.width !== want) {
            outline.any = paintAtlasOutline(current, masksRef.current, outline.image.data, want);
            outline.width = want;
            outline.canvas.getContext("2d")?.putImageData(outline.image, 0, 0);
          }
          if (outline.any) {
            // Fades in over the first flash, then holds steady.
            ctx.globalAlpha = Math.min(1, 0.4 + (0.6 * elapsed) / FLASH_PERIOD_MS) * 0.9;
            ctx.drawImage(outline.canvas, 0, 0);
            ctx.globalAlpha = 1;
          }
        }
      }
      ctx.restore();
      const drawCursor = (position: [number, number], dashed: boolean) => {
        const cx = position[0] * view.scale + view.tx;
        const cy = position[1] * view.scale + view.ty;
        const r = Math.max(2, brushRef.current.radiusPx * view.scale);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dashed ? [4, 3] : []);
        ctx.strokeStyle = "#9aa0ff";
        ctx.stroke();
        ctx.setLineDash([]);
        const inner = brushRef.current.innerPx;
        if (inner && inner > 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1, Math.min(inner, brushRef.current.radiusPx) * view.scale), 0, Math.PI * 2);
          ctx.lineWidth = 1;
          ctx.setLineDash(dashed ? [4, 3] : []);
          ctx.strokeStyle = "rgba(154, 160, 255, 0.7)";
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "#9aa0ff";
        ctx.fill();
      };
      if (brushRef.current.active && !handRef.current && cursorRef.current) drawCursor(cursorRef.current, false);
      if (remoteCursorRef.current) drawCursor(remoteCursorRef.current, true);
      const pointer = pointerRef.current;
      canvas.dataset.pointer = pointer ? `${pointer[0].toFixed(1)},${pointer[1].toFixed(1)}` : "";
      if (pointer) {
        // The spot under the pointer on the 3D model: a ring with ticks, dark under light, so it reads on any colour.
        const px = pointer[0] * view.scale + view.tx;
        const py = pointer[1] * view.scale + view.ty;
        const ring = 7;
        for (const [width, colour] of [
          [4, "rgba(0, 0, 0, 0.7)"],
          [1.6, "#ffffff"],
        ] as const) {
          ctx.lineWidth = width;
          ctx.strokeStyle = colour;
          ctx.beginPath();
          ctx.arc(px, py, ring, 0, Math.PI * 2);
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            ctx.moveTo(px + dx * (ring + 1), py + dy * (ring + 1));
            ctx.lineTo(px + dx * (ring + 6), py + dy * (ring + 6));
          }
          ctx.stroke();
        }
      }
    }
  }, []);

  const requestDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  // The hand's cursor stands over the tool's own (brush, eyedropper, fill); the brush circle goes while it is held.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hand ? "grab" : "";
    requestDraw();
  }, [hand, requestDraw]);

  // Redraws only while the highlight is flashing; once the flashes are over the
  // outline holds and the map is drawn again only when something changes.
  // (A loop that kept going redrew two 3072² canvases thirty times a second.)
  const pulse = useCallback(() => {
    pulseTimerRef.current = null;
    if (!overlayRef.current?.any) return;
    requestDraw();
    if (performance.now() - startedAtRef.current < FLASH_PERIOD_MS * FLASH_COUNT + PULSE_INTERVAL_MS)
      pulseTimerRef.current = window.setTimeout(pulse, PULSE_INTERVAL_MS);
  }, [requestDraw]);
  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    const current = atlasRef.current;
    if (!canvas || !current) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const scale = Math.max(1e-3, (Math.min(width, height) - 12) / current.size);
    viewRef.current = { scale, tx: (width - current.size * scale) / 2, ty: (height - current.size * scale) / 2 };
    requestDraw();
  }, [requestDraw]);

  useImperativeHandle(
    ref,
    () => ({
      repaintFaces(faces) {
        const current = atlasRef.current;
        const base = baseRef.current;
        if (!current || !base || faces.length === 0) return;
        const rect = paintAtlasImage(current, callbacksRef.current.colourOf, base.image.data, faces);
        if (rect.w > 0 && rect.h > 0) base.canvas.getContext("2d")?.putImageData(base.image, 0, 0, rect.x, rect.y, rect.w, rect.h);
        requestDraw();
      },
      setRemoteCursor(position) {
        remoteCursorRef.current = position;
        requestDraw();
      },
      setPointer(position, follow = false) {
        pointerRef.current = position;
        const canvas = canvasRef.current;
        if (position && follow && canvas && atlasRef.current) {
          const dpr = window.devicePixelRatio || 1;
          const width = canvas.width / dpr;
          const height = canvas.height / dpr;
          const view = viewRef.current;
          const margin = 28;
          if (width > margin * 2 && height > margin * 2) {
            // Out of view: pan just far enough to bring the spot in, with room for its mark.
            const sx = position[0] * view.scale + view.tx;
            const sy = position[1] * view.scale + view.ty;
            const dx = sx < margin ? margin - sx : sx > width - margin ? width - margin - sx : 0;
            const dy = sy < margin ? margin - sy : sy > height - margin ? height - margin - sy : 0;
            if (dx !== 0 || dy !== 0) {
              viewRef.current = { ...view, tx: view.tx + dx, ty: view.ty + dy };
              userAdjustedRef.current = true;
            }
          }
        }
        requestDraw();
      },
      focusOn(box) {
        const canvas = canvasRef.current;
        const current = atlasRef.current;
        if (!canvas || !current) return;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        const bw = Math.max(4, box[2] - box[0]);
        const bh = Math.max(4, box[3] - box[1]);
        const fit = Math.max(1e-3, (Math.min(width, height) - 12) / current.size);
        // Close-up: the patch fills about half of the view, never smaller than the fitted whole map.
        let scale = Math.min((width * 0.55) / bw, (height * 0.55) / bh);
        scale = Math.max(fit, Math.min(scale, 48));
        const cx = (box[0] + box[2]) / 2;
        const cy = (box[1] + box[3]) / 2;
        viewRef.current = { scale, tx: width / 2 - cx * scale, ty: height / 2 - cy * scale };
        userAdjustedRef.current = true;
        requestDraw();
      },
    }),
    [requestDraw],
  );

  // Another atlas (another mesh): the marks of the old one mean nothing on it.
  useEffect(() => {
    pointerRef.current = null;
    remoteCursorRef.current = null;
  }, [atlas]);

  // Offscreen buffers follow the atlas; full repaint on colour version changes.
  useEffect(() => {
    if (!atlas) {
      baseRef.current = null;
      overlayRef.current = null;
      outlineRef.current = null;
      requestDraw();
      return;
    }
    if (!baseRef.current || baseRef.current.canvas.width !== atlas.size) {
      const canvas = document.createElement("canvas");
      canvas.width = atlas.size;
      canvas.height = atlas.size;
      baseRef.current = { canvas, image: new ImageData(atlas.size, atlas.size) };
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = atlas.size;
      overlayCanvas.height = atlas.size;
      overlayRef.current = { canvas: overlayCanvas, image: new ImageData(atlas.size, atlas.size), any: false };
      const outlineCanvas = document.createElement("canvas");
      outlineCanvas.width = atlas.size;
      outlineCanvas.height = atlas.size;
      outlineRef.current = { canvas: outlineCanvas, image: new ImageData(atlas.size, atlas.size), any: false, width: 0 };
    }
    const base = baseRef.current;
    paintAtlasImage(atlas, callbacksRef.current.colourOf, base.image.data);
    base.canvas.getContext("2d")?.putImageData(base.image, 0, 0);
    if (fittedForRef.current !== atlas) {
      fittedForRef.current = atlas;
      userAdjustedRef.current = false;
      fitView();
    }
    requestDraw();
  }, [atlas, coloursVersion, fitView, requestDraw]);

  // Selection overlay: the flash fill, and the outline at the width this zoom needs.
  useEffect(() => {
    const overlay = overlayRef.current;
    const outline = outlineRef.current;
    if (!atlas || !overlay || !outline) return;
    overlay.any = paintAtlasOverlay(atlas, masks, overlay.image.data);
    overlay.canvas.getContext("2d")?.putImageData(overlay.image, 0, 0);
    outline.width = outlineWidthFor(viewRef.current.scale);
    outline.any = paintAtlasOutline(atlas, masks, outline.image.data, outline.width);
    outline.canvas.getContext("2d")?.putImageData(outline.image, 0, 0);
    startedAtRef.current = performance.now();
    requestDraw();
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = overlay.any ? window.setTimeout(pulse, PULSE_INTERVAL_MS) : null;
  }, [atlas, masks, requestDraw, pulse]);

  useEffect(() => {
    requestDraw();
  }, [brush, background, requestDraw]);

  // Canvas sizing.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let first = true;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (first || !fittedForRef.current || !userAdjustedRef.current) {
        first = false;
        fitView();
      }
      requestDraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitView, requestDraw]);

  // Pointer interaction: click = pick, left-drag = pan (or paint in brush mode), right/middle-drag = pan, wheel = zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toAtlas = (event: PointerEvent | WheelEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      return [(event.clientX - rect.left - view.tx) / view.scale, (event.clientY - rect.top - view.ty) / view.scale];
    };
    let down: { x: number; y: number; button: number; moved: boolean; painting: boolean; hand: boolean } | null = null;
    let lastClick: { face: number; time: number } | null = null;
    const paintAt = (position: [number, number]) => {
      if (!atlasRef.current) return;
      callbacksRef.current.onBrushPaintAt?.(position[0], position[1]);
    };
    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      const hand = handRef.current;
      const painting = !hand && brushRef.current.active && event.button === 0 && !event.altKey && !eyedropperRef.current;
      down = { x: event.clientX, y: event.clientY, button: event.button, moved: false, painting, hand };
      if (hand) canvas.style.cursor = "grabbing";
      if (painting) {
        callbacksRef.current.onBrushStart?.();
        paintAt(toAtlas(event));
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const position = toAtlas(event);
      cursorRef.current = position;
      if (down) {
        if (down.painting) {
          paintAt(position);
        } else {
          const dx = event.clientX - down.x;
          const dy = event.clientY - down.y;
          if (Math.hypot(dx, dy) > 4) down.moved = true;
          if (down.moved) {
            userAdjustedRef.current = true;
            viewRef.current = { ...viewRef.current, tx: viewRef.current.tx + dx, ty: viewRef.current.ty + dy };
            down.x = event.clientX;
            down.y = event.clientY;
          }
        }
      } else {
        const current = atlasRef.current;
        callbacksRef.current.onHover?.(current && !handRef.current ? faceAtAtlasPixel(current, position[0], position[1]) : null, position);
      }
      requestDraw();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!down) return;
      const state = down;
      down = null;
      if (state.painting) {
        callbacksRef.current.onBrushEnd?.();
        return;
      }
      if (state.hand) canvas.style.cursor = handRef.current ? "grab" : "";
      if (state.moved || state.button !== 0 || state.hand) return;
      const current = atlasRef.current;
      if (!current) return;
      const position = toAtlas(event);
      const face = faceAtAtlasPixel(current, position[0], position[1]);
      const now = performance.now();
      const double = face >= 0 && lastClick !== null && lastClick.face === face && now - lastClick.time < 400;
      lastClick = double || face < 0 ? null : { face, time: now };
      callbacksRef.current.onPick?.(face >= 0 ? face : null, {
        double,
        toggle: event.shiftKey || event.ctrlKey || event.metaKey,
        alt: event.altKey || eyedropperRef.current,
        source: "map",
      });
    };
    const onPointerLeave = () => {
      cursorRef.current = null;
      callbacksRef.current.onHover?.(null);
      requestDraw();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = atlasRef.current;
      if (!current) return;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const view = viewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const minScale = Math.max(1e-3, (Math.min(rect.width, rect.height) - 12) / current.size) * 0.5;
      const scale = Math.min(64, Math.max(minScale, view.scale * factor));
      const ratio = scale / view.scale;
      userAdjustedRef.current = true;
      viewRef.current = { scale, tx: sx - (sx - view.tx) * ratio, ty: sy - (sy - view.ty) * ratio };
      cursorRef.current = toAtlas(event);
      requestDraw();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [requestDraw]);

  return (
    <div className={`colour-map${brush.active ? " brushing" : ""}${eyedropper ? " eyedropping" : ""}`}>
      <div className="mesh-viewer-label">
        {label}
        {atlas && <span className="muted"> · {atlas.size}px · {hint}</span>}
      </div>
      <div className="colour-map-host" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
      {!atlas && <div className="mesh-viewer-empty">{building ? buildingLabel : emptyLabel}</div>}
      <button
        type="button"
        className="btn small colour-map-fit"
        onClick={() => {
          userAdjustedRef.current = false;
          fitView();
        }}
        title="fit"
      >
        ⤢
      </button>
    </div>
  );
});
