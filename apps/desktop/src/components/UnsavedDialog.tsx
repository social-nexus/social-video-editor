import { useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

type Props = {
  projectName: string;
  /** O que acontece depois (ex.: "voltar à tela inicial", "fechar o editor"). */
  action: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/** Pergunta antes de perder alterações: Salvar / Não salvar / Cancelar. */
export default function UnsavedDialog({ projectName, action, saving, onSave, onDiscard, onCancel }: Props) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onCancel, saving]);

  return <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <div className="modal unsaved-modal" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
      <div className="unsaved-body">
        <AlertTriangle size={22} />
        <div>
          <h2 id="unsaved-title">Salvar as alterações em “{projectName}”?</h2>
          <p>Se não salvar, o que você mudou desde o último salvamento será perdido ao {action}.</p>
        </div>
      </div>
      <div className="modal-foot">
        <button className="button secondary" disabled={saving} onClick={onCancel}>Cancelar</button>
        <div>
          <button className="button secondary" disabled={saving} onClick={onDiscard}>Não salvar</button>
          <button className="button primary" disabled={saving} onClick={onSave} autoFocus>
            {saving ? <><Loader2 size={15} className="spin" /> Salvando…</> : "Salvar"}</button>
        </div>
      </div>
    </div>
  </div>;
}
