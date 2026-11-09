import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Filament, PaletteEntry, PhysicalSlot } from "@core/types";
import {
  accentPaletteIndices,
  fidelityScore,
  OWNED_COLOUR_DELTA_E,
  SIMILAR_COLOUR_DELTA_E,
  type ColourWishlist,
  type SpoolRecommendation,
  type SwapOutcome,
} from "@core/spoolAdvice";
import { adviceKey, ask, knownAnswer, Superseded, type ShelfAnswer } from "../engine/adviceClient";
import { rgbToHex } from "@core/colour";
import { parseFilamentList } from "@core/filaments";
import { FILAMENT_PRESETS, MAX_PHYSICAL, MIN_PHYSICAL, type FilamentListEntry, type FilamentSettings, type MixSettings } from "../engine/types";
import { hexToRgb } from "../engine/mesh";
import { useT, type Key } from "../i18n";
import { Swatch } from "./common";
import { HelpTip } from "./HelpTip";
import { ColourSelect } from "./ColourSelect";
import { ColourPicker } from "./ColourPicker";

function toFilament(entry: FilamentListEntry): Filament {
  const rgb = hexToRgb(entry.hex);
  return { name: entry.name, type: entry.type, rgb, effectiveRgb: rgb, sourceLine: `${entry.name}; ${entry.type}; ${entry.hex}` };
}

/**
 * Parse "name; type; #hex" lines. A line may start with a slot prefix such as
 * "E1:" / "E1;" / "1." to put the filament straight into that slot.
 */
export function parseListText(text: string): { entries: FilamentListEntry[]; assignments: Array<{ slot: number; entry: FilamentListEntry }> } {
  const entries: FilamentListEntry[] = [];
  const assignments: Array<{ slot: number; entry: FilamentListEntry }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const prefixed = /^[Ee]?(\d{1,2})\s*[:;.)\-]\s*(.+)$/.exec(line);
    const body = prefixed ? prefixed[2] : line;
    const parsed = parseFilamentList(body);
    if (parsed.length === 0) continue;
    const entry: FilamentListEntry = { name: parsed[0].name, type: parsed[0].type, hex: rgbToHex(parsed[0].rgb) };
    entries.push(entry);
    if (prefixed) {
      const slot = Number(prefixed[1]);
      if (slot >= 1 && slot <= MAX_PHYSICAL) assignments.push({ slot, entry });
    }
  }
  return { entries, assignments };
}

