use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::desktop_update::is_updater_configured;

const PLAYER_APPS: [&str; 2] = ["Spotify", "Music"];
const BROWSER_APPS: [&str; 5] = [
    "Safari",
    "Google Chrome",
    "Microsoft Edge",
    "Brave Browser",
    "Arc",
];
const FIELD_DELIMITER: char = '\u{1F}';
const RECORD_DELIMITER: char = '\u{1E}';

fn normalize_base_url(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');

    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}

fn read_optional_supabase_url() -> Option<String> {
    option_env!("SUPABASE_URL")
        .and_then(normalize_base_url)
        .or_else(|| {
            std::env::var("SUPABASE_URL")
                .ok()
                .and_then(|value| normalize_base_url(&value))
        })
}

fn read_optional_supabase_anon_key() -> Option<String> {
    option_env!("SUPABASE_ANON_KEY")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var("SUPABASE_ANON_KEY")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn normalize_spotify_track_id(raw_value: &str) -> String {
    let trimmed = raw_value.trim();

    if let Some(track_id) = trimmed.strip_prefix("spotify:track:") {
        return track_id
            .split('?')
            .next()
            .unwrap_or(track_id)
            .trim()
            .to_string();
    }

    if let Some(track_id) = trimmed.strip_prefix("spotify:") {
        return track_id
            .split('?')
            .next()
            .unwrap_or(track_id)
            .trim()
            .to_string();
    }

    if let Some(track_id) = trimmed
        .strip_prefix("https://open.spotify.com/track/")
        .or_else(|| trimmed.strip_prefix("http://open.spotify.com/track/"))
    {
        return track_id
            .split('?')
            .next()
            .map(|value| value.trim().to_string())
            .unwrap_or_else(|| trimmed.to_string());
    }

    trimmed.to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPlaybackState {
    pub status: String,
    pub is_playing: bool,
    pub shuffle_enabled: bool,
    pub repeat_mode: String,
    pub progress_ms: u64,
    pub fetched_at: String,
    pub device_name: Option<String>,
    pub playback_state_label: String,
    pub track: Option<DesktopTrack>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTrack {
    pub spotify_track_id: String,
    pub title: String,
    pub artist: String,
    pub artist_names: Vec<String>,
    pub album: String,
    pub album_art_url: Option<String>,
    pub duration_ms: u64,
    pub external_url: Option<String>,
    pub browser_source_kind: Option<String>,
    pub browser_source_host: Option<String>,
    pub browser_source_confidence: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeConfig {
    pub api_base_url: String,
    pub supabase_url: Option<String>,
    pub supabase_anon_key: Option<String>,
    pub app_version: String,
    pub updater_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopGeoLocation {
    pub country: Option<String>,
    pub city: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum DesktopPlaybackCommand {
    Toggle,
    Play,
    Pause,
    Next,
    Previous,
    Seek { position_ms: f64 },
}

#[tauri::command]
pub fn desktop_runtime_config<R: Runtime>(app: AppHandle<R>) -> DesktopRuntimeConfig {
    let api_base_url = option_env!("LAFZ_DESKTOP_API_BASE_URL")
        .or_else(|| option_env!("LAFZ_API_BASE_URL"))
        .and_then(normalize_base_url)
        .or_else(|| {
            std::env::var("LAFZ_DESKTOP_API_BASE_URL")
                .ok()
                .and_then(|value| normalize_base_url(&value))
        })
        .or_else(|| {
            std::env::var("LAFZ_API_BASE_URL")
                .ok()
                .and_then(|value| normalize_base_url(&value))
        })
        .or_else(|| {
            std::env::var("LAFZ_APP_URL")
                .ok()
                .and_then(|value| normalize_base_url(&value))
        })
        .unwrap_or_else(|| "http://127.0.0.1:3000".to_string());

    DesktopRuntimeConfig {
        api_base_url,
        supabase_url: read_optional_supabase_url(),
        supabase_anon_key: read_optional_supabase_anon_key(),
        app_version: app.package_info().version.to_string(),
        updater_configured: is_updater_configured(&app),
    }
}

#[tauri::command]
pub async fn desktop_lookup_location() -> Result<DesktopGeoLocation, String> {
    let response = reqwest::get("https://ipwho.is/")
        .await
        .map_err(|error| format!("Unable to look up location: {error}"))?;

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Unable to decode location response: {error}"))?;

    let country = payload
        .get("country")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            payload
                .get("country_code")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        });

    let city = payload
        .get("city")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Ok(DesktopGeoLocation { country, city })
}

#[tauri::command]
pub async fn desktop_now_playing() -> Result<DesktopPlaybackState, String> {
    #[cfg(target_os = "windows")]
    {
        return crate::windows_media::desktop_now_playing_windows().await;
    }

    if let Some(state) = detect_now_playing_state()? {
        return Ok(state);
    }

    Ok(make_idle_state())
}

#[tauri::command]
pub async fn desktop_control_playback(command: DesktopPlaybackCommand) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return crate::windows_media::desktop_control_playback_windows(command).await;
    }

    let Some(app_name) = detect_active_player_app() else {
        return Err("No supported desktop media app is running.".to_string());
    };

    let script = build_control_script(app_name, command);
    run_osascript(&script).map(|_| ())
}

fn detect_active_player_app() -> Option<&'static str> {
    for app_name in PLAYER_APPS {
        if is_process_running(app_name) {
            return Some(app_name);
        }
    }

    None
}

fn is_browser_app(app_name: &str) -> bool {
    BROWSER_APPS.contains(&app_name)
}

fn is_process_running(process_name: &str) -> bool {
    Command::new("pgrep")
        .args(["-x", process_name])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn bundle_id_for_app_name(app_name: &str) -> Option<&'static str> {
    match app_name {
        "Spotify" => Some("com.spotify.client"),
        "Music" => Some("com.apple.Music"),
        _ => None,
    }
}

fn run_osascript(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|error| format!("Failed to launch osascript: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            "osascript returned a non-zero exit status.".to_string()
        } else {
            detail
        });
    }

    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|error| format!("Could not decode osascript output: {error}"))
}

