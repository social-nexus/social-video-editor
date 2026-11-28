import { describe, expect, it } from "vitest";
import { applyColor, cleanColor, colorFilters, colorMatrix, COLOR_PRESETS, isNeutralColor, matchingColorPreset, NEUTRAL_COLOR, svgMatrixValues, validColor } from "./color";

describe("correção de cor", () => {
  it("neutro não muda nada", () => {
    expect(colorMatrix(NEUTRAL_COLOR)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(applyColor(NEUTRAL_COLOR, [0.2, 0.5, 0.9])).toEqual([0.2, 0.5, 0.9]);
    expect(isNeutralColor(undefined)).toBe(true);
  });
  it("P&B deixa os três canais iguais", () => {
    const [r, g, b] = applyColor(COLOR_PRESETS[0].color, [0.8, 0.2, 0.4]);
    expect(r).toBeCloseTo(g, 3);
    expect(g).toBeCloseTo(b, 3);
  });
  it("contraste e brilho", () => {
    expect(applyColor({ ...NEUTRAL_COLOR, contrast: 0.5 }, [0.75, 0.5, 0.25])).toEqual([0.875, 0.5, 0.125]);
    expect(applyColor({ ...NEUTRAL_COLOR, brightness: 0.2 }, [0.5, 0.5, 0.5]).map((v) => Math.round(v * 1000) / 1000)).toEqual([0.6, 0.6, 0.6]);
  });
  it("quente puxa para o vermelho, frio para o azul", () => {
    const [wr, , wb] = applyColor({ ...NEUTRAL_COLOR, temperature: 1 }, [0.5, 0.5, 0.5]);
    expect(wr).toBeGreaterThan(wb);
    const [cr, , cb] = applyColor({ ...NEUTRAL_COLOR, temperature: -1 }, [0.5, 0.5, 0.5]);
    expect(cb).toBeGreaterThan(cr);
  });
  it("limites, arquivo e filtro pronto", () => {
    expect(cleanColor({ brightness: 9, saturation: -9, sepia: -1 })).toEqual({ ...NEUTRAL_COLOR, brightness: 0.5, saturation: -1 });
    expect(validColor({ brightness: 0, contrast: 0 })).toBeNull();
    expect(validColor({ contrast: 0.3 })).toEqual({ ...NEUTRAL_COLOR, contrast: 0.3 });
    expect(matchingColorPreset(COLOR_PRESETS[2].color)).toBe("vivid");
    expect(matchingColorPreset({ ...NEUTRAL_COLOR, contrast: 0.01 })).toBe("");
  });
  it("preview (SVG) e exportação (ffmpeg) usam os mesmos números", () => {
    const color = { ...NEUTRAL_COLOR, contrast: 0.2, saturation: 0.3, temperature: -0.4 };
    const m = colorMatrix(color);
    expect(svgMatrixValues(color).split(" ").map(Number).slice(0, 3)).toEqual(m.slice(0, 3));
    const filters = colorFilters(color);
    expect(filters[0]).toBe("format=rgba");
    expect(filters[1]).toBe("lutrgb=r='val*1.2+-25.5':g='val*1.2+-25.5':b='val*1.2+-25.5'");
    expect(filters[2]).toBe(`colorchannelmixer=rr=${m[0]}:rg=${m[1]}:rb=${m[2]}:gr=${m[3]}:gg=${m[4]}:gb=${m[5]}:br=${m[6]}:bg=${m[7]}:bb=${m[8]}`);
  });
});
