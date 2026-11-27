import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "../types";
import { loadWaveform, type Waveform } from "../lib/waveform";

/** Canvas mais largo que isso é esticado via CSS (limite de memória do navegador). */
const MAX_CANVAS_PX = 4096;

type Props = {
  item: MediaItem;
  /** Trecho da mídia mostrado: do ponto de entrada até entrada + duração × velocidade. */
  inPoint: number;
  sourceSpan: number;
  width: number;
  height: number;
};

/** Forma de onda desenhada dentro de um clipe da timeline. */
export default function ClipWaveform({ item, inPoint, sourceSpan, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveform, setWaveform] = useState<Waveform | null>(null);

  useEffect(() => {
    let alive = true;
    setWaveform(null);
    loadWaveform(item).then((result) => { if (alive) setWaveform(result); });
    return () => { alive = false; };
  }, [item.id, item.url]);

  const pixels = Math.max(1, Math.min(MAX_CANVAS_PX, Math.round(width)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    canvas.width = pixels;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, pixels, height);
    context.fillStyle = "rgba(255, 255, 255, 0.55)";
    const { peaks, perSecond } = waveform;
    const middle = height / 2;
    for (let x = 0; x < pixels; x++) {
      // Maior pico dentro da coluna (não perde transientes quando o zoom está afastado).
      const from = Math.floor((inPoint + (x / pixels) * sourceSpan) * perSecond);
      const to = Math.max(from + 1, Math.floor((inPoint + ((x + 1) / pixels) * sourceSpan) * perSecond));
      let peak = 0;
      for (let index = from; index < to && index < peaks.length; index++) if (peaks[index] > peak) peak = peaks[index];
      const bar = Math.max(0.5, peak * (middle - 1));
      context.fillRect(x, middle - bar, 1, bar * 2);
    }
  }, [waveform, pixels, height, inPoint, sourceSpan]);

  if (!waveform) return null;
  return <canvas ref={canvasRef} className="clip-wave" style={{ width, height }} aria-hidden />;
}
