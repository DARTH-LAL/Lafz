use std::thread;
use tauri::webview::WebviewWindowBuilder;
use tauri::WebviewUrl;
use tauri_plugin_updater::Builder as UpdaterPluginBuilder;

mod desktop_media;
mod desktop_update;
#[cfg(target_os = "windows")]
mod windows_media;

#[cfg(debug_assertions)]
use std::net::TcpStream;
#[cfg(debug_assertions)]
use std::process::{Command, Stdio};
#[cfg(debug_assertions)]
use std::time::{Duration, Instant};

#[cfg(debug_assertions)]
const DEFAULT_DESKTOP_URL: &str = "index.html";
#[cfg(debug_assertions)]
const DEV_SERVER_PORT: u16 = 3001;

#[cfg(debug_assertions)]
fn resolve_desktop_url() -> WebviewUrl {
    let raw = option_env!("LAFZ_DESKTOP_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|| DEFAULT_DESKTOP_URL.to_string());

    match url::Url::parse(&raw) {
        Ok(url) => WebviewUrl::External(url),
        Err(_) => WebviewUrl::App("index.html".into()),
    }
}

#[cfg(not(debug_assertions))]
fn resolve_desktop_url() -> WebviewUrl {
    WebviewUrl::App("index.html".into())
}

#[cfg(debug_assertions)]
fn is_port_open(port: u16) -> bool {
    TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok()
}

#[cfg(debug_assertions)]
fn wait_for_port(port: u16, timeout_secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if is_port_open(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

#[cfg(debug_assertions)]
fn ensure_dev_server() {
    if is_port_open(DEV_SERVER_PORT) {
        return;
    }

    let project_dir = match option_env!("LAFZ_PROJECT_DIR") {
        Some(dir) if !dir.is_empty() => dir,
        _ => return,
    };

    // Use a login bash shell so ~/.zprofile / ~/.bash_profile are sourced,
    // giving us Homebrew, nvm, etc. in PATH — exactly like opening a terminal.
    let cmd = format!("cd '{}' && npm run dev:desktop", project_dir);

    let _ = Command::new("/bin/bash")
        .args(["-l", "-c", &cmd])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    wait_for_port(DEV_SERVER_PORT, 90);
}

#[cfg(not(debug_assertions))]
fn ensure_dev_server() {}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_update::desktop_check_update,
            desktop_update::desktop_install_update,
            desktop_media::desktop_runtime_config,
            desktop_media::desktop_lookup_location,
            desktop_media::desktop_now_playing,
            desktop_media::desktop_control_playback
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            if desktop_update::is_updater_configured(&handle) {
                handle.plugin(UpdaterPluginBuilder::new().build())?;
            }

            thread::spawn(move || {
                ensure_dev_server();

                let url = resolve_desktop_url();
                let result = WebviewWindowBuilder::new(&handle, "main", url)
                    .title("Lafz")
                    .inner_size(1440.0, 960.0)
                    .min_inner_size(1200.0, 780.0)
                    .build();

                if let Ok(window) = result {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lafz desktop app");
}
