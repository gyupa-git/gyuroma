import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { rgbToHex } from "@core/colour";
import { moveCut, type ColourStripData, type StripCuts, type StripGroup } from "@core/colourStrip";
import { deltaE2000, rgbToLab } from "@core/prusaFdmMixer";
import type { RGB } from "@core/types";
import { useT } from "../i18n";
import { HelpTip } from "./HelpTip";
import { Icon, Segmented } from "./Shell";

/**
 * The colour spectrum: every colour of the model in one continuous bar,
 * family by family (a thick line where the family changes, its name on the
 * left) and light to dark inside a family.  Each band is one group — one
 * palette colour — with its share of the area written in it and where it
 * prints (E4, VE7 …) on the right.  Drag the line between two bands into
 * one of them: past its middle, the band dragged from takes it whole (both
 * become one), and letting go short of that puts the line back.  With Shift
 * held the line moves colours across a little at a time instead (where the
 * light and the dark of a colour meet on the model), the two bands' numbers
 * counting as it moves.  Double-click a band to split it there.
 */
export interface StripOutput {
  label: string;
  /** Printed with one filament (E1–E5) rather than a mix. */
  physical: boolean;
}

export interface ColourStripProps {
  strip: ColourStripData | null;
  /** Groups for the cuts being shown (the live ones during a drag). */
  groups: StripGroup[];
  /** Groups as they are at rest; the layout and the "before" of every change. */
  baseGroups: StripGroup[];
  /** The cuts at rest, which a drag starts from. */
  committedCuts: StripCuts;
  /** Called on every pointer move while a cut is dragged; null cancels the drag. */
  onPreview: (cuts: StripCuts | null) => void;
  /** Called once when the drag ends; the caller tidies and keeps the cuts. */
  onCommit: (cuts: StripCuts) => void;
  onSplit: (family: number, groupIndex: number, fraction: number) => void;
  onRelayout: () => void;
  onUndo?: () => void;
  undoCount?: number;
  hoverHex: string | null;
  onHover: (hex: string | null) => void;
  selected: string[];
  onToggleSelected: (hex: string) => void;
  /** Turns every selected colour into this one (a click on its output chip). */
  onApplyTo?: (hex: string) => void;
  /** Lets go of every chosen colour at once (the chip in the tools row; Esc does the same). */
  onClearSelected?: () => void;
  /** Colours of the patches picked on the model: marked with the same ring as the pin over them. */
  pointed?: string[];
  /** Where a group prints, when the plan knows. */
  outputOf?: (hex: string) => StripOutput | undefined;
  protectedHexes?: Set<string>;
  /** How the groups print: one filament, or a mix. */
  summary?: { single: number; singleLabels: string[]; mixed: number };
  busy?: boolean;
}

type HeightMode = "area" | "even";

const MIN_BAND_PX = 18;
/** Columns: family label | bar | flow lane | output. */
const LABEL_W = 46;
const BAR_X = 52;
const BAR_W = 64;
const LANE_X = BAR_X + BAR_W;
const LANE_W = 26;
const OUT_X = LANE_X + LANE_W + 6;
/** The dot in front of a chosen band. */
const DOT = 5.2;
/** The flowing lines to an output chip run from the bar's edge to the chip. */
const APPLY_W = OUT_X - LANE_X;
const MODE_KEY = "rodin-pipeline-strip-mode";

