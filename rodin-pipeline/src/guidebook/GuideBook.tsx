import { Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WITH_CLAUDE } from "../features";
import { LangContext, useT } from "../i18n";
import { Icon } from "../ui/Shell";
import ko from "./ko.md?raw";
import en from "./en.md?raw";

/**
 * 📖 The detailed guide (11-09): the whole app in pictures, step by step — a table of contents on the left, the
 * pages on the right. Written as Markdown (src/guidebook/ko.md, en.md) so it is easy to keep up; the pictures are
 * the app's own screens (public/guide/<lang>/*.webp, taken with tools/headless). The 💬 consult's part shows only
 * where the consult is (the 5173 build).
 */

type Heading = { kind: "h1" | "h2" | "h3"; text: string; id: string };
type Block =
  | Heading
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: Array<{ text: string; sub: string[] }> }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "img"; alt: string; name: string };

/** A heading's anchor: its words, lower-case, joined by dashes (Korean kept). */
function slug(text: string, used: Set<string>): string {
  const base = text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "section";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/** Splits a table row into its cells ("| a | b |"). */
function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

/** The Markdown this guide uses: headings, paragraphs, lists (an ordered one with a level of sub-items), tables, pictures. */
export function parseGuide(source: string, withClaude: boolean): Block[] {
  // The consult's part only where the consult is.
  const text = withClaude ? source.replace(/<!-- \/?claude -->\n?/g, "") : source.replace(/<!-- claude -->[\s\S]*?<!-- \/claude -->\n?/g, "");
  const lines = text.split("\n");
  const blocks: Block[] = [];
  const used = new Set<string>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ kind: (["h1", "h2", "h3"] as const)[level - 1], text: heading[2], id: slug(heading[2], used) });
      i++;
      continue;
    }
    const picture = /^!\[(.*)\]\((.+)\)\s*$/.exec(line);
    if (picture) {
      blocks.push({ kind: "img", alt: picture[1], name: picture[2] });
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2; // the head and the |---| line
      while (i < lines.length && lines[i].startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: Array<{ text: string; sub: string[] }> = [];
      while (i < lines.length && (/^\d+\. /.test(lines[i]) || /^\s+- /.test(lines[i]))) {
        const item = /^\d+\. (.*)$/.exec(lines[i]);
        if (item) items.push({ text: item[1], sub: [] });
        else items[items.length - 1]?.sub.push(lines[i].replace(/^\s+- /, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |!\[|\||- |\d+\. )/.test(lines[i])) paragraph.push(lines[i++].trim());
    blocks.push({ kind: "p", text: paragraph.join(" ") });
  }
  return blocks;
}

/** **bold** and `code` inside a line. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function GuideBook({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lang } = useContext(LangContext);
  const blocks = useMemo(() => parseGuide(lang === "ko" ? ko : en, WITH_CLAUDE), [lang]);
  const sections = blocks.filter((block): block is Heading => block.kind === "h2");
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The section being read is marked in the contents as the pages scroll.
  useEffect(() => {
    const page = pageRef.current;
    if (!page || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setCurrent(seen.target.id);
      },
      { root: page, rootMargin: "0px 0px -70% 0px" },
    );
    page.querySelectorAll("h2[id]").forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [blocks]);

  const go = (id: string) => {
    setCurrent(id);
    pageRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("guidebook.title")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="guidebook">
        <nav className="guidebook-toc" aria-label={t("guidebook.contents")}>
          <div className="guidebook-toc-title">{t("guidebook.contents")}</div>
          {sections.map((section) => (
            <button key={section.id} type="button" className={`guidebook-toc-item${current === section.id ? " current" : ""}`} onClick={() => go(section.id)}>
              {section.text}
            </button>
          ))}
        </nav>
        <button type="button" className="icon-btn guidebook-close" aria-label={t("perf.close")} title={t("perf.close")} onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="guidebook-page" ref={pageRef}>
          {blocks.map((block, i) => {
            switch (block.kind) {
              case "h1":
                return (
                  <h1 key={i} id={block.id}>
                    {block.text}
                  </h1>
                );
              case "h2":
                return (
                  <h2 key={i} id={block.id}>
                    {block.text}
                  </h2>
                );
              case "h3":
                return (
                  <h3 key={i} id={block.id}>
                    {block.text}
                  </h3>
                );
              case "p":
                return <p key={i}>{inline(block.text)}</p>;
              case "ul":
                return (
                  <ul key={i}>
                    {block.items.map((item, j) => (
                      <li key={j}>{inline(item)}</li>
                    ))}
                  </ul>
                );
              case "ol":
                return (
                  <ol key={i}>
                    {block.items.map((item, j) => (
                      <li key={j}>
                        {inline(item.text)}
                        {item.sub.length > 0 && (
                          <ul>
                            {item.sub.map((sub, k) => (
                              <li key={k}>{inline(sub)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                );
              case "table":
                return (
                  <div key={i} className="guidebook-table">
                    <table>
                      <thead>
                        <tr>
                          {block.head.map((cell, j) => (
                            <th key={j}>{inline(cell)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, j) => (
                          <tr key={j}>
                            {row.map((cell, k) => (
                              <td key={k}>{inline(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              case "img":
                return (
                  <figure key={i}>
                    <img src={`guide/${lang}/${block.name}.webp`} alt={block.alt} loading="lazy" />
                    <figcaption>{block.alt}</figcaption>
                  </figure>
                );
            }
          })}
        </div>
      </div>
    </div>
  );
}
