use windows::core::initialize_mta;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as WindowsSession,
    GlobalSystemMediaTransportControlsSessionManager as WindowsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};

use crate::desktop_media::{DesktopPlaybackCommand, DesktopPlaybackState, DesktopTrack};

fn map_windows_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn now_timestamp_ms_string() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn make_idle_state() -> DesktopPlaybackState {
    DesktopPlaybackState {
        status: "stopped".to_string(),
        is_playing: false,
        shuffle_enabled: false,
        repeat_mode: "off".to_string(),
        progress_ms: 0,
        fetched_at: now_timestamp_ms_string(),
        device_name: Some("Windows Media".to_string()),
        playback_state_label: "Stopped".to_string(),
        track: None,
    }
}

fn is_browser_source_app(source_app_id: &str) -> bool {
    let lower = source_app_id.to_lowercase();
    [
        "chrome", "msedge", "edge", "brave", "firefox", "opera", "browser",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_known_native_player(source_app_id: &str) -> bool {
    let lower = source_app_id.to_lowercase();
    [
        "spotify",
        "music",
        "zune",
        "deezer",
        "tidal",
        "youtube music",
        "soundcloud",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn friendly_windows_source_name(source_app_id: &str) -> String {
    let trimmed = source_app_id.trim();
    let source = trimmed.split('!').last().unwrap_or(trimmed).trim();
    let lower = source.to_lowercase();

    if lower.contains("spotify") {
        return "Spotify".to_string();
    }

    if lower.contains("music") || lower.contains("zune") {
        return "Music".to_string();
    }

    if lower.contains("chrome") {
        return "Google Chrome".to_string();
    }

    if lower.contains("edge") {
        return "Microsoft Edge".to_string();
    }

    if lower.contains("brave") {
        return "Brave Browser".to_string();
    }

    if lower.contains("firefox") {
        return "Firefox".to_string();
    }

    if lower.contains("opera") {
        return "Opera".to_string();
    }

    if source.is_empty() {
        return "Windows Media".to_string();
    }

    source.replace('.', " ").trim().to_string()
}

fn normalize_media_text(value: &str) -> String {
    value
        .trim()
        .replace('\u{2019}', "'")
        .replace('\u{2018}', "'")
        .replace('\u{201C}', "\"")
        .replace('\u{201D}', "\"")
        .replace("  ", " ")
        .trim()
        .to_string()
}

fn split_title_artist_hint(value: &str) -> (String, String) {
    let title = normalize_media_text(value);

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

fn extract_player_site_hint(raw_title: &str) -> Option<(&'static str, &'static str)> {
    let lower = raw_title.to_lowercase();

    if lower.contains("youtube music") {
        return Some(("player", "music.youtube.com"));
    }

    if lower.contains("apple music") {
        return Some(("player", "music.apple.com"));
    }

    if lower.contains("spotify web") || lower.contains("open.spotify.com") {
        return Some(("player", "open.spotify.com"));
    }

    if lower.contains("soundcloud") {
        return Some(("player", "soundcloud.com"));
    }

    if lower.contains("youtube") {
        return Some(("generic", "youtube.com"));
    }

    None
}

fn classify_windows_source(
    source_app_id: &str,
    raw_title: &str,
) -> (Option<String>, Option<String>, f64) {
    if is_known_native_player(source_app_id) && !is_browser_source_app(source_app_id) {
        return (None, None, 0.98);
    }

    if let Some((kind, host)) = extract_player_site_hint(raw_title) {
        return (
            Some(kind.to_string()),
            Some(host.to_string()),
            if kind == "player" { 0.98 } else { 0.72 },
        );
    }

    if is_browser_source_app(source_app_id) {
        return (Some("generic".to_string()), None, 0.72);
    }

    (None, None, 0.98)
}

fn ticks_to_ms(value: i64) -> u64 {
    if value <= 0 {
        return 0;
    }

    (value / 10_000).max(0) as u64
}

async fn request_session_manager() -> Result<WindowsSessionManager, String> {
    WindowsSessionManager::RequestAsync()
        .map_err(map_windows_error)?
        .await
        .map_err(map_windows_error)
}

fn session_playback_status(session: &WindowsSession) -> Option<PlaybackStatus> {
    session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()
}

async fn pick_windows_session(
    manager: &WindowsSessionManager,
) -> Result<Option<WindowsSession>, String> {
    if let Ok(current) = manager.GetCurrentSession() {
        match session_playback_status(&current) {
            Some(PlaybackStatus::Stopped) | Some(PlaybackStatus::Closed) | None => {}
            _ => return Ok(Some(current)),
        }
    }

    let sessions = manager.GetSessions().map_err(map_windows_error)?;
    let size = sessions.Size().map_err(map_windows_error)?;
    let mut paused_candidate: Option<WindowsSession> = None;

    for index in 0..size {
        let session = sessions.GetAt(index).map_err(map_windows_error)?;
        match session_playback_status(&session) {
            Some(PlaybackStatus::Playing) => return Ok(Some(session)),
            Some(PlaybackStatus::Paused) | Some(PlaybackStatus::Changing) => {
                if paused_candidate.is_none() {
                    paused_candidate = Some(session);
                }
            }
            Some(_) | None => {
                if paused_candidate.is_none() {
                    paused_candidate = Some(session);
                }
            }
        }
    }

    Ok(paused_candidate)
}

async fn read_windows_session(session: &WindowsSession) -> Result<DesktopPlaybackState, String> {
    let playback_info = session.GetPlaybackInfo().map_err(map_windows_error)?;
    let status = playback_info.PlaybackStatus().map_err(map_windows_error)?;
    let media_properties = session
        .TryGetMediaPropertiesAsync()
        .map_err(map_windows_error)?
        .await
        .map_err(map_windows_error)?;
    let timeline = session.GetTimelineProperties().map_err(map_windows_error)?;
    let source_app_id = session
        .SourceAppUserModelId()
        .map_err(map_windows_error)?
        .to_string();

    let raw_title = normalize_media_text(
        &media_properties
            .Title()
            .map_err(map_windows_error)?
            .to_string(),
    );
    let raw_artist = normalize_media_text(
        &media_properties
            .Artist()
            .map_err(map_windows_error)?
            .to_string(),
    );
    let subtitle = normalize_media_text(
        &media_properties
            .Subtitle()
            .map_err(map_windows_error)?
            .to_string(),
    );
    let album = normalize_media_text(
        &media_properties
            .AlbumTitle()
            .map_err(map_windows_error)?
            .to_string(),
    );

    let (mut title, mut artist) = if !raw_title.is_empty() {
        split_title_artist_hint(&raw_title)
    } else {
        (String::new(), String::new())
    };

    if title.is_empty() {
        title = raw_title.clone();
    }

    if artist.is_empty() {
        artist = raw_artist.clone();
    }

    if artist.is_empty() && !subtitle.is_empty() {
        let (_, subtitle_artist) = split_title_artist_hint(&subtitle);
        if !subtitle_artist.is_empty() {
            artist = subtitle_artist;
        }
    }

    if title.is_empty() {
        title = subtitle.clone();
    }

    if title.is_empty() {
        return Ok(make_idle_state());
    }

    let start_ticks = timeline.StartTime().map_err(map_windows_error)?.Duration;
    let end_ticks = timeline.EndTime().map_err(map_windows_error)?.Duration;
    let position_ticks = timeline.Position().map_err(map_windows_error)?.Duration;
    let duration_ms = ticks_to_ms(end_ticks.saturating_sub(start_ticks));
    let progress_ms = ticks_to_ms(position_ticks);
    let (browser_kind, browser_host, browser_confidence) =
        classify_windows_source(&source_app_id, &raw_title);
    let device_name = friendly_windows_source_name(&source_app_id);
    let is_playing = status == PlaybackStatus::Playing;
    let is_browser = browser_kind.is_some();
    let track_id = if is_browser {
        format!(
            "browser:windows:{}:{}:{}",
            slugify(&device_name),
            slugify(&artist),
            slugify(&title)
        )
    } else {
        format!(
            "windows:{}:{}:{}:{}",
            slugify(&device_name),
            slugify(&artist),
            slugify(&title),
            slugify(&album)
        )
    };

    Ok(DesktopPlaybackState {
        status: if is_playing {
            "playing".to_string()
        } else {
            "paused".to_string()
        },
        is_playing,
        shuffle_enabled: false,
        repeat_mode: "off".to_string(),
        progress_ms,
        fetched_at: now_timestamp_ms_string(),
        device_name: Some(device_name),
        playback_state_label: if is_playing {
            "Playing".to_string()
        } else {
            "Paused".to_string()
        },
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
            album_art_url: None,
            duration_ms,
            external_url: None,
            browser_source_kind: browser_kind,
            browser_source_host: browser_host,
            browser_source_confidence: Some(browser_confidence),
        }),
    })
}

fn slugify(value: &str) -> String {
    let mut out = String::new();

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }

    out.trim_matches('-').to_string()
}

pub async fn desktop_now_playing_windows() -> Result<DesktopPlaybackState, String> {
    let _mta = initialize_mta().map_err(map_windows_error)?;
    let manager = request_session_manager().await?;

    if let Some(session) = pick_windows_session(&manager).await? {
        let state = read_windows_session(&session).await?;
        if state.track.is_some() {
            return Ok(state);
        }
    }

    Ok(make_idle_state())
}

pub async fn desktop_control_playback_windows(
    command: DesktopPlaybackCommand,
) -> Result<(), String> {
    let _mta = initialize_mta().map_err(map_windows_error)?;
    let manager = request_session_manager().await?;
    let Some(session) = pick_windows_session(&manager).await? else {
        return Err("No supported desktop media app is running.".to_string());
    };

    match command {
        DesktopPlaybackCommand::Toggle => {
            let accepted = session
                .TryTogglePlayPauseAsync()
                .map_err(map_windows_error)?
                .await
                .map_err(map_windows_error)?;
            if !accepted {
                return Err("Windows media control was rejected by the active session.".to_string());
            }
        }
        DesktopPlaybackCommand::Play => {
            let accepted = session
                .TryPlayAsync()
                .map_err(map_windows_error)?
                .await
                .map_err(map_windows_error)?;
            if !accepted {
                return Err("Windows media control was rejected by the active session.".to_string());
            }
        }
        DesktopPlaybackCommand::Pause => {
            let accepted = session
                .TryPauseAsync()
                .map_err(map_windows_error)?
                .await
                .map_err(map_windows_error)?;
            if !accepted {
                return Err("Windows media control was rejected by the active session.".to_string());
            }
        }
        DesktopPlaybackCommand::Next => {
            let accepted = session
                .TrySkipNextAsync()
                .map_err(map_windows_error)?
                .await
                .map_err(map_windows_error)?;
            if !accepted {
                return Err("Windows media control was rejected by the active session.".to_string());
            }
        }
        DesktopPlaybackCommand::Previous => {
            let accepted = session
                .TrySkipPreviousAsync()
                .map_err(map_windows_error)?
                .await
                .map_err(map_windows_error)?;
            if !accepted {
                return Err("Windows media control was rejected by the active session.".to_string());
            }
        }
        DesktopPlaybackCommand::Seek { position_ms } => {
            let requested_ticks = (position_ms.max(0.0).round() as i64).saturating_mul(10_000);
            let accepted = session
                .TryChangePlaybackPositionAsync(requested_ticks)
                .map_err(map_windows_error)?
                .await
                .map_err(map_windows_error)?;
            if !accepted {
                return Err("Windows media control was rejected by the active session.".to_string());
            }
        }
    }

    Ok(())
}