function luminance(rgb: RGB): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}
function textOn(rgb: RGB): string {
  return luminance(rgb) > 0.55 ? "rgba(20,20,21,0.75)" : "rgba(255,255,255,0.85)";
}
function pctText(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

interface BandLayout {
  group: StripGroup;
  /** Position of the group in `groups` / `baseGroups`. */
  at: number;
  top: number;
  height: number;
  familyStart: boolean;
}

interface FamilyLayout {
  family: number;
  name: string;
  weight: number;
  top: number;
  height: number;
}

interface DragState {
  family: number;
  /** Cut index inside the family; the cut sits between group `index` and `index + 1`. */
  index: number;
  upperAt: number;
  lowerAt: number;
  lastY: number;
  /** Pointer offset so far (Shift scales new movement down). */
  offset: number;
  startFraction: number;
  /** Family-area fraction the two bands cover together, and their height on screen. */
  pairFraction: number;
  pairPx: number;
  upperPx: number;
  /** Where the upper band starts and the lower one ends: the cut goes there when one takes the other whole. */
  upperFrom: number;
  lowerTo: number;
  /** Shift held at the last move: the cut moves colours a little at a time. */
  fine: boolean;
  /** Past the middle of a band: which one is taken whole on release. */
  eat: "upper" | "lower" | null;
}

interface DragView {
  /** The boundary between the two bands on screen, px from the top of the bar. */
  y: number;
  /** Where the line is drawn, when it is not on the boundary (pushing into a band, short of taking it). */
  lineY?: number;
  fine: boolean;
  eat: "upper" | "lower" | null;
  upperAt: number;
  lowerAt: number;
  upperPx: number;
  lowerPx: number;
}

export function ColourStrip({
  strip,
  groups,
  baseGroups,
  committedCuts,
  onPreview,
  onCommit,
  onSplit,
  onRelayout,
  onUndo,
  undoCount = 0,
  hoverHex,
  onHover,
  selected,
  onToggleSelected,
  onApplyTo,
  onClearSelected,
  pointed,
  outputOf,
  protectedHexes,
  summary,
  busy = false,
}: ColourStripProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostHeight, setHostHeight] = useState(600);
  const [mode, setModeState] = useState<HeightMode>(() => {
    try {
      return window.localStorage.getItem(MODE_KEY) === "even" ? "even" : "area";
    } catch {
      return "area";
    }
  });
  const setMode = (next: HeightMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // ignore
    }
  };
  const drag = useRef<DragState | null>(null);
  const [dragView, setDragView] = useState<DragView | null>(null);
  /** The colour whose output chip the pointer is on, while chosen colours would turn into it. */
  const [applyTo, setApplyTo] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setHostHeight(host.clientHeight));
    observer.observe(host);
    setHostHeight(host.clientHeight);
    return () => observer.disconnect();
  }, [strip]);

  // A colour picked on the model is brought into view on the strip.
  const pointedKey = pointed?.join(",") ?? "";
  useEffect(() => {
    if (pointedKey) hostRef.current?.querySelector<HTMLElement>(".spectrum-pin")?.scrollIntoView({ block: "nearest" });
  }, [pointedKey]);

  // The bar at rest.  Area mode: every band gets room to read and the rest is
  // shared by area; even mode: all bands the same height.
  const layout = useMemo(() => {
    const bands: BandLayout[] = [];
    const families: FamilyLayout[] = [];
    if (!strip) return { bands, families, total: 0 };
    const live = baseGroups.map((group, at) => ({ group, at })).filter(({ group }) => group.colours.length > 0);
    const n = Math.max(1, live.length);
    // clientHeight includes the scroll area's padding (8 + 10).
    const available = Math.max(n * MIN_BAND_PX, hostHeight - 20);
    const flexible = available - n * MIN_BAND_PX;
    const totalWeight = live.reduce((sum, { group }) => sum + group.weight, 0) || 1;
    let y = 0;
    let previousFamily = -1;
    for (const { group, at } of live) {
      const height = mode === "even" ? available / n : MIN_BAND_PX + (flexible * group.weight) / totalWeight;
      const familyStart = group.family !== previousFamily;
      if (familyStart) {
        const meta = strip.families.find((f) => f.family === group.family);
        families.push({ family: group.family, name: meta?.name ?? "neutral", weight: meta?.weight ?? 0, top: y, height: 0 });
      }
      families[families.length - 1].height += height;
      bands.push({ group, at, top: y, height, familyStart: familyStart && bands.length > 0 });
      previousFamily = group.family;
      y += height;
    }
    return { bands, families, total: y };
  }, [strip, baseGroups, hostHeight, mode]);

  const liveCount = groups.filter((group) => group.colours.length > 0).length;
  const baseCount = baseGroups.filter((group) => group.colours.length > 0).length;

  // Pointer moves can come faster than frames; the result view is rebuilt at
  // most once a frame, with the latest position.
  const previewFrame = useRef<number | null>(null);
  const pendingPreview = useRef<StripCuts | null>(null);
  const schedulePreview = (cuts: StripCuts) => {
    pendingPreview.current = cuts;
    if (previewFrame.current !== null) return;
    previewFrame.current = window.requestAnimationFrame(() => {
      previewFrame.current = null;
      if (drag.current && pendingPreview.current) onPreview(pendingPreview.current);
    });
  };
  const finishDrag = useCallback(() => {
    drag.current = null;
    setDragView(null);
    if (previewFrame.current !== null) window.cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
  }, []);

  // Esc cancels a drag and puts the cut back.
  useEffect(() => {
    if (!dragView) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      finishDrag();
      onPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragView, finishDrag, onPreview]);

  const clampedOffset = (d: DragState) => Math.max(-d.upperPx, Math.min(d.pairPx - d.upperPx, d.offset));
  const fractionFor = (d: DragState) => d.startFraction + (clampedOffset(d) / Math.max(1, d.pairPx)) * d.pairFraction;

  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>, upper: BandLayout, lower: BandLayout) => {
    if (busy || !strip) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const familyWeight = strip.families.find((f) => f.family === upper.group.family)?.weight || 1;
    const index = upper.group.index;
    drag.current = {
      family: upper.group.family,
      index,
      upperAt: upper.at,
      lowerAt: lower.at,
      lastY: event.clientY,
      offset: 0,
      startFraction: committedCuts[upper.group.family]?.[index] ?? upper.group.to,
      pairFraction: (upper.group.weight + lower.group.weight) / familyWeight,
      pairPx: upper.height + lower.height,
      upperPx: upper.height,
      upperFrom: upper.group.from,
      lowerTo: lower.group.to,
      fine: event.shiftKey,
      eat: null,
    };
    setDragView({ y: lower.top, upperAt: upper.at, lowerAt: lower.at, upperPx: upper.height, lowerPx: lower.height, fine: event.shiftKey, eat: null });
  };

  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.offset += event.clientY - d.lastY;
    d.lastY = event.clientY;
    d.fine = event.shiftKey;
    const offset = clampedOffset(d);
    const upper = layout.bands.find((b) => b.at === d.upperAt);
    if (!upper) return;
    const lowerPx = d.pairPx - d.upperPx;
    const base = { upperAt: d.upperAt, lowerAt: d.lowerAt, fine: d.fine };
    if (d.fine) {
      // A little at a time: the boundary follows the pointer and colours move across with it.
      d.eat = null;
      setDragView({ ...base, y: upper.top + d.upperPx + offset, upperPx: d.upperPx + offset, lowerPx: lowerPx - offset, eat: null });
      schedulePreview(moveCut(committedCuts, d.family, d.index, fractionFor(d)));
      return;
    }
    // Past the middle of the band pushed into, the other takes it whole; short of that nothing changes yet.
    d.eat = offset > lowerPx / 2 ? "lower" : offset < -d.upperPx / 2 ? "upper" : null;
    if (d.eat === "lower") {
      setDragView({ ...base, y: upper.top + d.pairPx, upperPx: d.pairPx, lowerPx: 0, eat: "lower" });
      schedulePreview(moveCut(committedCuts, d.family, d.index, d.lowerTo));
    } else if (d.eat === "upper") {
      setDragView({ ...base, y: upper.top, upperPx: 0, lowerPx: d.pairPx, eat: "upper" });
      schedulePreview(moveCut(committedCuts, d.family, d.index, d.upperFrom));
    } else {
      setDragView({ ...base, y: upper.top + d.upperPx, lineY: upper.top + d.upperPx + offset, upperPx: d.upperPx, lowerPx, eat: null });
      schedulePreview(committedCuts);
    }
  };

  const onHandleUp = () => {
    const d = drag.current;
    if (!d) return;
    finishDrag();
    if (d.fine && clampedOffset(d) !== 0) onCommit(moveCut(committedCuts, d.family, d.index, fractionFor(d)));
    else if (!d.fine && d.eat === "lower") onCommit(moveCut(committedCuts, d.family, d.index, d.lowerTo));
    else if (!d.fine && d.eat === "upper") onCommit(moveCut(committedCuts, d.family, d.index, d.upperFrom));
    else onPreview(null);
  };

  if (!strip) {
    return (
      <div className="spectrum empty">
        <span className="muted">{t("strip.empty")}</span>
      </div>
    );
  }

  // During a drag the two bands either side of the cut take their height from
  // the pointer; every other band stays where it was.
  const placeOf = (band: BandLayout): { top: number; height: number } => {
    if (!dragView) return band;
    if (band.at === dragView.upperAt) return { top: band.top, height: dragView.upperPx };
    if (band.at === dragView.lowerAt) return { top: dragView.y, height: dragView.lowerPx };
    return band;
  };
  const changeOf = (at: number): number => (groups[at]?.weight ?? 0) - (baseGroups[at]?.weight ?? 0);

  // What the drag is doing, in words: which colour is moving, how much, and
  // whether the two bands print the same.
  let bubble: { title: string; detail: string; tone: "ok" | "plain" | "warn" } | null = null;
  if (dragView && !dragView.fine) {
    // Taking a band whole: which one goes, and what it prints as from now on.
    const baseUpper = baseGroups[dragView.upperAt];
    const baseLower = baseGroups[dragView.lowerAt];
    if (baseUpper && baseLower && dragView.eat) {
      const eaten = dragView.eat === "lower" ? baseLower : baseUpper;
      const eater = dragView.eat === "lower" ? baseUpper : baseLower;
      const eatenHex = rgbToHex(eaten.rep);
      const eaterHex = rgbToHex(eater.rep);
      const de = deltaE2000(rgbToLab(eaten.rep), rgbToLab(eater.rep));
      const outEaten = outputOf?.(eatenHex);
      const outEater = outputOf?.(eaterHex);
      bubble = {
        title: t("strip.eat", { hex: eatenHex, out: outEaten ? ` (${outEaten.label})` : "" }),
        detail: t("strip.eatDetail", { de: de.toFixed(1), to: eaterHex, out: outEater ? ` · ${outEater.label}` : "" }),
        tone: de > 10 ? "warn" : "ok",
      };
    } else {
      bubble = { title: t("strip.eatPush"), detail: t("strip.eatFine"), tone: "plain" };
    }
  } else if (dragView) {
    const upper = groups[dragView.upperAt];
    const baseUpper = baseGroups[dragView.upperAt];
    const baseLower = baseGroups[dragView.lowerAt];
    if (upper && baseUpper && baseLower) {
      const gain = upper.weight - baseUpper.weight;
      const giver = gain >= 0 ? baseLower : baseUpper;
      const taker = gain >= 0 ? baseUpper : baseLower;
      const giverHex = rgbToHex(giver.rep);
      const de = deltaE2000(rgbToLab(giver.rep), rgbToLab(taker.rep));
      const outGiver = outputOf?.(giverHex);
      const outTaker = outputOf?.(rgbToHex(taker.rep));
      const same = Boolean(outGiver && outTaker && outGiver.label === outTaker.label);
      bubble = {
        title: t("strip.moving", { hex: giverHex, pct: pctText(Math.abs(gain)) }),
        detail:
          outGiver && outTaker
            ? same
              ? t("strip.movingSame", { de: de.toFixed(1), out: outTaker.label })
              : t("strip.movingOther", { de: de.toFixed(1), from: outGiver.label, to: outTaker.label })
            : t("strip.movingDe", { de: de.toFixed(1) }),
        tone: same ? "ok" : de > 10 ? "warn" : "plain",
      };
    }
  }

  let flow: { top: number; height: number; path: string } | null = null;
  // (pushing short of the middle changes nothing yet: no flow)
  if (dragView && (dragView.fine || dragView.eat)) {
    // A flowing line from the cut to the middle of the band that is growing.
    const upper = groups[dragView.upperAt];
    const baseUpper = baseGroups[dragView.upperAt];
    const upperBand = layout.bands.find((b) => b.at === dragView.upperAt);
    if (upperBand) {
      const growUp = upper && baseUpper ? upper.weight >= baseUpper.weight : true;
      const target = growUp ? upperBand.top + dragView.upperPx / 2 : dragView.y + dragView.lowerPx / 2;
      const top = Math.min(dragView.y, target) - 4;
      const y0 = dragView.y - top;
      const y1 = target - top;
      flow = { top, height: Math.abs(target - dragView.y) + 8, path: `M1 ${y0} H 12 V ${y1} H ${LANE_W - 2}` };
    }
  }

  // Pointing at an output chip with colours chosen: a flowing line from each chosen band, through the
  // lane beside the bar, to the chip under the pointer (the one a click turns them into).
  let applyFlows: Array<{ line: string; head: string }> | null = null;
  if (applyTo && !dragView && selected.length > 0) {
    const middleOf = (band: BandLayout) => {
      const rule = band.familyStart ? 3 : 0;
      return band.top + rule + (band.height - rule) / 2;
    };
    const target = layout.bands.find((band) => rgbToHex(band.group.rep) === applyTo);
    if (target) {
      const yt = middleOf(target);
      applyFlows = layout.bands
        .filter((band) => band !== target && selected.includes(rgbToHex(band.group.rep)))
        .map((band, k) => {
          const x = 9 + (k % 3) * 7;
          return { line: `M 2 ${middleOf(band)} H ${x} V ${yt} H ${APPLY_W - 3}`, head: `M ${APPLY_W - 7} ${yt - 4} L ${APPLY_W - 2} ${yt} L ${APPLY_W - 7} ${yt + 4}` };
        });
      if (applyFlows.length === 0) applyFlows = null;
    }
  }

  return (
    <div className="spectrum" onMouseLeave={() => onHover(null)}>
      <div className="spectrum-head">
        <div className="pane-head">
          <span className="pane-title">
            {t("strip.title")}
            <HelpTip text={t("strip.hint")} />
          </span>
          <span className={`spectrum-count mono${liveCount !== baseCount ? " changing" : ""}`} title={liveCount !== baseCount ? t("strip.countChange", { a: baseCount, b: liveCount }) : undefined}>
            {liveCount}
          </span>
        </div>
        <div className="spectrum-stats">
          <div>
            <span>{t("strip.statOriginal")}</span>
            <b className="mono">{strip.colourCount.toLocaleString()}</b>
          </div>
          <div title={summary?.singleLabels.join(" · ")}>
            <span>{t("strip.statSingle")}</span>
            <b className="mono">
              {summary?.single ?? "–"} {summary && summary.singleLabels.length > 0 && <span className="dim">{summary.singleLabels.slice(0, 2).join(" ")}</span>}
            </b>
          </div>
          <div>
            <span>{t("strip.statMixed")}</span>
            <b className="mono">
              {summary?.mixed ?? "–"} <span className="dim">VE</span>
            </b>
          </div>
        </div>
      </div>
      <div className="spectrum-tools">
        <Segmented
          flat
          label={t("strip.heightAria")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "area", label: t("strip.modeArea"), title: t("strip.modeAreaHint") },
            { value: "even", label: t("strip.modeEven"), title: t("strip.modeEvenHint") },
          ]}
        />
        {selected.length > 0 && onClearSelected && (
          <button type="button" className="sel-chip" title={t("strip.clearSelectedHint")} onClick={onClearSelected}>
            {t("strip.selectedCount", { n: selected.length })}
            <Icon name="close" size={10} stroke={1.8} />
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn small" aria-label={t("strip.relayout")} title={t("strip.relayoutHint")} disabled={busy} onClick={onRelayout}>
          <Icon name="refresh" size={14} />
        </button>
        {onUndo && (
          <button type="button" className="icon-btn small" aria-label={t("strip.undo")} title={`${t("strip.undo")}${undoCount > 0 ? ` (${undoCount})` : ""}`} disabled={busy || undoCount === 0} onClick={onUndo}>
            <Icon name="undo" size={14} />
          </button>
        )}
      </div>
      <div className="spectrum-scroll" ref={hostRef}>
        <div className="spectrum-bar" style={{ height: layout.total }}>
          {layout.families.map((family, i) => (
            <div key={family.family} className={`spectrum-family${i > 0 ? " rule" : ""}`} style={{ top: family.top, height: family.height, width: LABEL_W }}>
              <span>{t(`strip.family.${family.name}` as Parameters<typeof t>[0])}</span>
              {family.height >= 34 && <span className="mono pct">{pctText(family.weight)}%</span>}
            </div>
          ))}
          {layout.bands.map((band, i) => {
            const group = groups[band.at] ?? band.group;
            const hex = rgbToHex(band.group.rep);
            const { top, height } = placeOf(band);
            const out = outputOf?.(hex);
            const change = dragView && (band.at === dragView.upperAt || band.at === dragView.lowerAt) ? changeOf(band.at) : 0;
            const first = i === 0;
            const last = i === layout.bands.length - 1;
            return (
              <div key={`${band.group.family}-${band.group.index}`}>
                <div
                  className={`spectrum-band${band.familyStart ? " family-start" : ""}${hoverHex === hex ? " hover" : ""}`}
                  style={{
                    top,
                    height,
                    left: BAR_X,
                    width: BAR_W,
                    background: hex,
                    color: textOn(band.group.rep),
                    borderRadius: `${first ? 5 : 0}px ${first ? 5 : 0}px ${last ? 5 : 0}px ${last ? 5 : 0}px`,
                    alignItems: height >= 30 ? "flex-end" : "center",
                  }}
                  title={t("strip.bandTitle", { hex, pct: pctText(band.group.weight), n: band.group.colours.length.toLocaleString(), out: out ? ` · ${out.label}` : "" })}
                  onMouseEnter={() => onHover(hex)}
                  onClick={() => onToggleSelected(hex)}
                  onDoubleClick={(event) => {
                    if (busy) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const inside = (event.clientY - rect.top) / Math.max(1, rect.height);
                    const share = band.group.to - band.group.from;
                    onSplit(band.group.family, band.group.index, band.group.from + share * Math.max(0.05, Math.min(0.95, inside)));
                  }}
                >
                  {protectedHexes?.has(hex) && (
                    <span className="spectrum-lock" aria-label={t("merge.protect")}>
                      <Icon name="lock" size={10} stroke={1.6} />
                    </span>
                  )}
                  {band.group.pinned && (
                    <span className="spectrum-lock" aria-label={t("clean.pinned")} title={t("clean.pinnedHint")}>
                      <Icon name="pin" size={10} stroke={1.6} />
                    </span>
                  )}
                  {height >= 12 && <span className={`mono${change !== 0 ? " counting" : ""}`}>{pctText(group.weight)}</span>}
                </div>
                {pointed?.includes(hex) && (
                  <span
                    className="pin-mark spectrum-pin"
                    data-hex={hex}
                    style={{ top: top + height / 2 - 4.5, left: LANE_X + 1 }}
                    title={t("strip.pointed", { hex })}
                    aria-label={t("strip.pointed", { hex })}
                  />
                )}
                {out && height >= 14 && (
                  <div className="spectrum-out" style={{ top, height, left: OUT_X }}>
                    {(() => {
                      // With colours chosen, the chip turns them all into this one; with none, it chooses this one.
                      const others = selected.filter((h) => h !== hex).length;
                      return (
                        <button
                          type="button"
                          className={`ve-chip strip-apply${out.physical ? " physical" : ""}${pointed?.includes(hex) ? " pointed" : ""}${others > 0 ? " ready" : ""}`}
                          disabled={busy}
                          title={others > 0 ? t("strip.applyTo", { n: others, label: out.label, hex }) : t("strip.applyToNone")}
                          onMouseEnter={() => {
                            onHover(hex);
                            setApplyTo(others > 0 ? hex : null);
                          }}
                          onMouseLeave={() => setApplyTo(null)}
                          onClick={() => (others > 0 && onApplyTo ? onApplyTo(hex) : onToggleSelected(hex))}
                        >
                          {out.label}
                        </button>
                      );
                    })()}
                    {change !== 0 && (
                      <span className={`mono spectrum-delta${change > 0 ? " up" : ""}`}>
                        {change > 0 ? "+" : "−"}
                        {pctText(Math.abs(change))}
                      </span>
                    )}
                  </div>
                )}
                {selected.includes(hex) &&
                  (() => {
                    // Around the coloured part only (a family's first band starts below its 3 px rule), 2 px
                    // outside it so the corners are covered; an iris dot in front of it, at its middle.
                    const rule = band.familyStart ? 3 : 0;
                    return (
                      <>
                        <span className="spectrum-dot" style={{ top: top + rule + (height - rule) / 2 - DOT / 2, left: BAR_X - 8 - DOT / 2, width: DOT, height: DOT }} aria-hidden="true" />
                        <div className="spectrum-ring" style={{ top: top + rule - 2, height: height - rule + 4, left: BAR_X - 2, width: BAR_W + 4 }} aria-hidden="true" />
                      </>
                    );
                  })()}
              </div>
            );
          })}
          {layout.bands.map((band, i) => {
            const next = layout.bands[i + 1];
            if (!next || next.group.family !== band.group.family) return null;
            const active = dragView?.upperAt === band.at;
            const y = active && dragView ? (dragView.lineY ?? dragView.y) : next.top;
            return (
              <div
                key={`cut-${band.at}`}
                className={`spectrum-cut${active ? " active" : ""}`}
                style={{ top: y - 6, left: BAR_X - 6, width: BAR_W + 12 }}
                onPointerDown={(event) => onHandleDown(event, band, next)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                title={t("strip.cutHint")}
              >
                <span className="line" />
                {active && <span className="grip" />}
              </div>
            );
          })}
          {applyFlows && (
            <svg className="spectrum-flow apply" aria-hidden="true" width={APPLY_W} height={layout.total} viewBox={`0 0 ${APPLY_W} ${layout.total}`} style={{ left: LANE_X, top: 0 }}>
              {applyFlows.map((path, i) => (
                <g key={i}>
                  <path d={path.line} className="glow" />
                  <path d={path.line} className="dash" />
                  <path d={path.head} className="head" />
                </g>
              ))}
            </svg>
          )}
          {flow && (
            <svg className="spectrum-flow" aria-hidden="true" width={LANE_W} height={flow.height} viewBox={`0 0 ${LANE_W} ${flow.height}`} style={{ left: LANE_X, top: flow.top }}>
              <path d={flow.path} className="glow" />
              <path d={flow.path} className="dash" />
            </svg>
          )}
          {bubble && dragView && (
            <div className={`spectrum-bubble ${bubble.tone}`} role="status" style={{ top: Math.min(Math.max(0, layout.total - 70), dragView.y + 12), left: BAR_X }}>
              <b className="mono">{bubble.title}</b>
              <span className="detail">{bubble.detail}</span>
              <span className="keys">{t("strip.dragKeys")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
