import type * as THREE from "three";

/**
 * The views' colour buffers hold the file's own sRGB bytes, RGBA (engine/mesh.ts ColourBuffer): the shader makes
 * them linear for lighting, as the float buffers were before (11-05: a third of the memory, the same colours on
 * screen).  `gyuLinear` is the sRGB curve; alpha 0 marks a face drawn nowhere.
 */
export const SRGB_LINEAR_GLSL = `
vec3 gyuLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}`;

/** Patches a three shader (onBeforeCompile) so its vertex colours are read as sRGB bytes. */
export function srgbVertexColours(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${SRGB_LINEAR_GLSL}`)
    .replace(
      "#include <color_vertex>",
      `#include <color_vertex>
#if defined( USE_COLOR_ALPHA )
  vColor.rgb = gyuLinear(vColor.rgb);
#elif defined( USE_COLOR )
  vColor = gyuLinear(vColor);
#endif`,
    );
}

/** A material that draws colour buffers (sRGB bytes): its own onBeforeCompile chained after the conversion. */
export function withSrgbColours<T extends THREE.Material>(material: T): T {
  const own = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    srgbVertexColours(shader);
    own.call(material, shader, renderer);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `srgb|${key.call(material)}`;
  return material;
}
