use serde::{Deserialize, Serialize};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

pub fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub async fn check_update(app: &tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = get_current_version();
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckResult {
            available: true,
            current_version,
            latest_version: update.version,
            body: update.body,
            date: update.date.map(|d| d.to_string()),
        }),
        Ok(None) => Ok(UpdateCheckResult {
            available: false,
            current_version: current_version.clone(),
            latest_version: current_version,
            body: None,
            date: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

pub async fn install_latest_update(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Brak dostępnych aktualizacji do zainstalowania".to_string())?;

    let app_handle = app.clone();
    let mut downloaded: u64 = 0;

    let app_handle_finish = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = app_handle.emit(
                    "update-download-progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": total
                    }),
                );
            },
            move || {
                let _ = app_handle_finish.emit("update-installing", ());
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}