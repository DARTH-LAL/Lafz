use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateStatus {
    pub configured: bool,
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub published_at: Option<String>,
    pub release_notes: Option<String>,
    pub message: Option<String>,
}

fn version_string<R: Runtime>(app: &AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

pub fn is_updater_configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(config) = app.config().plugins.0.get("updater") else {
        return false;
    };

    let Some(config) = config.as_object() else {
        return false;
    };

    let endpoints_ok = config
        .get("endpoints")
        .and_then(|value| value.as_array())
        .map(|value| !value.is_empty())
        .unwrap_or(false);

    let pubkey_ok = config
        .get("pubkey")
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    endpoints_ok && pubkey_ok
}

fn no_update_status<R: Runtime>(
    app: &AppHandle<R>,
    configured: bool,
    message: &str,
) -> DesktopUpdateStatus {
    DesktopUpdateStatus {
        configured,
        available: false,
        current_version: version_string(app),
        latest_version: None,
        published_at: None,
        release_notes: None,
        message: Some(message.to_string()),
    }
}

#[tauri::command]
pub async fn desktop_check_update<R: Runtime>(
    app: AppHandle<R>,
) -> Result<DesktopUpdateStatus, String> {
    if !is_updater_configured(&app) {
        return Ok(no_update_status(
            &app,
            false,
            "Auto-update is not configured yet.",
        ));
    }

    let updater = app
        .updater()
        .map_err(|error| format!("Unable to initialize the updater: {error}"))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(DesktopUpdateStatus {
            configured: true,
            available: true,
            current_version: update.current_version.clone(),
            latest_version: Some(update.version.clone()),
            published_at: update.date.map(|date| date.to_string()),
            release_notes: update.body.clone(),
            message: Some(format!("Lafz {} is ready to install.", update.version)),
        }),
        Ok(None) => Ok(no_update_status(&app, true, "Lafz is up to date.")),
        Err(error) => Ok(no_update_status(
            &app,
            true,
            &format!("Unable to check for updates: {error}"),
        )),
    }
}

#[tauri::command]
pub async fn desktop_install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if !is_updater_configured(&app) {
        return Err("Auto-update is not configured yet.".to_string());
    }

    let updater = app
        .updater()
        .map_err(|error| format!("Unable to initialize the updater: {error}"))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("Unable to check for updates: {error}"))?
    else {
        return Err("No update is available yet.".to_string());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Unable to install update: {error}"))?;

    app.restart();
}
