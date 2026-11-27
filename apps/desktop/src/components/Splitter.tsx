import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  /** "vertical" = barra em pé (muda larguras); "horizontal" = barra deitada (muda alturas). */
  orientation: "vertical" | "horizontal";
  label: string;
  /** Deslocamento total desde o início do arraste, em px. */
  onDrag: (delta: number) => void;
  onEnd: () => void;
  /** Duplo clique: volta ao tamanho padrão. */
  onReset: () => void;
};

/** Divisória arrastável entre dois painéis. */
export default function Splitter({ orientation, label, onDrag, onEnd, onReset }: Props) {
  const start = useRef<number | null>(null);
  const position = (event: ReactPointerEvent) => orientation === "vertical" ? event.clientX : event.clientY;

  return <div className={`splitter ${orientation}`} role="separator" aria-orientation={orientation} aria-label={label}
    title={`${label} — arraste para mudar o tamanho; duplo clique volta ao padrão`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      start.current = position(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add(orientation === "vertical" ? "resizing-x" : "resizing-y");
      event.preventDefault();
    }}
    onPointerMove={(event) => { if (start.current !== null) onDrag(position(event) - start.current); }}
    onPointerUp={(event) => {
      if (start.current === null) return;
      start.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      document.body.classList.remove("resizing-x", "resizing-y");
      onEnd();
    }}
    onPointerCancel={() => { start.current = null; document.body.classList.remove("resizing-x", "resizing-y"); onEnd(); }}
    onDoubleClick={onReset} />;
}
