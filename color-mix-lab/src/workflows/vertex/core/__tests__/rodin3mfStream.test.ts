import { describe, expect, it } from "vitest";
import { ModelXmlReader, parseModelXml, type ParsedModelFile } from "../rodin3mf";

/** Maps as arrays, so two results compare whole. */
function plain(file: ParsedModelFile) {
  return { objects: [...file.objects.entries()], buildItems: file.buildItems };
}

/** The text fed in pieces of the given sizes, round and round. */
function streamed(xml: string, sizes: number[]): ParsedModelFile {
  const reader = new ModelXmlReader();
  let at = 0;
  for (let k = 0; at < xml.length; k++) {
    const size = sizes[k % sizes.length];
    reader.push(xml.slice(at, at + size));
    at += size;
  }
  return reader.end();
}

function mesh(seed: number, vertices: number, triangles: number): string {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: string[] = ["<mesh>", "<vertices>"];
  for (let v = 0; v < vertices; v++) out.push(`<vertex x="${(rand() * 20 - 10).toFixed(4)}" y="${(rand() * 20).toFixed(3)}" z="${rand() < 0.05 ? "nan" : (rand() * 5).toFixed(2)}"/>`);
  out.push("</vertices>", "<triangles>");
  for (let t = 0; t < triangles; t++) {
    const a = Math.floor(rand() * (vertices + 2));
    const b = Math.floor(rand() * vertices);
    const c = Math.floor(rand() * vertices);
    const paint = rand();
    const extra = paint < 0.3 ? ` slic3rpe:mmu_segmentation="${Math.floor(rand() * 16)}"` : paint < 0.6 ? ` paint_color="${Math.floor(rand() * 16).toString(16).toUpperCase()}"` : paint < 0.65 ? ' pid="1" p1="0"' : "";
    out.push(`<triangle v1="${a}" v2="${b}"  v3 = "${c}"${extra} />`);
  }
  out.push("</triangles>", "</mesh>");
  return out.join(rand() < 0.5 ? "\n" : "");
}

const CASES: Record<string, string> = {
  plain: `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter"><resources><object id="1" name="Body" type="model">${mesh(1, 40, 70)}</object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 0"/></build></model>`,
  components: `<model><resources><object id="2">${mesh(2, 10, 12)}</object><object id="3" name="Parts"><components><component objectid="2" transform="0 1 0 -1 0 0 0 0 1 1 2 3"/><component objectid="9" p:path="/3D/Objects/a.model"/><component p:path="x"/></components></object></resources><build><item objectid="3"/><item p:path="nope"/><item objectid="2" p:path="/3D/Objects/b.model" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`,
  // Odd ones: what the regular expressions do, the reader must do too.
  noObjectEnd: `<model><object id="1">${mesh(3, 8, 9)}<build><item objectid="1"/></build>`,
  meshNotClosedBeforeObjectEnd: `<model><object id="5"><mesh><vertices><vertex x="1" y="2" z="3"/></vertices></object><object id="6">${mesh(4, 6, 5)}</object></model>`,
  twoMeshes: `<model><object id="1">${mesh(5, 6, 6)}${mesh(6, 9, 9)}<component objectid="1"/></object></model>`,
  commentedTags: `<model><!-- <object id="99"> --><object id="1"><!-- <vertex x="7"/> -->${mesh(7, 5, 4)}</object><!-- </object> --></model>`,
  lookalikes: `<model><objects><object id="1"><meshes/><mesh><vertex-foo x="1" y="1" z="1"/><vertex x="2" y="2" z="2"/><vertexa x="3"/><triangle v1="0" v2="0" v3="0" /><trianglex v1="0"/></mesh></object></objects></model>`,
  quotes: `<model><object id='1' name="N"><mesh><vertex x='1' y="2" z="3"/><vertex x="4" y="5" z="6"/><vertex x="7" y="8" z="9"/><triangle v1="0" v2="1" v3="2" paint_color='4'/></mesh></object></model>`,
  noBuildEnd: `<model><object id="1">${mesh(8, 4, 3)}</object><build><item objectid="1"/>`,
  twoBuilds: `<model><object id="1">${mesh(9, 4, 3)}</object><build><item objectid="1"/></build><build><item objectid="2"/></build></model>`,
  noId: `<model><object name="A">${mesh(10, 4, 3)}</object><object>${mesh(11, 3, 2)}</object></model>`,
  multibyte: `<model><object id="1" name="규로마 모델 ✨">${mesh(12, 6, 6)}</object></model>`,
  empty: ``,
  textOnly: `no tags at all`,
};

describe("ModelXmlReader — a model XML read in pieces", () => {
  for (const [name, xml] of Object.entries(CASES)) {
    it(`gives what parseModelXml gives for the whole text: ${name}`, () => {
      const expected = plain(parseModelXml(xml));
      for (const sizes of [[xml.length + 1], [1], [2, 3], [7], [5, 13, 1, 64], [17, 1, 1, 31], [100]]) {
        expect(plain(streamed(xml, sizes)), `${name} in pieces of ${sizes.join(",")}`).toEqual(expected);
      }
    });
  }

  it("reads a large model with pieces cut anywhere", () => {
    const xml = `<model><resources><object id="1">${mesh(42, 3000, 6000)}</object><object id="2">${mesh(43, 500, 800)}</object></resources><build><item objectid="1"/><item objectid="2"/></build></model>`;
    const expected = plain(parseModelXml(xml));
    expect(plain(streamed(xml, [4096]))).toEqual(expected);
    expect(plain(streamed(xml, [997, 13, 4099]))).toEqual(expected);
  });
});
