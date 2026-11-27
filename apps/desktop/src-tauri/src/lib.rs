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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![app_version, save_project_file, read_project_file, media_file_info])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar Social Video Editor");
}
