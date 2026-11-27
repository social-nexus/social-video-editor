//! Exportação: roda o ffmpeg do sistema (CPU, libx264), lê o progresso e permite cancelar.
//! A montagem do comando (filtros) é feita no frontend; aqui só executamos com segurança.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct RenderState {
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<Mutex<bool>>,
}

#[derive(serde::Serialize)]
pub struct FfmpegInfo {
    path: String,
    version: String,
    major: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    has_video: bool,
    has_audio: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
    ffmpeg: String,
    inputs: Vec<String>,
    filter: String,
    output_args: Vec<String>,
    output: String,
    /// Arquivos de mídia usados (para nunca sobrescrever um original).
    sources: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
struct RenderDone {
    ok: bool,
    cancelled: bool,
    error: Option<String>,
}

fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn program_or_default(path: Option<String>) -> String {
    path.filter(|p| !p.trim().is_empty()).unwrap_or_else(|| "ffmpeg".into())
}

/// ffprobe ao lado do ffmpeg escolhido (ou do PATH).
fn ffprobe_for(ffmpeg: &str) -> String {
    let path = Path::new(ffmpeg);
    if path.parent().map(|p| p.as_os_str().is_empty()).unwrap_or(true) {
        return "ffprobe".into();
    }
    let name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    path.with_file_name(name).to_string_lossy().into_owned()
}

/// "ffmpeg version 9.0.2-..." → 9; "n7.1" → 7; "N-1234-g..." (compilação git) → recente.
fn parse_major(version_line: &str) -> u32 {
    let token = version_line.split_whitespace().nth(2).unwrap_or("");
    let digits: String = token.trim_start_matches('n').chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().unwrap_or(if token.starts_with('N') { 99 } else { 0 })
}

/// Encontra o ffmpeg (caminho escolhido ou PATH) e diz a versão.
#[tauri::command]
pub fn ffmpeg_info(path: Option<String>) -> Result<FfmpegInfo, String> {
    let program = program_or_default(path);
    let output = command(&program).args(["-hide_banner", "-version"]).output()
        .map_err(|_| "ffmpeg não encontrado. Instale o FFmpeg ou escolha o ffmpeg.exe.".to_string())?;
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next().unwrap_or("").to_string();
    if !first.starts_with("ffmpeg version") {
        return Err("O arquivo escolhido não parece ser o ffmpeg.".into());
    }
    let encoders = command(&program).args(["-hide_banner", "-encoders"]).output()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned()).unwrap_or_default();
    if !encoders.contains("libx264") {
        return Err("Este ffmpeg não tem o codificador libx264 (H.264). Use uma versão \"full\" ou \"essentials\".".into());
    }
    Ok(FfmpegInfo { path: program, major: parse_major(&first), version: first })
}

/// Diz se cada arquivo tem imagem e/ou som (o filtro precisa saber antes de usar [n:a]).
#[tauri::command]
pub fn probe_media(ffmpeg: String, paths: Vec<String>) -> Vec<ProbeInfo> {
    let ffprobe = ffprobe_for(&ffmpeg);
    paths.iter().map(|path| {
        let output = command(&ffprobe)
            .args(["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path])
            .output();
        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                ProbeInfo {
                    has_video: text.lines().any(|l| l.trim() == "video"),
                    has_audio: text.lines().any(|l| l.trim() == "audio"),
                }
            }
            // Sem ffprobe: supõe que há imagem e som (o ffmpeg avisa se não houver).
            Err(_) => ProbeInfo { has_video: true, has_audio: true },
        }
    }).collect()
}

fn same_file(a: &str, b: &str) -> bool {
    let canon = |p: &str| std::fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p));
    canon(a).to_string_lossy().to_lowercase() == canon(b).to_string_lossy().to_lowercase()
}

/// Começa a exportação. Emite "render-progress" (segundos já gravados) e, no fim, "render-done".
#[tauri::command]
pub fn start_render(app: tauri::AppHandle, state: State<RenderState>, job: RenderJob) -> Result<(), String> {
    if state.child.lock().unwrap().is_some() {
        return Err("Já existe uma exportação em andamento.".into());
    }
    if job.sources.iter().any(|source| same_file(source, &job.output)) {
        return Err("O arquivo de saída não pode ser uma das mídias do projeto.".into());
    }
    let info = ffmpeg_info(Some(job.ffmpeg.clone()))?;

    // O grafo de filtros vai num arquivo temporário (a linha de comando do Windows tem limite de tamanho).
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let filter_path = std::env::temp_dir().join(format!("sve-filter-{}-{stamp}.txt", std::process::id()));
    std::fs::write(&filter_path, &job.filter).map_err(|e| format!("Não foi possível preparar a exportação: {e}"))?;
    let filter_arg = filter_path.to_string_lossy().into_owned();

    let mut cmd = command(&info.path);
    cmd.args(["-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-nostats"]);
    cmd.args(&job.inputs);
    if info.major >= 7 {
        cmd.args(["-/filter_complex", &filter_arg]);
    } else {
        cmd.args(["-filter_complex_script", &filter_arg]);
    }
    cmd.args(&job.output_args).arg(&job.output);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("Não foi possível iniciar o ffmpeg: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    *state.child.lock().unwrap() = Some(child);
    *state.cancelled.lock().unwrap() = false;

    // Guarda as últimas linhas do ffmpeg para mostrar se falhar.
    let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let tail_writer = tail.clone();
    let stderr_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut lines = tail_writer.lock().unwrap();
            lines.push_back(line);
            if lines.len() > 30 { lines.pop_front(); }
        }
    });

    let child_slot = state.child.clone();
    let cancelled = state.cancelled.clone();
    let output = job.output.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = value.trim().parse::<i64>() {
                    let _ = app.emit("render-progress", (us.max(0) as f64) / 1_000_000.0);
                }
            }
        }
        let _ = stderr_thread.join();
        // Espera o processo sem segurar a trava (o cancelar precisa dela para matar o ffmpeg).
        let status = loop {
            let mut slot = child_slot.lock().unwrap();
            match slot.as_mut().map(|child| child.try_wait()) {
                Some(Ok(Some(status))) => { slot.take(); break Some(status); }
                Some(Ok(None)) => { drop(slot); std::thread::sleep(std::time::Duration::from_millis(50)); }
                _ => { slot.take(); break None; }
            }
        };
        let _ = std::fs::remove_file(&filter_path);
        let was_cancelled = *cancelled.lock().unwrap();
        let ok = !was_cancelled && status.map(|s| s.success()).unwrap_or(false);
        if !ok { let _ = std::fs::remove_file(&output); }
        let error = if ok || was_cancelled { None } else {
            let lines = tail.lock().unwrap();
            let start = lines.len().saturating_sub(8);
            Some(lines.iter().skip(start).cloned().collect::<Vec<_>>().join("\n"))
        };
        let _ = app.emit("render-done", RenderDone { ok, cancelled: was_cancelled, error });
    });
    Ok(())
}

/// Cancela a exportação em andamento (o arquivo incompleto é apagado).
#[tauri::command]
pub fn cancel_render(state: State<RenderState>) {
    *state.cancelled.lock().unwrap() = true;
    if let Some(child) = state.child.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
}