export function FilamentSection({
  settings,
  onChange,
  palette,
  list,
  onListChange,
  mix,
  currentSlots,
  shareBySlot,
  children,
}: {
  settings: FilamentSettings;
  onChange: (next: FilamentSettings) => void;
  palette: PaletteEntry[];
  list: FilamentListEntry[];
  onListChange: (next: FilamentListEntry[]) => void;
  mix: MixSettings;
  currentSlots: PhysicalSlot[];
  /** Share of the model's surface each slot shows (layer ratio × area). */
  shareBySlot?: Map<number, number>;
  /** Rendered between the slots and the shelf (the mixing settings). */
  children?: ReactNode;
}) {
  const t = useT();
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [pasted, setPasted] = useState("");
  const [newHex, setNewHex] = useState("#4CAF50");
  const [newName, setNewName] = useState("");
  const [advice, setAdvice] = useState<SpoolRecommendation | null>(null);
  const [wishlist, setWishlist] = useState<{ count: number; data: ColourWishlist } | null>(null);
  // One answer per tool count, so flipping between 4 / 5 / 8 heads is instant.
  const [wishCache, setWishCache] = useState<Map<number, ColourWishlist>>(new Map());
  /** Fidelity already worked out per tool count, shown on the count buttons. */
  const wishScores = useMemo(() => {
    const map = new Map<number, number>();
    for (const [count, data] of wishCache) map.set(count, fidelityScore(data.score));
    return map;
  }, [wishCache]);
  const update = (patch: Partial<FilamentSettings>) => onChange({ ...settings, ...patch });
  const setSlot = (i: number, hex: string, name?: string) => {
    const nextHex = [...settings.hex];
    nextHex[i] = hex.toUpperCase();
    const nextNames = [...settings.names];
    if (name !== undefined) nextNames[i] = name;
    update({ hex: nextHex, names: nextNames });
  };
  const swapSlots = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= settings.count || b >= settings.count) return;
    const nextHex = [...settings.hex];
    const nextNames = [...settings.names];
    [nextHex[a], nextHex[b]] = [nextHex[b], nextHex[a]];
    [nextNames[a], nextNames[b]] = [nextNames[b], nextNames[a]];
    update({ hex: nextHex, names: nextNames });
  };
  /** 1-based slot currently holding this list entry (matched by colour), 0 when none. */
  const slotOfEntry = (entry: FilamentListEntry, hexes: string[] = settings.hex): number => {
    for (let i = 0; i < settings.count; i++) {
      if (hexes[i]?.toUpperCase() === entry.hex.toUpperCase()) return i + 1;
    }
    return 0;
  };
  /**
   * Put a list entry into a slot. If the entry already sits in another slot the
   * two slots swap contents, so a filament never ends up in two slots at once.
   */
  const moveEntryToSlot = (hexes: string[], names: string[], entry: FilamentListEntry, target: number): void => {
    const current = slotOfEntry(entry, hexes) - 1;
    if (current === target) return;
    if (current >= 0) {
      hexes[current] = hexes[target];
      names[current] = names[target];
    }
    hexes[target] = entry.hex.toUpperCase();
    names[target] = entry.name;
  };
  const assignEntryToSlot = (entry: FilamentListEntry, target: number) => {
    const nextHex = [...settings.hex];
    const nextNames = [...settings.names];
    moveEntryToSlot(nextHex, nextNames, entry, target);
    update({ hex: nextHex, names: nextNames });
  };
  const fillFromPalette = () => {
    if (palette.length === 0) return;
    const sorted = [...palette].sort((a, b) => b.count - a.count);
    const next = [...settings.hex];
    for (let i = 0; i < settings.count; i++) {
      const entry = sorted[i];
      if (entry) next[i] = rgbToHex(entry.rgb);
    }
    update({ hex: next });
  };
  const applyListText = (text: string) => {
    const { entries, assignments } = parseListText(text);
    if (entries.length === 0) return;
    const merged = [...list];
    for (const entry of entries) {
      if (!merged.some((e) => e.name === entry.name && e.hex === entry.hex)) merged.push(entry);
    }
    onListChange(merged);
    if (assignments.length > 0) {
      const nextHex = [...settings.hex];
      const nextNames = [...settings.names];
      let count = settings.count;
      for (const { slot } of assignments) if (slot > count) count = slot;
      for (const { slot, entry } of assignments) moveEntryToSlot(nextHex, nextNames, entry, slot - 1);
      update({ hex: nextHex, names: nextNames, count });
    }
    setPasted("");
  };
  /** The same mixing settings the pipeline will use, so the advice is not a different engine. */
  // Small vivid colours (a flower's red centre) are scored above their area, and
  // any colour the spools cannot make at all is reported, not averaged away.
  const accentIndices = useMemo(() => accentPaletteIndices(palette), [palette]);
  const planOptions = {
    accentIndices,
    maxComponents: mix.assignmentMode === "physical-only" ? (1 as const) : mix.maxComponents,
    purePhysicalThreshold: mix.purePhysicalThreshold,
    recipeResolution: mix.recipeResolution,
    accentProtection: mix.accentProtection,
    mixPriority: mix.mixPriority,
    mappingStrategy: mix.mappingStrategy,
    colourDifferenceMetric: mix.colourDifferenceMetric,
    previewLightnessOffset: mix.previewLightnessOffset,
  };
  // Equipment-screen comparison (what each spool on the shelf would do in the
  // slot it fits best), the best the shelf and the ideal could reach, and what
  // the loaded set loses — all planned in the advice worker, so the panel opens
  // at once and the numbers arrive when they are ready.
  const inputs = useMemo(
    () => ({
      palette: palette.map((entry) => ({ index: entry.index, rgb: entry.rgb, count: entry.count })),
      slots: currentSlots.map((slot) => ({ slot: slot.slot, rgb: slot.filament.effectiveRgb, name: slot.filament.name })),
      list,
      mix,
      count: settings.count,
    }),
    [palette, currentSlots, list, mix, settings.count],
  );
  const shelfKey = useMemo(() => adviceKey("shelf", inputs), [inputs]);
  const [shelf, setShelf] = useState<ShelfAnswer | null>(() => knownAnswer<"shelf">(shelfKey) ?? null);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  useEffect(() => {
    if (palette.length === 0 || currentSlots.length === 0) {
      setShelf(null);
      return;
    }
    const known = knownAnswer<"shelf">(shelfKey);
    if (known) {
      setShelf(known);
      return;
    }
    let live = true;
    setShelf(null);
    ask(
      { kind: "shelf", palette, slots: currentSlots, shelf: list.map((entry) => ({ key: `${entry.name}|${entry.hex}`, filament: toFilament(entry) })), count: settings.count, options: planOptions },
      shelfKey,
    )
      .then((answer) => {
        if (live) setShelf(answer);
      })
      .catch((err) => {
        if (live && !(err instanceof Superseded)) setAdviceError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
    // planOptions is derived from mix on every render; shelfKey covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelfKey]);
  const swapByEntry = useMemo(() => new Map<string, SwapOutcome | null>(shelf?.swaps ?? []), [shelf]);
  const anchors = shelf ? { owned: shelf.owned, ideal: shelf.ideal } : null;
  const currentScore = shelf?.current ?? null;
  const currentFidelity = shelf ? fidelityScore(shelf.current) : null;
  /** Which shelf question is being worked on (for the buttons' "계산 중…"). */
  const [asking, setAsking] = useState<"recommend" | "wanted" | null>(null);

  useEffect(() => {
    setWishCache(new Map());
    setWishlist(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, currentSlots, list, mix]);

  const addEntry = () => {
    const hex = newHex.toUpperCase();
    const name = newName.trim() || hex;
    if (list.some((e) => e.hex.toUpperCase() === hex && e.name === name)) return;
    onListChange([...list, { name, type: "", hex }]);
    setNewName("");
  };
  const suggestFromList = () => {
    if (list.length === 0 || palette.length === 0) return;
    setWishlist(null);
    setAsking("recommend");
    const maxComponents = mix.assignmentMode === "physical-only" ? 1 : mix.maxComponents;
    ask(
      { kind: "recommend", palette, slots: currentSlots, shelf: list.map(toFilament), count: settings.count, maxComponents, options: planOptions },
      adviceKey("recommend", { ...inputs, maxComponents }),
    )
      .then((answer) => {
        setAdvice(answer);
        setAsking(null);
      })
      .catch((err) => {
        if (err instanceof Superseded) return;
        setAsking(null);
        setAdviceError(err instanceof Error ? err.message : String(err));
      });
  };
  const askForColours = (count = settings.count) => {
    if (palette.length === 0) return;
    setAdvice(null);
    const cached = wishCache.get(count);
    if (cached) {
      setWishlist({ count, data: cached });
      return;
    }
    setAsking("wanted");
    ask({ kind: "wanted", palette, slots: currentSlots, shelf: list.map(toFilament), count, options: planOptions }, adviceKey("wanted", { ...inputs, count }))
      .then((data) => {
        setAsking(null);
        if (!data) return;
        setWishCache((prev) => new Map(prev).set(count, data));
        setWishlist({ count, data });
      })
      .catch((err) => {
        if (err instanceof Superseded) return;
        setAsking(null);
        setAdviceError(err instanceof Error ? err.message : String(err));
      });
  };
  const applyAdvice = () => {
    if (!advice) return;
    const nextHex = [...settings.hex];
    const nextNames = [...settings.names];
    advice.slots.forEach((slot, i) => {
      if (i >= settings.count) return;
      nextHex[i] = rgbToHex(slot.filament.rgb);
      nextNames[i] = slot.filament.name;
    });
    update({ hex: nextHex, names: nextNames });
    setAdvice(null);
  };

  return (
    <>
      <section className="pane-section" aria-label={t("fil.slotsTitle")}>
        <div className="pane-head">
          <span className="pane-label">
            {t("fil.slotsTitle")}
            <HelpTip text={t("help.filaments")} />
          </span>
          <span className="inline" style={{ gap: 4 }}>
            <select className="compact" value={settings.count} title={t("fil.countHint")} onChange={(e) => update({ count: Number(e.target.value) })}>
              {Array.from({ length: MAX_PHYSICAL - MIN_PHYSICAL + 1 }, (_v, i) => MIN_PHYSICAL + i).map((n) => (
                <option key={n} value={n}>
                  {t("fil.tools", { n })}
                </option>
              ))}
            </select>
            <select
              className="compact"
              value=""
              title={t("fil.preset")}
              onChange={(e) => {
                const preset = FILAMENT_PRESETS.find((p) => p.name === e.target.value);
                if (!preset) return;
                const next = [...settings.hex];
                preset.hex.forEach((hex, i) => (next[i] = hex));
                update({ hex: next, count: preset.hex.length });
              }}
            >
              <option value="">{t("fil.preset")}</option>
              {FILAMENT_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {t(`preset.${p.name}` as Key)}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="slot-cards">
          {Array.from({ length: settings.count }, (_v, i) => (
            <FilamentCard
              key={i}
              index={i}
              count={settings.count}
              hex={settings.hex[i]}
              name={settings.names[i]}
              share={shareBySlot?.get(i + 1)}
              open={openSlot === i}
              onToggle={() => setOpenSlot(openSlot === i ? null : i)}
              list={list}
              onHex={(hex) => setSlot(i, hex)}
              onName={(name) => setSlot(i, settings.hex[i], name)}
              onPick={(entry) => assignEntryToSlot(entry, i)}
              onMove={(delta) => {
                swapSlots(i, i + delta);
                setOpenSlot(i + delta);
              }}
            />
          ))}
        </div>
        <button type="button" className="text-link" style={{ alignSelf: "flex-start" }} onClick={fillFromPalette} disabled={palette.length === 0} title={t("fil.fillHint")}>
          {t("fil.fillFromPalette")}
        </button>
      </section>
      {children}
      <section className="pane-section" aria-label={t("fil.shelfTitle")}>
        <div className="pane-head">
          <span className="pane-label">{t("fil.shelfTitle")}</span>
          <span className="pane-aside">{list.length > 0 ? t("fil.listCount", { n: list.length }) : t("fil.noList")}</span>
        </div>
        {currentFidelity === null && palette.length > 0 && <div className="shelf-scores">{t("fil.shelfWorking")}</div>}
        {currentFidelity !== null && (
          <div className="shelf-scores" title={t("fil.fidelityHint")}>
            <span>
              {t("fil.scoreNow")} <b className="mono">{Math.round(currentFidelity)}</b>
            </span>
            {anchors?.owned != null && (
              <span>
                {t("fil.scoreOwned")} <b className="mono">{Math.round(anchors.owned)}</b>
              </span>
            )}
            {anchors?.ideal != null && (
              <span>
                {t("fil.scoreIdeal")} <b className="mono">{Math.round(anchors.ideal)}</b>
              </span>
            )}
          </div>
        )}
        {currentScore && currentScore.lost.length > 0 && (
          <span className="swap-bad" title={t("fil.lostHint")}>
            ⚠ {t("fil.lostNow", { n: currentScore.lost.length })}{" "}
            {currentScore.lost.map((entry) => (
              <span key={entry.paletteIndex} className="cell-colour" style={{ marginRight: 6 }}>
                <Swatch hex={rgbToHex(entry.rgb)} />
              </span>
            ))}
          </span>
        )}
        <button type="button" className="shelf-btn" onClick={suggestFromList} disabled={palette.length === 0 || list.length === 0 || asking === "recommend"} title={t("fil.suggestHint")}>
          {t("fil.shelfBetter")}
          <span aria-hidden="true">{asking === "recommend" ? t("fil.working") : "▸"}</span>
        </button>
        <button type="button" className="shelf-btn" onClick={() => askForColours()} disabled={palette.length === 0 || asking === "wanted"} title={t("fil.wantedHint")}>
          {t("fil.shelfWanted")}
          <span aria-hidden="true">{asking === "wanted" ? t("fil.working") : "▸"}</span>
        </button>
        {adviceError && <span className="danger">{t("status.error", { message: adviceError })}</span>}
        {advice && <AdvicePanel advice={advice} count={settings.count} onApply={applyAdvice} onClose={() => setAdvice(null)} />}
        {wishlist && (
          <WishlistPanel
            wishlist={wishlist.data}
            count={wishlist.count}
            printerCount={settings.count}
            scores={wishScores}
            onCount={(next) => askForColours(next)}
            onClose={() => setWishlist(null)}
          />
        )}
      <details className="filament-list">
        <summary className="muted">
          {t("fil.listTitle")}
        </summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <p className="muted">{t("fil.listIntro")}</p>
          <div className="inline">
            <ColourPicker value={newHex.toUpperCase()} onChange={setNewHex} size={24} title={t("fil.listAddColour")} />
            <input
              type="text"
              value={newName}
              placeholder={t("fil.listAddName")}
              style={{ width: 230 }}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEntry();
                }
              }}
            />
            <button type="button" className="btn small" onClick={addEntry}>
              {t("fil.listAdd")}
            </button>
          </div>
          {list.length > 0 && (
            <>
              <p className="muted">{t("fil.listAssignHint", { n: settings.count })}</p>
              <div className="table-wrap">
                <table className="grid filament-list-table">
                  <thead>
                    <tr>
                      <th>{t("load.colour")}</th>
                      <th>{t("fil.listName")}</th>
                      <th>{t("fil.listType")}</th>
                      <th>{t("fil.swapHeader")}</th>
                      <th>{t("fil.listSlot")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((entry, index) => {
                      const slot = slotOfEntry(entry);
                      return (
                        <tr key={`${entry.name}-${entry.hex}-${index}`}>
                          <td>
                            <span className="cell-colour">
                              <Swatch hex={entry.hex} />
                              <code>{entry.hex}</code>
                            </span>
                          </td>
                          <td style={{ whiteSpace: "normal" }}>{entry.name}</td>
                          <td>{entry.type || "-"}</td>
                          <td>
                            <SwapCells slot={slot} outcome={swapByEntry.get(`${entry.name}|${entry.hex}`) ?? null} />
                          </td>
                          <td>
                            <select
                              value={slot || ""}
                              onChange={(e) => {
                                const target = Number(e.target.value);
                                if (target >= 1) assignEntryToSlot(entry, target - 1);
                              }}
                            >
                              <option value="">{t("fil.unassigned")}</option>
                              {Array.from({ length: settings.count }, (_v, i) => (
                                <option key={i} value={i + 1}>
                                  E{i + 1}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button type="button" className="btn small" title={t("fil.listRemove")} onClick={() => onListChange(list.filter((_e, i) => i !== index))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <details className="filament-bulk">
            <summary className="muted">{t("fil.listBulk")}</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <label className="btn small" style={{ justifySelf: "start" }}>
            {t("fil.listFile")}
            <input
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void file.text().then(applyListText);
                e.target.value = "";
              }}
            />
          </label>
          <span className="muted">{t("fil.listPaste")}</span>
          <textarea value={pasted} placeholder={`E1: ${t("fil.listExample")}`} onChange={(e) => setPasted(e.target.value)} />
          <span className="muted">{t("fil.listFormatHint")}</span>
          <div className="inline">
            <button type="button" className="btn small" disabled={!pasted.trim()} onClick={() => applyListText(pasted)}>
              {t("fil.listApply")}
            </button>
            <button type="button" className="btn small" disabled={list.length === 0} onClick={() => onListChange([])}>
              {t("fil.listClear")}
            </button>
          </div>
            </div>
          </details>
        </div>
      </details>
        <span className="muted">{t("fil.hexNote")}</span>
      </section>
    </>
  );
}

/**
 * Equipment-screen style comparison for one shelf spool: what the model gains
 * and loses if it goes into the printer, in the numbers that decide the print.
 */
function SwapCells({ slot, outcome }: { slot: number; outcome: SwapOutcome | null }) {
  const t = useT();
  if (slot > 0) return <span className="muted">{t("fil.swapLoaded")}</span>;
  if (!outcome) return <span className="muted">-</span>;
  const before = Math.round(outcome.fidelityBefore);
  const after = Math.round(outcome.fidelityAfter);
  const delta = after - before;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "=";
  const cls = delta > 0 ? "swap-good" : delta < 0 ? "swap-bad" : "muted";
  const points = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))}%p`;
  // Colours this swap would stop being able to print, and ones it rescues.
  const lostBefore = new Set(outcome.before.lost.map((entry) => entry.paletteIndex));
  const lostAfter = new Set(outcome.after.lost.map((entry) => entry.paletteIndex));
  const broken = outcome.after.lost.filter((entry) => !lostBefore.has(entry.paletteIndex));
  const fixed = outcome.before.lost.filter((entry) => !lostAfter.has(entry.paletteIndex));
  // Why the number moved, biggest cause first: colours lost or rescued, then
  // how much of the model stops being layered, then plain colour accuracy.
  const reasons: string[] = [];
  if (broken.length > 0) reasons.push(t("fil.whyLost", { n: broken.length }));
  if (fixed.length > 0) reasons.push(t("fil.whyFixed", { n: fixed.length }));
  if (outcome.pureDelta >= 0.02) reasons.push(t("fil.whyPureUp", { pct: Math.round(outcome.pureDelta * 100) }));
  else if (outcome.pureDelta <= -0.02) reasons.push(t("fil.whyPureDown", { pct: Math.round(-outcome.pureDelta * 100) }));
  if (outcome.threeDelta <= -0.02) reasons.push(t("fil.whyThreeDown", { pct: Math.round(-outcome.threeDelta * 100) }));
  else if (outcome.threeDelta >= 0.02) reasons.push(t("fil.whyThreeUp", { pct: Math.round(outcome.threeDelta * 100) }));
  if (outcome.errorDelta <= -0.5) reasons.push(t("fil.whyCloser"));
  else if (outcome.errorDelta >= 0.5) reasons.push(t("fil.whyFurther"));
  return (
    <span
      className="swap-cells"
      title={t("fil.swapTitle", {
        slot: outcome.slot,
        out: outcome.replaced,
        pure: points(outcome.pureDelta),
        three: points(outcome.threeDelta),
        error: `${outcome.errorDelta >= 0 ? "+" : "−"}${Math.abs(outcome.errorDelta).toFixed(1)}`,
      })}
    >
      <b className={cls}>
        {arrow} {delta > 0 ? "+" : delta < 0 ? "−" : ""}
        {Math.abs(delta)}
      </b>
      <span className="muted">
        {before} → {after}
      </span>
      <span className="muted">
        E{outcome.slot} ↔ {outcome.replaced}
      </span>
      {reasons.length > 0 && <span className="swap-why muted">{reasons.slice(0, 3).join(" · ")}</span>}
      {broken.length > 0 && (
        <span className="swap-bad">
          ⚠ {t("fil.swapBreaks")}{" "}
          {broken.map((entry) => (
            <span key={entry.paletteIndex} className="cell-colour" style={{ marginRight: 4 }}>
              <Swatch hex={rgbToHex(entry.rgb)} />
            </span>
          ))}
        </span>
      )}
      {fixed.length > 0 && (
        <span className="swap-good">
          + {t("fil.swapFixes")}{" "}
          {fixed.map((entry) => (
            <span key={entry.paletteIndex} className="cell-colour" style={{ marginRight: 4 }}>
              <Swatch hex={rgbToHex(entry.rgb)} />
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** "This model wants these colours" — the shopping question, inventory or not. */
function WishlistPanel({
  wishlist,
  count,
  printerCount,
  scores,
  onCount,
  onClose,
}: {
  wishlist: ColourWishlist;
  count: number;
  printerCount: number;
  scores: Map<number, number>;
  onCount: (count: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const owns = (colour: ColourWishlist["colours"][number]) =>
    colour.nearest !== null && colour.nearest.deltaE <= OWNED_COLOUR_DELTA_E;
  // "Missing" means the shelf has nothing that even stands in for it; a close
  // enough spool is not something to go shopping for.
  const missing = wishlist.colours.filter(
    (colour) => !colour.nearest || colour.nearest.deltaE > SIMILAR_COLOUR_DELTA_E,
  );
  return (
    <div className="advice-panel">
      <div className="inline">
        <b>{t("fil.bestSet", { n: count, score: Math.round(fidelityScore(wishlist.score)) })}</b>
      </div>
      <div className="advice-slots">
        {wishlist.colours
          .slice()
          .sort((a, b) => (a.step?.slot ?? 99) - (b.step?.slot ?? 99))
          .map((colour, index) => (
            <span key={colour.hex} className="advice-slot">
              <Swatch hex={colour.hex} />
              <b>E{colour.step?.slot ?? index + 1}</b>
              <code>{colour.hex}</code>
            </span>
          ))}
      </div>
      <div className="inline">
        <span className="muted">{t("fil.toolCount")}</span>
        {Array.from({ length: MAX_PHYSICAL - MIN_PHYSICAL + 1 }, (_v, i) => MIN_PHYSICAL + i).map((n) => (
          <button
            key={n}
            type="button"
            className={`btn small${n === count ? " active" : ""}`}
            onClick={() => onCount(n)}
            title={n === printerCount ? t("fil.toolCountMine") : undefined}
          >
            {n}
            {n === printerCount ? " ★" : ""}
            {scores.has(n) ? <span className="muted"> {Math.round(scores.get(n) as number)}</span> : null}
          </button>
        ))}
      </div>
      <p>{t("fil.wantedIntro", { n: count })}</p>
      <div className="table-wrap">
      <table className="grid advice-table">
        <thead>
          <tr>
            <th>{t("fil.wantedColOrder")}</th>
            <th>{t("fil.wantedColHead")}</th>
            <th>{t("fil.wantedColShare")}</th>
            <th>{t("fil.wantedColHave")}</th>
            <th>{t("fil.wantedColSwap")}</th>
          </tr>
        </thead>
        <tbody>
          {wishlist.colours.map((colour) => (
            <tr key={colour.hex}>
              <td>
                <b>{colour.step ? colour.step.order : "-"}</b>
              </td>
              <td>
                <span className="cell-colour">
                  <Swatch hex={colour.hex} />
                  <code>{colour.hex}</code>
                </span>
              </td>
              <td>{t("fil.wantedShare", { pct: Math.round(colour.share * 100) })}</td>
              <td>
                {owns(colour) ? (
                  <span className="ok-text">✓ {colour.nearest?.name}</span>
                ) : colour.nearest && colour.nearest.deltaE <= SIMILAR_COLOUR_DELTA_E ? (
                  <span>{t("fil.wantedClose", { name: colour.nearest.name })}</span>
                ) : (
                  <b>{t("fil.wantedMissing")}</b>
                )}
              </td>
              <td style={{ whiteSpace: "normal" }}>
                {colour.step ? (
                  <>
                    <b className={colour.step.after >= colour.step.before ? "swap-good" : "muted"}>
                      {Math.round(colour.step.before)} → {Math.round(colour.step.after)}
                    </b>
                    <br />
                    <span className="muted">
                      {t("fil.wantedStepSlot", { slot: colour.step.slot, out: colour.step.replaced })}
                    </span>
                  </>
                ) : colour.swap ? (
                  <span className={colour.swap.fidelityAfter > colour.swap.fidelityBefore ? "swap-good" : "muted"}>
                    {t("fil.wantedSwap", {
                      out: colour.swap.replaced,
                      slot: colour.swap.slot,
                      delta: `${colour.swap.fidelityAfter >= colour.swap.fidelityBefore ? "+" : "−"}${Math.abs(
                        Math.round(colour.swap.fidelityAfter - colour.swap.fidelityBefore),
                      )}`,
                      now: Math.round(colour.swap.fidelityBefore),
                      next: Math.round(colour.swap.fidelityAfter),
                    })}
                  </span>
                ) : (
                  <span className="muted">{t("fil.swapLoaded")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {wishlist.mixed.length > 0 && (
        <p className="muted">
          {t("fil.wantedMixed")}{" "}
          {wishlist.mixed.map((colour) => (
            <span key={colour.hex} className="cell-colour" style={{ marginRight: 10 }}>
              <Swatch hex={colour.hex} />
              {t("fil.wantedMixedItem", {
                pct: Math.round(colour.share * 100),
                n: colour.components,
              })}
            </span>
          ))}
        </p>
      )}
      <p className="muted">
        {missing.length > 0
          ? t("fil.wantedBuy", { n: missing.length })
          : t("fil.wantedHaveAll")}
      </p>
      <p>
        {t("fil.wantedFidelity", {
          now: Math.round(fidelityScore(wishlist.current)),
          next: Math.round(fidelityScore(wishlist.score)),
        })}
      </p>
      <p className="muted">
        {t("fil.wantedCompare", {
          now: `${Math.round(wishlist.current.pureShare * 100)}%`,
          next: `${Math.round(wishlist.score.pureShare * 100)}%`,
          nowErr: wishlist.current.meanError.toFixed(1),
          nextErr: wishlist.score.meanError.toFixed(1),
        })}
      </p>
      <div className="inline">
        <button type="button" className="btn small" onClick={onClose}>
          {t("fil.adviceClose")}
        </button>
      </div>
    </div>
  );
}

/** Shows what swapping to the recommended spools would change before it is applied. */
function AdvicePanel({
  advice,
  count,
  onApply,
  onClose,
}: {
  advice: SpoolRecommendation;
  count: number;
  onApply: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const rows: Array<{ label: string; now: string; next: string }> = [
    {
      label: t("fil.fidelity"),
      now: `${Math.round(fidelityScore(advice.current))}`,
      next: `${Math.round(fidelityScore(advice.score))}`,
    },
    {
      label: t("fil.advicePure"),
      now: pct(advice.current.pureShare),
      next: pct(advice.score.pureShare),
    },
    {
      label: t("fil.adviceTwo"),
      now: pct(advice.current.twoShare),
      next: pct(advice.score.twoShare),
    },
    {
      label: t("fil.adviceThree"),
      now: pct(advice.current.threeShare),
      next: pct(advice.score.threeShare),
    },
    {
      label: t("fil.adviceError"),
      now: advice.current.meanError.toFixed(1),
      next: advice.score.meanError.toFixed(1),
    },
  ];
  return (
    <div className="advice-panel">
      <div className="advice-slots">
        {advice.slots.slice(0, count).map((slot, i) => (
          <span key={slot.slot} className="advice-slot">
            <Swatch hex={rgbToHex(slot.filament.rgb)} />
            <b>E{i + 1}</b> {slot.filament.name}
          </span>
        ))}
      </div>
      <table className="grid advice-table">
        <thead>
          <tr>
            <th />
            <th>{t("fil.adviceNow")}</th>
            <th>{t("fil.adviceNext")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.now}</td>
              <td>
                <b>{row.next}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{t("fil.adviceHint")}</p>
      {advice.unused.length > 0 && (
        <p className="muted">
          {t("fil.adviceUnused")}: {advice.unused.map((f) => f.name).join(", ")}
        </p>
      )}
      <div className="inline">
        <button type="button" className="btn small" onClick={onApply}>
          {t("fil.adviceApply")}
        </button>
        <button type="button" className="btn small" onClick={onClose}>
          {t("fil.adviceClose")}
        </button>
      </div>
    </div>
  );
}

function FilamentCard({
  index,
  count,
  hex,
  name,
  share,
  open,
  onToggle,
  list,
  onHex,
  onName,
  onPick,
  onMove,
}: {
  index: number;
  count: number;
  hex: string;
  name: string;
  share?: number;
  open: boolean;
  onToggle: () => void;
  list: FilamentListEntry[];
  onHex: (hex: string) => void;
  onName: (name: string) => void;
  onPick: (entry: FilamentListEntry) => void;
  onMove: (delta: number) => void;
}) {
  const t = useT();
  const fromList = list.find((entry) => entry.hex.toUpperCase() === hex.toUpperCase());
  return (
    <div className={`slot-card${open ? " open" : ""}`}>
      <div
        className="slot-card-main"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={t("fil.cardHint")}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <span onClick={(event) => event.stopPropagation()} style={{ display: "inline-flex" }}>
          <ColourPicker value={hex.toUpperCase()} onChange={onHex} settle size={26} className="slot-colour">
            <span className="slot-dot" style={{ background: hex }} />
          </ColourPicker>
        </span>
        <span className="slot-text">
          <span className="slot-name">
            {/* "E1 E1": the name is the slot's number (the default) — said once. */}
            {name && name !== `E${index + 1}` ? (
              <>
                <span className="mono slot-no">E{index + 1}</span> <b>{name}</b>
              </>
            ) : (
              <b className="mono">E{index + 1}</b>
            )}
          </span>
          <span className="slot-sub">
            <span className="mono">{hex.toUpperCase()}</span> · {fromList ? fromList.type || t("fil.fromShelf") : t("fil.typed")}
          </span>
        </span>
        {share !== undefined && (
          <span className="slot-share mono" title={t("fil.shareHint")}>
            {Math.round(share * 100)}%
          </span>
        )}
      </div>
      {open && (
        <div className="slot-edit">
          <input type="text" value={name} onChange={(e) => onName(e.target.value)} placeholder={t("fil.name")} title={name} />
          <input
            type="text"
            defaultValue={hex}
            key={hex}
            className="mono"
            onBlur={(e) => {
              const v = e.target.value.trim().toUpperCase();
              if (/^#[0-9A-F]{6}$/.test(v)) onHex(v);
              else e.target.value = hex;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <ColourSelect
            value=""
            disabled={list.length === 0}
            placeholder={t("fil.pickFromList")}
            title={t("fil.pickFromList")}
            filterable
            onChange={(next) => {
              const entry = list[Number(next)];
              if (entry) onPick(entry);
            }}
            options={list.map((entry, i) => ({ value: String(i), hex: entry.hex, label: entry.name, sub: `${entry.type ? `${entry.type} · ` : ""}${entry.hex}` }))}
          />
          <span className="slot-order">
            <button type="button" className="btn" title={t("fil.moveUp")} disabled={index === 0} onClick={() => onMove(-1)}>
              ▲
            </button>
            <button type="button" className="btn" title={t("fil.moveDown")} disabled={index >= count - 1} onClick={() => onMove(1)}>
              ▼
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
