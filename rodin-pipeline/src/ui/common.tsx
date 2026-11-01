import type { ReactNode } from "react";
import { HelpTip } from "./HelpTip";
import type { RGB } from "@core/types";
import { rgbToHex } from "@core/colour";

export function Section({
  step,
  title,
  subtitle,
  badge,
  children,
  open = true,
  help,
}: {
  step: number;
  title: string;
  /** One line saying what this step is for, under the title. */
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
  open?: boolean;
  /** Explanation shown behind a "?" button in the header. */
  help?: string;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        <span className="section-step">{step}</span>
        <span className="section-title">{title}</span>
        {help && <HelpTip text={help} />}
        {badge && <span className="section-badge">{badge}</span>}
      </summary>
      <div className="section-body">
        {subtitle && <p className="section-subtitle">{subtitle}</p>}
        {children}
      </div>
    </details>
  );
}

/** A heading for a group of rows inside a section. */
export function Group({ title, note }: { title: string; note?: string }) {
  return (
    <div className="group-title">
      <span>{title}</span>
      {note && <span className="group-note">{note}</span>}
    </div>
  );
}

export function Row({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`row${className ? ` ${className}` : ""}`} title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  width = 90,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  width?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      style={{ width }}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

export function Swatch({ rgb, hex, title, size = 18 }: { rgb?: RGB; hex?: string; title?: string; size?: number }) {
  const colour = hex ?? (rgb ? rgbToHex(rgb) : "#808080");
  return <span className="swatch" style={{ background: colour, width: size, height: size }} title={title ?? colour} />;
}

/**
 * A share as a number of percent: one decimal from 1 % up, two below, and
 * "<0.01" for a sliver that would round to nothing — what is there never
 * reads 0 (a colour shown at "0.0 %" while it is on the model, 11-02).
 */
export function pctNumber(fraction: number): string {
  const value = fraction * 100;
  if (value < 0) return `-${pctNumber(-fraction)}`;
  if (!(value > 0)) return "0";
  if (value >= 1) return value.toFixed(1);
  if (value >= 0.01) return value.toFixed(2);
  return "<0.01";
}

export function pct(fraction: number): string {
  return `${pctNumber(fraction)}%`;
}
