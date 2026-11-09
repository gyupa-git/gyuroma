import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGuide } from "./GuideBook";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), "utf8");

describe("the detailed guide", () => {
  it("reads headings, lists, a numbered list with sub-items, tables and pictures", () => {
    const blocks = parseGuide(
      [
        "# Title",
        "Para one",
        "goes on.",
        "",
        "## Part A",
        "- one",
        "- **two**",
        "",
        "1. first",
        "   - sub",
        "2. second",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "![A picture](pic)",
        "<!-- claude -->",
        "## Consult",
        "only there",
        "<!-- /claude -->",
        "## Part B",
      ].join("\n"),
      false,
    );
    expect(blocks.map((b) => b.kind)).toEqual(["h1", "p", "h2", "ul", "ol", "table", "img", "h2"]);
    expect(blocks[1]).toEqual({ kind: "p", text: "Para one goes on." });
    expect(blocks[4]).toEqual({ kind: "ol", items: [{ text: "first", sub: ["sub"] }, { text: "second", sub: [] }] });
    expect(blocks[5]).toEqual({ kind: "table", head: ["a", "b"], rows: [["1", "2"]] });
    expect(blocks[6]).toEqual({ kind: "img", alt: "A picture", name: "pic" });
  });

  it("keeps the consult's part only where the consult is", () => {
    const source = "## A\n<!-- claude -->\n## Consult\ntext\n<!-- /claude -->\n## B\n";
    expect(parseGuide(source, false).filter((b) => b.kind === "h2").length).toBe(2);
    expect(parseGuide(source, true).filter((b) => b.kind === "h2").length).toBe(3);
  });

  it("has the same sections in Korean and English, and every picture it names", () => {
    const ko = parseGuide(read("ko.md"), true);
    const en = parseGuide(read("en.md"), true);
    expect(ko.filter((b) => b.kind === "h2").length).toBe(en.filter((b) => b.kind === "h2").length);
    for (const [lang, blocks] of [["ko", ko], ["en", en]] as const) {
      for (const block of blocks) {
        if (block.kind !== "img") continue;
        expect(existsSync(join(here, "../../public/guide", lang, `${block.name}.webp`)), `${lang}/${block.name}.webp`).toBe(true);
      }
    }
  });
});
