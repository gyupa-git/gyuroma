import { useState, type CSSProperties, type ReactNode } from "react";
import { rgbToHex } from "@core/colour";
import type { ColourStripData, StripGroup } from "@core/colourStrip";
import { deltaE2000, rgbToLab } from "@core/prusaFdmMixer";
import { NO_TONE, isNoTone, type Tone } from "../engine/groupTone";
import type { MergeFlag, MergeSettings } from "../engine/types";
import { useT } from "../i18n";
import type { StripOutput } from "./ColourStrip";
import { HelpTip } from "./HelpTip";
import { NumberField, pct } from "./common";
import { Icon } from "./Shell";

/**
 * Step 02's left panel: the group picked on the spectrum or on the model
 * (what it is, where it prints, which other group prints the same, its
 * brightness, saturation and hue), what to do with it, how many groups to aim
 * for, and the tidy-up rules.
 */
export function CleanupPanel({
  strip,
  groups,
  selected,
  focusHex,
  onToggleSelected,
  outputOf,
  flags,
  onFlagChange,
  mergeSettings,
  onMergeSettings,
  targetGroups,
  onTargetChange,
  onSplitGroup,
  onMergeUp,
  onMergeSelected,
  onRemoveSpecks,
  speckFaces,
  onSpeckFaces,
  busy,
  advanced,
  highlight,
  tone,
  onTone,
  onToneCommit,
  toneFrom,
  toneHex,
  toneWall,
  toneTracks,
  toneScope,
  onToneScope,
  pieceFaces,
  onRejoin,
}: {
  strip: ColourStripData | null;
  /** The groups at rest (the palette). */
  groups: StripGroup[];
  selected: string[];
  /** The group the card shows: a patch picked on the model, else the last colour chosen on the spectrum. */
  focusHex: string | null;
  onToggleSelected: (hex: string) => void;
  outputOf: (hex: string) => StripOutput | undefined;
  flags: Record<string, MergeFlag>;
  onFlagChange: (hex: string, patch: Partial<MergeFlag>) => void;
  mergeSettings: MergeSettings;
  onMergeSettings: (next: MergeSettings) => void;
  targetGroups: number;
  onTargetChange: (next: number) => void;
  onSplitGroup: (family: number, fraction: number) => void;
  /** Merge group `index` of `family` into the one above it. */
  onMergeUp: (family: number, index: number) => void;
  /** Bake every selected group into `targetHex` (across families too). */
  onMergeSelected: (targetHex: string) => void;
  /** The small patches of other colours lying in this colour turn into it. */
  onRemoveSpecks: (hex: string) => void;
  /** The biggest patch "얼룩 없애기" takes (faces), set right beside it. */
  speckFaces: number;
  onSpeckFaces: (n: number) => void;
  busy: boolean;
  /** The full palette table and its settings, behind "고급". */
  advanced: ReactNode;
  /** Fields the last auto tidy changed, shown in yellow. */
  highlight?: Set<string> | null;
  /** The card's group's brightness, saturation and hue, from where the adjustment started. */
  tone: Tone;
  /** While a slider moves (shown, not kept). */
  onTone: (next: Tone) => void;
  /** When a slider is let go: kept, ⌘Z takes it back. */
  onToneCommit: () => void;
  /** The group's colour before the adjustment, while it is adjusted. */
  toneFrom: string | null;
  /** The group's colour as the sliders have it now. */
  toneHex: string | null;
  /** The next group of the family whose lightness the brightness has reached. */
  toneWall: string | null;
  /** Each slider's track: the colours it runs through. */
  toneTracks: Record<keyof Tone, string> | null;
  /** With a patch picked: the sliders on the picked pieces only, or the whole group; null when there is no choice. */
  toneScope: "piece" | "group" | null;
  onToneScope: (scope: "piece" | "group") => void;
  /** Faces of the picked pieces of this group. */
  pieceFaces: number;
  /** A split-off piece back into the group it came from. */
  onRejoin: () => void;
}) {
  const t = useT();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const live = groups.filter((group) => group.colours.length > 0);
  const hexOf = (group: StripGroup) => rgbToHex(group.rep);
  const focus = focusHex ? live.find((group) => hexOf(group) === focusHex) ?? null : null;
  const familyGroups = focus ? live.filter((group) => group.family === focus.family) : [];
  const positionInFamily = focus ? familyGroups.indexOf(focus) : -1;
  const familyName = focus ? strip?.families.find((f) => f.family === focus.family)?.name : undefined;
  const out = focusHex ? outputOf(focusHex) : undefined;
  const protectedGroups = live.filter((group) => flags[hexOf(group)]?.protect);
  const isProtected = focusHex ? Boolean(flags[focusHex]?.protect) : false;
  const selectedLive = selected.filter((hex) => live.some((group) => hexOf(group) === hex));

  // Other groups that print as exactly the same output: merging with one of
  // them changes nothing in the print.
  const sameOutput = focus && out ? live.filter((group) => group !== focus && outputOf(hexOf(group))?.label === out.label) : [];
  const neighbourBelow = focus ? familyGroups[positionInFamily + 1] : undefined;
  const neighbourAbove = focus ? familyGroups[positionInFamily - 1] : undefined;
  const partner = sameOutput.find((group) => group === neighbourBelow) ?? sameOutput.find((group) => group === neighbourAbove) ?? sameOutput[0];
  const partnerDe = focus && partner ? deltaE2000(rgbToLab(focus.rep), rgbToLab(partner.rep)) : 0;

  const shownHex = toneHex ?? focusHex ?? "";
  const presets = [8, 12, 16, 24];
  const hl = (key: string) => (highlight?.has(key) ? "hl-field" : undefined);

  return (
    <>
      <section className="pane-section" aria-label={t("clean.selected")}>
        <div className="pane-head">
          <span className="pane-label">{t("clean.selected")}</span>
          {focus && familyName && (
            <span className="pane-aside">
              {t(`strip.family.${familyName}` as Parameters<typeof t>[0])} · {positionInFamily + 1} / {familyGroups.length}
            </span>
          )}
        </div>
        {focus && focusHex ? (
          <>
            <div className="group-card">
              {/* while adjusted: the colour it started as on the left, as it is now on the right */}
              <span
                className="big-swatch"
                title={toneFrom && shownHex !== toneFrom ? `${toneFrom} → ${shownHex}` : undefined}
                style={{ background: toneFrom && shownHex !== toneFrom ? `linear-gradient(90deg, ${toneFrom} 0 50%, ${shownHex} 50% 100%)` : shownHex }}
              />
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span className="hex">{shownHex}</span>
                {/* One colour prints; the original texture's shades stay underneath (cuts and edges are worked out
                    from them).  Each piece wraps whole, never "원본 명암 / 3,996가지", and a line never starts with the dot. */}
                <span className="sub">
                  {[
                    <>
                      {t("clean.area")} <span className="mono">{pct(focus.weight)}</span>
                    </>,
                    ...(focus.colours.length > 1 ? t("clean.shades", { n: focus.colours.length.toLocaleString() }) : t("clean.shadesOne")).split(" · "),
                    ...(focus.pinned ? [<span title={t("clean.pinnedHint")}>📌 {t("clean.pinned")}</span>] : []),
                    ...(toneFrom && shownHex !== toneFrom ? [<span className="mono">{t("tone.from", { hex: toneFrom })}</span>] : []),
                  ].map((piece, i) => (
                    <span key={i}>
                      {i > 0 && "\u00a0· "}
                      <span className="sub-piece">{piece}</span>
                    </span>
                  ))}
                </span>
              </span>
            </div>
            {focus.pinned && (
              <div className="same-note">
                <span>{t("clean.rejoinNote")}</span>
                <button type="button" className="btn small soft" disabled={busy} title={t("clean.rejoinHint")} onClick={onRejoin}>
                  ↩ {t("clean.rejoin")}
                </button>
              </div>
            )}
            <div className="tone" title={t("tone.hint")}>
              <div className="tone-head">
                <span>{t("tone.title")}</span>
                {!isNoTone(tone) && (
                  <button
                    type="button"
                    className="btn small"
                    title={t("tone.resetHint")}
                    disabled={busy}
                    onClick={() => {
                      onTone(NO_TONE);
                      onToneCommit();
                    }}
                  >
                    ↺ {t("tone.reset")}
                  </button>
                )}
              </div>
              {toneScope && (
                <div className="seg flat tone-scope" role="group" aria-label={t("tone.scope")}>
                  <button type="button" aria-pressed={toneScope === "piece"} disabled={busy} onClick={() => onToneScope("piece")}>
                    {t("tone.scopePiece")}
                  </button>
                  <button type="button" aria-pressed={toneScope === "group"} disabled={busy} onClick={() => onToneScope("group")}>
                    {t("tone.scopeGroup")}
                  </button>
                </div>
              )}
              {toneScope === "piece" && !focus.pinned && <span className="tone-note">{t("tone.pieceNote", { n: pieceFaces.toLocaleString() })}</span>}
              {toneWall && (
                <span className="tone-wall">
                  <span className="dot" style={{ background: toneWall }} />
                  {t("tone.wall", { hex: toneWall })}
                </span>
              )}
              {(["light", "chroma", "hue"] as const).map((key) => (
                <label key={key} className="tone-row">
                  <span>{t(`tone.${key}`)}</span>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={tone[key]}
                    aria-label={t(`tone.${key}`)}
                    style={{ "--track": toneTracks?.[key] ?? "var(--border)", "--thumb": shownHex } as CSSProperties}
                    disabled={busy}
                    onChange={(event) => onTone({ ...tone, [key]: Number(event.target.value) })}
                    onPointerDown={() => window.addEventListener("pointerup", () => onToneCommit(), { once: true })}
                    onKeyUp={() => onToneCommit()}
                    onDoubleClick={() => {
                      onTone({ ...tone, [key]: 0 });
                      onToneCommit();
                    }}
                  />
                  <span className={`mono value${tone[key] !== 0 ? " moved" : ""}`}>{tone[key] > 0 ? `+${tone[key]}` : tone[key] < 0 ? `−${-tone[key]}` : "0"}</span>
                </label>
              ))}
            </div>
            <div className="kv">
              <span>{t("clean.output")}</span>
              <span className="inline">
                {out ? (
                  <>
                    <span className={`ve-chip${out.physical ? " physical" : ""}`}>{out.label}</span>
                    <span className="muted" style={{ color: "var(--text-2)" }}>
                      {out.physical ? t("clean.outputSingle") : t("clean.outputMix")}
                    </span>
                  </>
                ) : (
                  <span className="muted">–</span>
                )}
              </span>
              {sameOutput.length > 0 && (
                <>
                  <span>{t("clean.sameOutput")}</span>
                  <span className="inline">
                    {sameOutput.slice(0, 3).map((group) => (
                      <button key={hexOf(group)} type="button" className="chip button" title={t("clean.pickThis")} onClick={() => onToggleSelected(hexOf(group))}>
                        <span className="dot" style={{ background: hexOf(group) }} />
                        <span className="mono">{hexOf(group)}</span>
                        <span className="mono" style={{ color: "var(--muted)" }}>
                          {pct(group.weight)}
                        </span>
                      </button>
                    ))}
                  </span>
                </>
              )}
            </div>
            {partner && out && (
              <div className="same-note">
                <span>{t("clean.sameNote", { hex: hexOf(partner), de: partnerDe.toFixed(1), out: out.label })}</span>
                {(partner === neighbourBelow || partner === neighbourAbove) && (
                  <button
                    type="button"
                    className="btn small soft"
                    disabled={busy}
                    onClick={() => (partner === neighbourBelow ? onMergeUp(focus.family, partner.index) : onMergeUp(focus.family, focus.index))}
                  >
                    {partner === neighbourBelow ? t("clean.mergeBelow") : t("clean.mergeAbove")}
                  </button>
                )}
              </div>
            )}
            <div className="group-actions">
              <button type="button" aria-pressed={isProtected} disabled={busy} title={t("merge.protectTip")} onClick={() => onFlagChange(focusHex, { protect: !isProtected })}>
                <Icon name="lock" />
                <span>{t("clean.protect")}</span>
              </button>
              <button type="button" disabled={busy || focus.colours.length < 2} title={t("clean.splitHint")} onClick={() => onSplitGroup(focus.family, (focus.from + focus.to) / 2)}>
                <Icon name="split" />
                <span>{t("clean.split")}</span>
              </button>
              <button type="button" disabled={busy || positionInFamily <= 0} title={t("strip.mergeUp")} onClick={() => onMergeUp(focus.family, focus.index)}>
                <Icon name="mergeUp" />
                <span>{t("clean.mergeUp")}</span>
              </button>
              <button
                type="button"
                disabled={busy || selectedLive.length < 2}
                title={selectedLive.length < 2 ? t("clean.crossHintNone") : t("clean.crossHint", { n: selectedLive.length - 1, hex: focusHex })}
                onClick={() => onMergeSelected(focusHex)}
              >
                <Icon name="link" />
                <span>{t("clean.cross")}</span>
              </button>
            </div>
            <div className="specks-row" title={t("clean.specksHint", { n: speckFaces })}>
              <button type="button" disabled={busy} onClick={() => onRemoveSpecks(focusHex)}>
                <Icon name="heal" />
                <span>{t("clean.specks")}</span>
              </button>
              <span className="muted">{t("clean.specksUpTo")}</span>
              <NumberField value={speckFaces} min={1} max={1000000} step={50} width={66} disabled={busy} onChange={onSpeckFaces} />
              <span className="muted">{t("clean.specksFaces")}</span>
            </div>
          </>
        ) : (
          <p className="empty-note">{t("clean.none")}</p>
        )}
      </section>

      <section className="pane-section" aria-label={t("clean.target")}>
        <div className="pane-head">
          <span className="pane-label">
            {t("clean.target")}
            <HelpTip text={t("strip.targetHint")} />
          </span>
          {strip && <span className="pane-aside">{t("clean.original", { n: strip.colourCount.toLocaleString() })}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className={`stepper${hl("target") ? " hl-field" : ""}`}>
            <button type="button" aria-label={t("clean.less")} disabled={busy || targetGroups <= 2} onClick={() => onTargetChange(targetGroups - 1)}>
              −
            </button>
            <span className="value">{targetGroups}</span>
            <button type="button" aria-label={t("clean.more")} disabled={busy || targetGroups >= 64} onClick={() => onTargetChange(targetGroups + 1)}>
              +
            </button>
          </div>
          <div className="presets">
            {presets.map((n) => (
              <button key={n} type="button" aria-pressed={targetGroups === n} disabled={busy} onClick={() => onTargetChange(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="pane-section" aria-label={t("clean.rules")}>
        <div className="pane-head">
          <span className="pane-label">{t("clean.rules")}</span>
          <button type="button" className="text-link" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
            {t("clean.advanced")} {showAdvanced ? "▾" : "▸"}
          </button>
        </div>
        <div className="rule-grid">
          <span title={t("merge.minBlobTip")}>{t("clean.islands")}</span>
          <span className={`unit${hl("minBlob") ? " hl-field" : ""}`}>
            <NumberField value={mergeSettings.minBlobDefault} min={0} step={10} width={58} disabled={busy} onChange={(v) => onMergeSettings({ ...mergeSettings, minBlobDefault: Math.max(0, Math.round(v)) })} />
            {t("clean.faces")}
          </span>
          <span title={t("clean.smoothHint")}>{t("clean.smooth")}</span>
          <span className={`unit${hl("smoothing") ? " hl-field" : ""}`}>
            <NumberField value={mergeSettings.smoothingRounds} min={0} max={20} width={58} disabled={busy} onChange={(v) => onMergeSettings({ ...mergeSettings, smoothingRounds: Math.max(0, Math.min(20, Math.round(v))) })} />
            {t("clean.rounds")}
          </span>
          <span title={t("clean.lineHint")}>{t("clean.line")}</span>
          <span className={`unit${hl("lineSmooth") ? " hl-field" : ""}`}>
            <NumberField value={mergeSettings.lineSpan} min={0} max={40} width={58} disabled={busy} onChange={(v) => onMergeSettings({ ...mergeSettings, lineSpan: Math.max(0, Math.min(40, Math.round(v))) })} />
            {t("clean.lineUnit")}
          </span>
          <span title={t("clean.trimHint")}>{t("clean.trim")}</span>
          <span className={`unit${hl("trimTeeth") ? " hl-field" : ""}`}>
            <NumberField value={mergeSettings.trimRounds} min={0} max={10} width={58} disabled={busy} onChange={(v) => onMergeSettings({ ...mergeSettings, trimRounds: Math.max(0, Math.min(10, Math.round(v))) })} />
            {t("clean.rounds")}
          </span>
          <label htmlFor="clean-smooth-protected" title={t("clean.smoothProtectedHint")}>
            {t("clean.smoothProtected")}
          </label>
          <span className={`unit${hl("smoothProtected") ? " hl-field" : ""}`}>
            <input
              id="clean-smooth-protected"
              type="checkbox"
              checked={mergeSettings.smoothProtected}
              disabled={busy}
              title={t("clean.smoothProtectedHint")}
              onChange={(e) => onMergeSettings({ ...mergeSettings, smoothProtected: e.target.checked })}
            />
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          <span className="pane-label">{t("clean.protected")}</span>
          {protectedGroups.length > 0 ? (
            <div className={`chip-row${hl("protect") ? " hl-field" : ""}`}>
              {protectedGroups.map((group) => (
                <button key={hexOf(group)} type="button" className="chip button" title={`${hexOf(group)} · ${t("clean.pickThis")}`} onClick={() => onToggleSelected(hexOf(group))}>
                  <span className="dot" style={{ background: hexOf(group) }} />
                  <span className="mono">{pct(group.weight)}</span>
                  <Icon name="lock" size={11} stroke={1.6} />
                </button>
              ))}
            </div>
          ) : (
            <span className="empty-note" style={{ padding: 0 }}>
              {t("clean.protectedNone")}
            </span>
          )}
        </div>
      </section>
      {showAdvanced && advanced}
    </>
  );
}
