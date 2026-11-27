import { describe, expect, it } from "vitest";
import { parseTimestamp, planAssembly, type AssemblyItem } from "./autoassemble";

describe("parseTimestamp", () => {
  it("formatos da pasta de testes", () => {
    expect(parseTimestamp("0-05.png")).toBe(5);
    expect(parseTimestamp("0-13.png")).toBe(13);
    expect(parseTimestamp("0-04.300.mp4")).toBe(4.3);
    expect(parseTimestamp("0-25.800.mp4")).toBe(25.8);
  });
  it("formato do dossiê com horas e milissegundos", () => {
    expect(parseTimestamp("00-00-05-500.jpg")).toBe(5.5);
    expect(parseTimestamp("00-00-18-750.jpg")).toBe(18.75);
    expect(parseTimestamp("00-01-00-000.jpg")).toBe(60);
  });
  it("horas-minutos-segundos e minutos acima de 59 no formato curto", () => {
    expect(parseTimestamp("01-02-03.jpg")).toBe(3723);
    expect(parseTimestamp("75-00.png")).toBe(4500);
  });
  it("aceita texto depois do tempo e outros separadores", () => {
    expect(parseTimestamp("0-05 cena da cozinha.png")).toBe(5);
    expect(parseTimestamp("00_00_12_000.jpg")).toBe(12);
  });
  it("rejeita nomes inválidos", () => {
    expect(parseTimestamp("O-Paliteiro-Ep001.mp3")).toBeNull();
    expect(parseTimestamp("foto.jpg")).toBeNull();
    expect(parseTimestamp("0-75.png")).toBeNull();
    expect(parseTimestamp("00-61-00-000.jpg")).toBeNull();
    expect(parseTimestamp("2024.jpg")).toBeNull();
  });
});

// Vídeos reais da pasta de testes: 4,458 s cada, a cada 4,3 s; narração de 35,016 s.
const videoNames = ["0-00.000.mp4", "0-04.300.mp4", "0-08.600.mp4", "0-12.900.mp4", "0-17.200.mp4", "0-21.500.mp4", "0-25.800.mp4"];
const videos: AssemblyItem[] = videoNames.map((name) => ({ id: name, name, kind: "video", duration: 4.458 }));
const images: AssemblyItem[] = ["0-00.png", "0-02.png", "0-05.png", "0-06.png", "0-08.png", "0-11.png", "0-13.png"]
  .map((name) => ({ id: name, name, kind: "image", duration: null }));

describe("planAssembly", () => {
  it("vídeos: cada um até o próximo, cortando a sobra de 0,158 s", () => {
    const plan = planAssembly(videos, { narrationDuration: 35.016, lastImageDuration: 5 });
    expect(plan.clips.map((clip) => [clip.start, clip.duration])).toEqual([
      [0, 4.3], [4.3, 4.3], [8.6, 4.3], [12.9, 4.3], [17.2, 4.3], [21.5, 4.3], [25.8, 9.216],
    ]);
    // O último vídeo (4,458 s) é esticado até o fim da narração (35,016 s): 9,216 s em 48,4% da velocidade.
    expect(plan.clips.slice(-1)[0].speed).toBeCloseTo(0.484, 3);
    expect(plan.clips.slice(0, -1).every((clip) => clip.speed === undefined)).toBe(true);
    expect(plan.end).toBe(35.016);
  });
  it("sem esticar, o último vídeo deixa um vazio com aviso", () => {
    const plan = planAssembly(videos, { narrationDuration: 35.016, lastImageDuration: 5, stretchLastVideo: false });
    expect(plan.clips.slice(-1)[0]).toMatchObject({ start: 25.8, duration: 4.458 });
    expect(plan.clips.slice(-1)[0].speed).toBeUndefined();
    expect(plan.issues.some((issue) => issue.message.includes("0-25.800.mp4") && issue.message.includes("4,758"))).toBe(true);
  });
  it("imagens: a última vai até o fim da narração", () => {
    const plan = planAssembly(images, { narrationDuration: 35.016, lastImageDuration: 5 });
    expect(plan.clips.map((clip) => [clip.start, clip.duration])).toEqual([
      [0, 2], [2, 3], [5, 1], [6, 2], [8, 3], [11, 2], [13, 22.016],
    ]);
    expect(plan.end).toBe(35.016);
  });
  it("sem narração, a última imagem usa a duração padrão", () => {
    expect(planAssembly(images, { narrationDuration: null, lastImageDuration: 4 }).clips.slice(-1)[0]).toMatchObject({ start: 13, duration: 4 });
  });
  it("mesmo tempo: fica o vídeo, a imagem é pulada", () => {
    const plan = planAssembly([...images, ...videos], { narrationDuration: 35.016, lastImageDuration: 5 });
    expect(plan.clips.find((clip) => clip.start === 0)?.name).toBe("0-00.000.mp4");
    expect(plan.skipped.find((item) => item.name === "0-00.png")?.reason).toContain("Mesmo tempo");
  });
  it("pula arquivos sem timestamp, duplicados e depois do fim da narração", () => {
    const plan = planAssembly([
      ...images.slice(0, 2),
      { id: "dup", name: "0-02.PNG", kind: "image", duration: null },
      { id: "x", name: "capa.png", kind: "image", duration: null },
      { id: "late", name: "0-40.png", kind: "image", duration: null },
    ], { narrationDuration: 35.016, lastImageDuration: 5 });
    expect(plan.skipped.map((item) => item.reason.split(" ")[0])).toEqual(["Sem", "Arquivo", "Começa"]);
    expect(plan.clips.map((clip) => clip.name)).toEqual(["0-00.png", "0-02.png"]);
  });
  it("avisa quando o início fica sem imagem", () => {
    const plan = planAssembly(images.slice(2), { narrationDuration: 35.016, lastImageDuration: 5 });
    expect(plan.issues[0].message).toContain("começa em 0:05");
  });
});
