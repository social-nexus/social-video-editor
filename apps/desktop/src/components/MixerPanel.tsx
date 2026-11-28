import { Mic, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import type { Track, TrackDucking } from "../types";
import { DEFAULT_DUCKING, dbToGain, gainToDb, trackAudible, trackVolume } from "../lib/audio";
import { trackLabel } from "../lib/tracks";

type Props = {
  tracks: Track[];
  onSetVolume: (trackId: string, volume: number) => void;
  onToggle: (trackId: string, flag: "muted" | "solo") => void;
  onSetDucking: (trackId: string, ducking: TrackDucking | null) => void;
};

/** Mixer: volume, mudo e solo de cada trilha, e a trilha de voz que abaixa as outras. */
export default function MixerPanel({ tracks, onSetVolume, onToggle, onSetDucking }: Props) {
  const anySolo = tracks.some((track) => track.solo);
  // Vídeos também têm som; mostra as trilhas de áudio primeiro (narração e música).
  const ordered = [...tracks.filter((track) => track.kind === "audio"), ...tracks.filter((track) => track.kind === "video")];
  return <div className="tools-card mixer-card">
    <div className="tools-title"><SlidersHorizontal size={15} /> Mixagem</div>
    {ordered.map((track) => {
      const audible = trackAudible(track, tracks);
      const ducking = track.ducking;
      return <div key={track.id} className={`mixer-row ${audible ? "" : "silent"}`}>
        <div className="mixer-head">
          <b>{trackLabel(track, tracks)}</b>
          <span className="mixer-kind">{track.kind === "audio" ? "áudio" : "som dos vídeos"}</span>
          {ducking && <span className="mixer-badge"><Mic size={10} /> voz</span>}
          <div className="mixer-buttons">
            <button className={`mixer-btn ${track.muted ? "on mute" : ""}`} title={track.muted ? "Tirar o mudo" : "Silenciar esta trilha"} aria-pressed={Boolean(track.muted)}
              onClick={() => onToggle(track.id, "muted")}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
            <button className={`mixer-btn ${track.solo ? "on solo" : ""}`} title={track.solo ? "Tirar o solo" : "Solo: ouvir só as trilhas em solo"} aria-pressed={Boolean(track.solo)}
              onClick={() => onToggle(track.id, "solo")}>S</button>
            <button className={`mixer-btn ${ducking ? "on voice" : ""}`} aria-pressed={Boolean(ducking)}
              title={ducking ? "Deixar de ser a trilha de voz" : "Trilha de voz: enquanto ela fala, as outras abaixam sozinhas"}
              onClick={() => onSetDucking(track.id, ducking ? null : DEFAULT_DUCKING)}><Mic size={12} /></button>
          </div>
        </div>
        <label className="caption-setting mixer-volume"><span>Volume</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(trackVolume(track) * 100)} aria-label={`Volume da trilha ${trackLabel(track, tracks)}`}
            onChange={(event) => onSetVolume(track.id, Number(event.target.value) / 100)} onDoubleClick={() => onSetVolume(track.id, 1)} title="Duplo clique volta a 100%" />
          <b>{Math.round(trackVolume(track) * 100)}%</b></label>
        {ducking && <>
          <label className="caption-setting"><span>Abaixar outras</span>
            <input type="range" min={-30} max={-3} step={1} value={gainToDb(ducking.amount)} aria-label="Quanto as outras trilhas abaixam"
              onChange={(event) => onSetDucking(track.id, { ...ducking, amount: dbToGain(Number(event.target.value)) })} />
            <b>{gainToDb(ducking.amount)} dB</b></label>
          <label className="caption-setting"><span>Suavidade</span>
            <input type="range" min={0.1} max={1} step={0.05} value={ducking.fade} aria-label="Tempo para abaixar e voltar"
              onChange={(event) => onSetDucking(track.id, { ...ducking, fade: Number(event.target.value) })} />
            <b>{ducking.fade.toFixed(2).replace(".", ",")} s</b></label>
        </>}
      </div>;
    })}
    <p className="captions-hint">
      {anySolo ? "Solo ligado: só as trilhas em solo tocam. " : ""}
      Marque a trilha da narração como <b>voz</b> (microfone): enquanto ela fala, a música e o som dos vídeos abaixam sozinhos — no preview e na exportação.
    </p>
  </div>;
}