fn build_snapshot_script(app_name: &str) -> String {
    let escaped_app_name = escape_applescript_string(app_name);
    let delimiter_code = FIELD_DELIMITER as u32;

    format!(
        r#"
on run
  set delimiter to character id {delimiter_code}
  tell application "{escaped_app_name}"
    if player state is stopped then return ""

    set stateText to player state as text
  set trackName to name of current track
  set artistName to artist of current track
  set albumName to album of current track
  set trackId to ""
  set artworkUrl to ""

  try
    set trackId to id of current track
  end try

  try
    set artworkUrl to artwork url of current track
  end try

  set durationValue to duration of current track
  set positionValue to player position

  return stateText & delimiter & trackId & delimiter & artworkUrl & delimiter & trackName & delimiter & artistName & delimiter & albumName & delimiter & durationValue & delimiter & positionValue
  end tell
end run
"#
    )
}

fn build_browser_snapshot_script(app_name: &str) -> String {
    let escaped_app_name = escape_applescript_string(app_name);
    let delimiter_code = FIELD_DELIMITER as u32;
    let record_delimiter_code = RECORD_DELIMITER as u32;

    match app_name {
        "Safari" => format!(
            r#"
on run
  set delimiter to character id {delimiter_code}
  set recordDelimiter to character id {record_delimiter_code}
  tell application "{escaped_app_name}"
    if not (exists front window) then return ""
    set frontWindow to front window
    set frontTab to current tab of frontWindow
    set resultText to (name of frontTab) & delimiter & (URL of frontTab)
    repeat with w in windows
      repeat with t in tabs of w
        try
          if t is not frontTab then
            set resultText to resultText & recordDelimiter & (name of t) & delimiter & (URL of t)
          end if
        end try
      end repeat
    end repeat
    return resultText
  end tell
end run
"#
        ),
        _ => format!(
            r#"
on run
  set delimiter to character id {delimiter_code}
  set recordDelimiter to character id {record_delimiter_code}
  tell application "{escaped_app_name}"
    if not (exists front window) then return ""
    set frontWindow to front window
    set frontTab to active tab of frontWindow
    set resultText to (title of frontTab) & delimiter & (URL of frontTab)
    repeat with w in windows
      repeat with t in tabs of w
        try
          if t is not frontTab then
            set resultText to resultText & recordDelimiter & (title of t) & delimiter & (URL of t)
          end if
        end try
      end repeat
    end repeat
    return resultText
  end tell
end run
"#
        ),
    }
}

fn detect_now_playing_state() -> Result<Option<DesktopPlaybackState>, String> {
    let mut paused_state: Option<DesktopPlaybackState> = None;

    for app_name in PLAYER_APPS.iter().chain(BROWSER_APPS.iter()) {
        if !is_process_running(app_name) {
            continue;
        }

        let script = if is_browser_app(app_name) {
            build_browser_snapshot_script(app_name)
        } else {
            build_snapshot_script(app_name)
        };

        let output = run_osascript(&script)?;
        let parsed = if is_browser_app(app_name) {
            parse_browser_snapshot_output(&output, app_name)?
        } else {
            parse_snapshot_output(&output, app_name)?
        };

        if parsed.track.is_none() {
            continue;
        }

        if parsed.is_playing {
            return Ok(Some(parsed));
        }

        if paused_state.is_none() {
            paused_state = Some(parsed);
        }
    }

    Ok(paused_state)
}

