use std::fs;
use std::path::Path;
use tauri::Manager;

#[derive(serde::Serialize)]
struct MediaFileInfo {
    exists: bool,
    size: u64,
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn save_project_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents)
        .map_err(|error| format!("Não foi possível salvar o projeto: {error}"))
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|error| format!("Não foi possível abrir o projeto: {error}"))
}

/// Verifica os arquivos de mídia e libera cada arquivo existente no asset protocol,
/// para que o preview funcione em qualquer drive (ex.: D:\), e não só nas pastas
/// fixas do tauri.conf.json. Só libera arquivos individuais, nunca pastas inteiras.
#[tauri::command]
fn media_file_info(app: tauri::AppHandle, paths: Vec<String>) -> Vec<MediaFileInfo> {
    let scope = app.asset_protocol_scope();
    paths.iter().map(|path| {
        match fs::metadata(Path::new(path)) {
            Ok(metadata) if metadata.is_file() => {
                let _ = scope.allow_file(path);
                MediaFileInfo { exists: true, size: metadata.len() }
            }
            _ => MediaFileInfo { exists: false, size: 0 },
        }
    }).collect()
}

/// Lê um arquivo de texto (ex.: legenda). Se não for UTF-8, lê como Latin-1/Windows-1252.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|error| format!("Não foi possível ler o arquivo: {error}"))?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(text),
        Err(error) => Ok(error.into_bytes().iter().map(|&byte| byte as char).collect()),
    }
}

/// Grava um arquivo de texto (ex.: legenda exportada), sempre em UTF-8.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|error| format!("Não foi possível gravar o arquivo: {error}"))
}

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "m4v",
    "jpg", "jpeg", "png", "webp", "gif", "bmp",
    "mp3", "wav", "m4a", "aac", "flac", "ogg",
];

/// Lista os arquivos de mídia de uma pasta (sem entrar em subpastas), em ordem de nome.
#[tauri::command]
fn list_media_files(folder: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&folder)
        .map_err(|error| format!("Não foi possível ler a pasta: {error}"))?;
    let mut files: Vec<String> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| MEDIA_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    files.sort_by_key(|path| path.to_lowercase());
    Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![app_version, save_project_file, read_project_file, media_file_info, list_media_files, read_text_file, write_text_file])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar Social Video Editor");
}