fn parse_snapshot_output(output: &str, app_name: &str) -> Result<DesktopPlaybackState, String> {
    let parts: Vec<&str> = output.split(FIELD_DELIMITER).collect();

    if parts.len() < 8 {
        return Ok(make_idle_state());
    }

    let status = parts[0].trim().to_string();
    let track_id = parts[1].trim().to_string();
    let artwork_url = parts[2].trim().to_string();
    let title = parts[3].trim().to_string();
    let artist = parts[4].trim().to_string();
    let album = parts[5].trim().to_string();
    let duration_value = parts[6].trim().parse::<f64>().unwrap_or(0.0);
    let position_value = parts[7].trim().parse::<f64>().unwrap_or(0.0);

    if title.is_empty() || artist.is_empty() {
        return Ok(make_idle_state());
    }

    let track_id = if track_id.is_empty() {
        format!(
            "desktop:{}:{}:{}",
            app_name.to_lowercase(),
            slugify(&artist),
            slugify(&title)
        )
    } else {
        normalize_spotify_track_id(&track_id)
    };

    Ok(DesktopPlaybackState {
        status: if status == "playing" {
            "playing".to_string()
        } else {
            "paused".to_string()
        },
        is_playing: status == "playing",
        shuffle_enabled: false,
        repeat_mode: "off".to_string(),
        progress_ms: normalize_progress_ms(app_name, position_value),
        fetched_at: now_timestamp_ms_string(),
        device_name: Some(app_name.to_string()),
        playback_state_label: if status == "playing" {
            "Playing".to_string()
        } else {
            "Paused".to_string()
        },
        track: Some(DesktopTrack {
            spotify_track_id: track_id,
            title,
            artist: artist.clone(),
            artist_names: vec![artist],
            album,
            album_art_url: if artwork_url.trim().is_empty() {
                null_option()
            } else {
                Some(artwork_url)
            },
            duration_ms: normalize_duration_ms(app_name, duration_value),
            external_url: None,
            browser_source_kind: None,
            browser_source_host: None,
            browser_source_confidence: None,
        }),
    })
}

fn parse_browser_snapshot_output(
    output: &str,
    app_name: &str,
) -> Result<DesktopPlaybackState, String> {
    let trimmed = output.trim();

    if trimmed.is_empty() {
        return Ok(make_idle_state());
    }

    let mut candidate_records: Vec<(String, String)> = Vec::new();

    for record in trimmed.split(RECORD_DELIMITER) {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        let parts: Vec<&str> = record.split(FIELD_DELIMITER).collect();
        if parts.len() < 2 {
            continue;
        }

        candidate_records.push((parts[0].trim().to_string(), parts[1].trim().to_string()));
    }

    if candidate_records.is_empty() {
        return Ok(make_idle_state());
    }

    for (raw_title, url) in candidate_records {
        let fallback_title = raw_title.clone();
        let cleaned_title = clean_browser_track_title(&fallback_title, &url);
        let (mut title, artist) = split_browser_track_metadata(&cleaned_title, &url);

        if title.is_empty() {
            title = if cleaned_title.is_empty() {
                fallback_title
            } else {
                cleaned_title
            };
        }

        if title.is_empty() {
            title = infer_browser_title_from_url(&url).unwrap_or_default();
        }

        if !is_supported_browser_media_page(&title, &url) {
            continue;
        }

        if title.is_empty() {
            continue;
        }

        let album = site_label_for_browser(app_name, Some(url.as_str()));
        let source = classify_browser_source(&url);
        let track_id = format!(
            "browser:{}:{}",
            app_name.to_lowercase().replace(' ', "-"),
            slugify(&format!("{} {}", artist, title))
        );

        return Ok(DesktopPlaybackState {
            status: "playing".to_string(),
            is_playing: true,
            shuffle_enabled: false,
            repeat_mode: "off".to_string(),
            progress_ms: 0,
            fetched_at: now_timestamp_ms_string(),
            device_name: Some(app_name.to_string()),
            playback_state_label: "Playing".to_string(),
            track: Some(DesktopTrack {
                spotify_track_id: track_id,
                title,
                artist: artist.clone(),
                artist_names: if artist.is_empty() {
                    Vec::new()
                } else {
                    vec![artist]
                },
                album,
                album_art_url: null_option(),
                duration_ms: 0,
                external_url: if url.is_empty() { None } else { Some(url) },
                browser_source_kind: Some(source.kind.to_string()),
                browser_source_host: source.host,
                browser_source_confidence: Some(source.confidence),
            }),
        });
    }

    Ok(make_idle_state())
}

fn clean_browser_track_title(value: &str, url: &str) -> String {
    let mut title = value.trim().to_string();
    let suffixes = [
        " - YouTube Music",
        " | YouTube Music",
        " • YouTube Music",
        " - Apple Music",
        " | Apple Music",
        " • Apple Music",
        " - YouTube",
        " | YouTube",
        " • YouTube",
        " - Google Search",
        " | Google Search",
    ];

    for suffix in suffixes {
        if title.ends_with(suffix) {
            title = title.trim_end_matches(suffix).trim().to_string();
            break;
        }
    }

    title = title.trim_start().to_string();
    if title.starts_with('(') {
        let after_open = title[1..].trim_start();
        let digit_prefix_length = after_open
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .count();

        if digit_prefix_length > 0 {
            let after_digits = &after_open[digit_prefix_length..];
            let trimmed = after_digits
                .trim_start_matches(|ch: char| ch == ')' || ch == '.' || ch.is_ascii_whitespace())
                .to_string();

            if !trimmed.is_empty() {
                title = trimmed;
            }
        }
    }

    title = title
        .replace("(Official Video)", "")
        .replace("(Official Music Video)", "")
        .replace("(Official Audio)", "")
        .replace("(Lyric Video)", "")
        .replace("(Lyrics)", "")
        .replace("(Visualizer)", "")
        .replace("[Official Video]", "")
        .replace("[Official Music Video]", "")
        .replace("[Official Audio]", "")
        .replace("[Lyric Video]", "")
        .replace("[Lyrics]", "")
        .replace("[Visualizer]", "")
        .replace("  ", " ")
        .trim()
        .to_string();

    if url.contains("music.youtube.com") {
        title = title.replace(" - Topic", "").trim().to_string();
    }

    title
}

fn split_browser_track_metadata(value: &str, url: &str) -> (String, String) {
    let title = clean_browser_track_title(value, url);

    if title.is_empty() {
        return (String::new(), String::new());
    }

    for separator in [" - ", " | ", " • ", " · ", " — ", " by "] {
        if let Some((left, right)) = title.split_once(separator) {
            let left = left.trim().to_string();
            let right = right.trim().to_string();

            if !left.is_empty() && !right.is_empty() {
                return (left, right);
            }
        }
    }

    (title, String::new())
}

fn infer_browser_title_from_url(url: &str) -> Option<String> {
    let host = extract_browser_host(url).unwrap_or_default();

    if host_matches_exact_or_subdomain(&host, "music.youtube.com")
        || host_matches_exact_or_subdomain(&host, "youtube.com")
        || host_matches_exact_or_subdomain(&host, "youtu.be")
    {
        return Some("YouTube".to_string());
    }

    if host_matches_exact_or_subdomain(&host, "music.apple.com") {
        return Some("Apple Music".to_string());
    }

    if host_matches_exact_or_subdomain(&host, "open.spotify.com") {
        return Some("Spotify Web".to_string());
    }

    if host_matches_exact_or_subdomain(&host, "soundcloud.com") {
        return Some("SoundCloud".to_string());
    }

    None
}

fn site_label_for_browser(app_name: &str, url: Option<&str>) -> String {
    let host = url.and_then(extract_browser_host).unwrap_or_default();

    if host_matches_exact_or_subdomain(&host, "music.youtube.com") {
        return "YouTube Music".to_string();
    }

    if host_matches_exact_or_subdomain(&host, "music.apple.com") {
        return "Apple Music".to_string();
    }

    if host_matches_exact_or_subdomain(&host, "youtube.com")
        || host_matches_exact_or_subdomain(&host, "youtu.be")
    {
        return "YouTube".to_string();
    }

    if host_matches_exact_or_subdomain(&host, "open.spotify.com") {
        return "Spotify Web".to_string();
    }

    if host_matches_exact_or_subdomain(&host, "soundcloud.com") {
        return "SoundCloud".to_string();
    }

    app_name.to_string()
}

struct BrowserSourceClassification {
    kind: &'static str,
    host: Option<String>,
    confidence: f64,
}

fn extract_browser_host(url: &str) -> Option<String> {
    url.trim()
        .split("://")
        .nth(1)
        .and_then(|value| value.split('/').next())
        .map(|value| value.to_lowercase())
        .filter(|value| !value.is_empty())
}

fn host_matches_exact_or_subdomain(host: &str, expected: &str) -> bool {
    host == expected || host.ends_with(&format!(".{expected}"))
}

fn classify_browser_source(url: &str) -> BrowserSourceClassification {
    let host = extract_browser_host(url);

    let host_ref = host.as_deref().unwrap_or("");

    if host_matches_exact_or_subdomain(host_ref, "open.spotify.com")
        || host_matches_exact_or_subdomain(host_ref, "music.apple.com")
        || host_matches_exact_or_subdomain(host_ref, "music.youtube.com")
        || host_matches_exact_or_subdomain(host_ref, "soundcloud.com")
    {
        return BrowserSourceClassification {
            kind: "player",
            host,
            confidence: 0.98,
        };
    }

    if host_matches_exact_or_subdomain(host_ref, "youtube.com")
        || host_matches_exact_or_subdomain(host_ref, "youtu.be")
    {
        return BrowserSourceClassification {
            kind: "generic",
            host,
            confidence: 0.72,
        };
    }

    BrowserSourceClassification {
        kind: "unknown",
        host,
        confidence: 0.45,
    }
}

fn is_supported_browser_media_page(title: &str, url: &str) -> bool {
    let lower_title = title.to_lowercase();
    let host = extract_browser_host(url).unwrap_or_default();

    if host_matches_exact_or_subdomain(&host, "music.youtube.com")
        || host_matches_exact_or_subdomain(&host, "music.apple.com")
        || host_matches_exact_or_subdomain(&host, "youtube.com")
        || host_matches_exact_or_subdomain(&host, "youtu.be")
        || host_matches_exact_or_subdomain(&host, "open.spotify.com")
        || host_matches_exact_or_subdomain(&host, "soundcloud.com")
    {
        return true;
    }

    let title_hints = [
        " - youtube music",
        " | youtube music",
        " • youtube music",
        " - apple music",
        " | apple music",
        " • apple music",
        " - youtube",
        " | youtube",
        " • youtube",
        " - spotify web",
        " | spotify web",
        " • spotify web",
        " - soundcloud",
        " | soundcloud",
        " • soundcloud",
        " - topic",
    ];

    title_hints.iter().any(|hint| lower_title.ends_with(hint))
}

fn build_control_script(app_name: &str, command: DesktopPlaybackCommand) -> String {
    let escaped_app_identifier = bundle_id_for_app_name(app_name).unwrap_or(app_name);
    let escaped_app_identifier = escape_applescript_string(escaped_app_identifier);

    let command_body = match command {
        DesktopPlaybackCommand::Toggle => "playpause".to_string(),
        DesktopPlaybackCommand::Play => "play".to_string(),
        DesktopPlaybackCommand::Pause => "pause".to_string(),
        DesktopPlaybackCommand::Next => "next track".to_string(),
        DesktopPlaybackCommand::Previous => "previous track".to_string(),
        DesktopPlaybackCommand::Seek { position_ms } => {
            let seconds = (position_ms / 1000.0).max(0.0);
            format!("set player position to {}", seconds)
        }
    };

    format!(
        r#"
tell application id "{escaped_app_identifier}"
  try
    {command_body}
  on error errMsg number errNum
    error "Lafz desktop playback control failed for {app_name}: " & errMsg & " (" & errNum & ")"
  end try
end tell
"#
    )
}

fn make_idle_state() -> DesktopPlaybackState {
    DesktopPlaybackState {
        status: "idle".to_string(),
        is_playing: false,
        shuffle_enabled: false,
        repeat_mode: "off".to_string(),
        progress_ms: 0,
        fetched_at: now_timestamp_ms_string(),
        device_name: None,
        playback_state_label: "No active playback".to_string(),
        track: None,
    }
}

fn seconds_to_ms(value: f64) -> u64 {
    if !value.is_finite() {
        return 0;
    }

    (value.max(0.0) * 1000.0).round() as u64
}

fn normalize_duration_ms(app_name: &str, value: f64) -> u64 {
    if app_name == "Spotify" {
        return value.max(0.0).round() as u64;
    }

    seconds_to_ms(value)
}

fn normalize_progress_ms(app_name: &str, value: f64) -> u64 {
    if app_name == "Spotify" {
        return seconds_to_ms(value);
    }

    seconds_to_ms(value)
}

fn now_timestamp_ms_string() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    millis.to_string()
}

fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn slugify(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn null_option<T>() -> Option<T> {
    None
}
