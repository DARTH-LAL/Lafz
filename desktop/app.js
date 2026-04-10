const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";
const DESKTOP_POLL_INTERVAL_MS = 180;
const DESKTOP_TRANSLATION_REFRESH_MS = 12000;
const DESKTOP_CLOCK_TICK_MS = 250;
const DESKTOP_AUTH_STORAGE_KEY = "lafz_desktop_auth_session";
const DESKTOP_AUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DESKTOP_AUTH_RESEND_COOLDOWN_MS = 60 * 1000;
const DESKTOP_LOCATION_CACHE_KEY = "lafz_desktop_last_seen_geo";
const DESKTOP_LOCATION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const BROWSER_SOURCE_APPS = new Set(["Safari", "Google Chrome", "Microsoft Edge", "Brave Browser", "Arc"]);
const BROWSER_PLAYER_SOURCE_HOST_HINTS = new Set([
  "open.spotify.com",
  "music.apple.com",
  "music.youtube.com",
  "soundcloud.com"
]);
const BROWSER_SYNC_CONFIDENCE_THRESHOLD = 0.9;
const BROWSER_GENERIC_SOURCE_HOST_HINTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be"
]);

const appRoot = document.getElementById("app");
const tauriInvoke = window.__TAURI__?.core?.invoke
  ? window.__TAURI__.core.invoke.bind(window.__TAURI__.core)
  : null;

if (!appRoot) {
  throw new Error("Lafz desktop requires an #app root element.");
}

const state = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  supabaseUrl: "",
  supabaseAnonKey: "",
  runtimeReady: false,
  desktopRuntimeStarted: false,
  desktopShellBuilt: false,
  desktopAuthSession: null,
  desktopAuthProfile: null,
  desktopAuthName: "",
  desktopAdminProfiles: [],
  desktopAdminTargetEmail: "",
  desktopAdminMessage: "",
  desktopAdminBusy: false,
  desktopAuthStatus: "checking",
  desktopAuthEmail: "",
  desktopAuthCode: "",
  desktopAuthMessage: "",
  desktopAuthCodeSent: false,
  desktopAuthResendCooldownUntil: 0,
  desktopAuthBusy: false,
  desktopUpdateConfigured: false,
  desktopUpdateChecking: false,
  desktopUpdateAvailable: false,
  desktopUpdateInstalling: false,
  desktopUpdateCurrentVersion: "",
  desktopUpdateLatestVersion: "",
  desktopUpdatePublishedAt: "",
  desktopUpdateMessage: "",
  desktopAppVersion: "",
  desktopConnected: true,
  playback: null,
  translation: null,
  aiDraft: null,
  albumArtUrl: null,
  statusKind: "loading",
  statusText: "Loading desktop sync...",
  bannerText: "",
  lastTrackKey: "",
  lastPlaybackFetchedAt: 0,
  lastTranslationFetchedAt: 0,
  lastArtworkFetchedAt: 0,
  artworkThemeKey: "",
  translationKey: "",
  artworkKey: "",
  songVoteKey: "",
  songVoteSummary: null,
  songVoteSubmitting: false,
  songVotePollInFlight: false,
  songVoteRequestId: 0,
  lastVoteFetchedAt: 0,
  activeLineIndex: -1,
  now: Date.now(),
  playbackPollInFlight: false,
  translationPollInFlight: false,
  artworkPollInFlight: false,
  artworkThemePollInFlight: false,
  artworkRequestId: 0,
  artworkThemeRequestId: 0,
  artGlowBeatMs: 500,
  artGlowColor: [255, 20, 100],
  artGlowPulse: 0.76,
  translationRequestId: 0
};

const playbackRefreshTimers = new Set();
let playbackRefreshIntervalId = null;
let clockRefreshIntervalId = null;
let authCooldownIntervalId = null;
let desktopRuntimeListenersAttached = false;

const refs = {};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function describeError(error) {
  if (typeof error === "string") {
    return error.trim();
  }

  if (error && typeof error === "object") {
    const candidate = error.message || error.error || error.reason;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Ignore serialization failures and fall back below.
    }

    const text = String(error);
    if (text && text !== "[object Object]") {
      return text;
    }
  }

  return "Unknown error";
}

function formatPlaybackControlError(error) {
  const detail = describeError(error);
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("not authorized") ||
    normalized.includes("permission") ||
    normalized.includes("apple events") ||
    normalized.includes("-1743")
  ) {
    return "Lafz needs macOS Automation permission to control Spotify or Music. Open System Settings > Privacy & Security > Automation and allow Lafz for the active player, then relaunch Lafz.";
  }

  if (normalized.includes("no supported desktop media app is running")) {
    return "Open Spotify or Music first so Lafz can control the active player.";
  }

  return `Playback control failed: ${detail}`;
}

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const RAIN_DROPS = [
  { text: "ਦਿਲ", left: 4, delay: 0.0, dur: 9.2, size: 13, opacity: 0.22, rot: -6, color: "#ff6ba8" },
  { text: "♪", left: 10, delay: 1.4, dur: 7.8, size: 16, opacity: 0.28, rot: 4, color: "#ff1464" },
  { text: "yaar", left: 17, delay: 3.1, dur: 11.0, size: 11, opacity: 0.18, rot: -10, color: "#c2185b" },
  { text: "ਇਸ਼ਕ", left: 24, delay: 0.7, dur: 8.5, size: 12, opacity: 0.22, rot: 7, color: "#ff2d78" },
  { text: "♫", left: 31, delay: 2.3, dur: 10.2, size: 15, opacity: 0.26, rot: -4, color: "#ff6ba8" },
  { text: "दिल", left: 38, delay: 4.6, dur: 9.0, size: 13, opacity: 0.20, rot: 9, color: "#ff4d8b" },
  { text: "ishq", left: 44, delay: 1.1, dur: 12.5, size: 10, opacity: 0.17, rot: -7, color: "#e91e8c" },
  { text: "ਯਾਰ", left: 51, delay: 3.8, dur: 8.0, size: 14, opacity: 0.24, rot: 5, color: "#ff1464" },
  { text: "♩", left: 57, delay: 0.4, dur: 11.8, size: 17, opacity: 0.28, rot: -9, color: "#ff6ba8" },
  { text: "प्यार", left: 63, delay: 2.9, dur: 9.6, size: 12, opacity: 0.20, rot: 6, color: "#c2185b" },
  { text: "sajjan", left: 70, delay: 5.2, dur: 8.8, size: 10, opacity: 0.17, rot: -5, color: "#ff2d78" },
  { text: "ਸੱਜਣ", left: 76, delay: 1.7, dur: 10.5, size: 13, opacity: 0.22, rot: 8, color: "#ff6ba8" },
  { text: "♬", left: 82, delay: 3.4, dur: 7.5, size: 16, opacity: 0.26, rot: -3, color: "#ff4d8b" },
  { text: "dil", left: 88, delay: 0.9, dur: 9.9, size: 11, opacity: 0.19, rot: 7, color: "#e91e8c" },
  { text: "ਮੁਹੱਬਤ", left: 94, delay: 4.0, dur: 11.3, size: 11, opacity: 0.17, rot: -8, color: "#ff1464" },
  { text: "ranjha", left: 20, delay: 7.3, dur: 10.0, size: 10, opacity: 0.18, rot: -6, color: "#c2185b" },
  { text: "mohabbat", left: 61, delay: 8.0, dur: 8.7, size: 10, opacity: 0.17, rot: 6, color: "#ff4d8b" },
];

function buildAuthGate() {
  const isLocked = state.desktopAuthStatus === "locked";
  const waitlistName = state.desktopAuthName || state.desktopAuthProfile?.displayName || "";
  const buttonLabel = getAuthSubmitLabel();

  const rainHTML = RAIN_DROPS.map(d =>
    `<span class="rain-drop" style="left:${d.left}%;font-size:${d.size}px;color:${d.color};transform:rotate(${d.rot}deg);animation:lafz-rain-fall ${d.dur}s linear ${d.delay}s infinite;opacity:0;">${d.text}</span>`
  ).join("");

  appRoot.innerHTML = `
    <main class="auth-hero-shell">
      <div class="auth-rain" aria-hidden="true">${rainHTML}</div>

      <nav class="auth-hero-nav">
        <span class="auth-hero-wordmark">la<span class="accent">F</span>z</span>
        <div class="auth-hero-nav-actions">
          ${buildDesktopUpdateControlMarkup()}
        </div>
      </nav>

      <div class="auth-hero-body">
        ${isLocked ? `
          <div class="auth-hero-badge"><span class="badge-dot"></span> Access pending</div>
          <h1 class="auth-hero-h1">You’re on the list.</h1>
          <p class="auth-hero-sub">We’re reviewing your access. You’ll be able to use Lafz as soon as it’s approved.</p>
        ` : `
          <div class="auth-hero-badge"><span class="badge-dot"></span> Invite-only beta</div>
          <h1 class="auth-hero-h1">
            ${state.desktopAuthCodeSent
              ? `Enter your<br><span class="auth-hero-shimmer">8-digit code.</span>`
              : `Every song,<br><span class="auth-hero-shimmer">understood.</span>`
            }
          </h1>
          <p class="auth-hero-sub">
            ${state.desktopAuthCodeSent
              ? `We sent an 8-digit code to <strong>${escapeHtml(state.desktopAuthEmail)}</strong>. Check your inbox and enter it below.`
              : "Enter your email and we’ll send you an 8-digit code to sign in."
            }
          </p>

          <div class="auth-hero-form">
            <div class="auth-hero-inputs">
              <input
                data-role="auth-email"
                type="email"
                placeholder="you@example.com"
                autocomplete="email"
                spellcheck="false"
                class="auth-hero-input"
                ${state.desktopAuthCodeSent ? "hidden" : ""}
              />
              <input
                data-role="auth-code"
                type="text"
                inputmode="numeric"
                placeholder="12345678"
                autocomplete="one-time-code"
                class="auth-hero-input"
                ${state.desktopAuthCodeSent ? "" : "hidden"}
              />
            </div>
            <div class="auth-hero-actions">
              <button class="auth-hero-btn-primary" type="button" data-action="auth-submit">${escapeHtml(buttonLabel)}</button>
              ${state.desktopAuthCodeSent ? `<button class="auth-hero-btn-secondary" type="button" data-action="auth-reset">Use a different email</button>` : ""}
            </div>
            <div class="auth-message" data-role="auth-message" ${state.desktopAuthMessage ? "" : "hidden"}>${escapeHtml(state.desktopAuthMessage)}</div>
          </div>

          ${!state.desktopAuthCodeSent ? `
            <div class="auth-hero-trust">
              <span><span class="trust-dot">✦</span> No library access</span>
              <span><span class="trust-dot">✦</span> Free to use</span>
              <span><span class="trust-dot">✦</span> Early access</span>
            </div>
          ` : ""}
        `}
      </div>
    </main>
  `;

  refs.authEmail = appRoot.querySelector('[data-role="auth-email"]');
  refs.authCode = appRoot.querySelector('[data-role="auth-code"]');
  refs.authName = appRoot.querySelector('[data-role="auth-name"]');
  refs.authCodeGroup = appRoot.querySelector('[data-role="auth-code-group"]') || appRoot.querySelector('[data-role="auth-code"]')?.closest('div') || null;
  refs.authMessage = appRoot.querySelector('[data-role="auth-message"]');
  refs.authSubmit = appRoot.querySelector('[data-action="auth-submit"]');
  refs.authNameSave = appRoot.querySelector('[data-action="auth-name-save"]');
  refs.authReset = appRoot.querySelector('[data-action="auth-reset"]');
  refs.authSignOut = appRoot.querySelector('[data-action="auth-signout"]');

  if (refs.authEmail) {
    refs.authEmail.value = state.desktopAuthEmail || "";
    refs.authEmail.addEventListener("input", () => {
      state.desktopAuthEmail = refs.authEmail.value;
    });
  }

  if (refs.authCode) {
    refs.authCode.value = state.desktopAuthCode || "";
    refs.authCode.addEventListener("input", () => {
      state.desktopAuthCode = refs.authCode.value;
    });
  }

  if (refs.authName) {
    refs.authName.value = state.desktopAuthName || state.desktopAuthProfile?.displayName || "";
    refs.authName.addEventListener("input", () => {
      state.desktopAuthName = refs.authName.value;
    });
  }

  refs.authSubmit?.addEventListener("click", handleAuthSubmit);
  refs.authNameSave?.addEventListener("click", handleAuthNameSave);
  refs.authReset?.addEventListener("click", handleAuthReset);
  refs.authSignOut?.addEventListener("click", handleAuthSignOut);
  bindDesktopUpdateControls();

  renderAuthMessage(state.desktopAuthMessage);
  setAuthFormBusy(state.desktopAuthBusy);
  syncAuthCooldownTicker();
}

function getAuthResendCooldownRemainingMs() {
  return Math.max(0, Number(state.desktopAuthResendCooldownUntil || 0) - Date.now());
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getDesktopUpdateButtonLabel() {
  if (!state.desktopUpdateConfigured) {
    return "";
  }

  if (state.desktopUpdateInstalling) {
    return "Installing...";
  }

  if (state.desktopUpdateChecking) {
    return "Checking...";
  }

  if (state.desktopUpdateAvailable) {
    return "Install update";
  }

  if ((state.desktopUpdateMessage || "").toLowerCase().includes("up to date")) {
    return "Up to date";
  }

  return "Check updates";
}

function buildDesktopUpdateControlMarkup() {
  if (!state.desktopUpdateConfigured) {
    return "";
  }

  return `
    <button class="topbar-update-btn" type="button" data-action="desktop-update" aria-label="Check for Lafz updates">
      <span class="topbar-update-dot" aria-hidden="true"></span>
      <span data-role="desktop-update-label">${escapeHtml(getDesktopUpdateButtonLabel())}</span>
    </button>
  `;
}

function syncDesktopUpdateControls() {
  if (!refs.updateButton || !refs.updateLabel) {
    return;
  }

  if (!state.desktopUpdateConfigured) {
    refs.updateButton.hidden = true;
    return;
  }

  refs.updateButton.hidden = false;
  refs.updateButton.disabled = state.desktopUpdateChecking || state.desktopUpdateInstalling;
  refs.updateButton.dataset.state = state.desktopUpdateInstalling
    ? "installing"
    : state.desktopUpdateChecking
      ? "checking"
      : state.desktopUpdateAvailable
        ? "available"
        : "idle";
  refs.updateButton.title = state.desktopUpdateMessage || "Check for Lafz updates";
  refs.updateLabel.textContent = getDesktopUpdateButtonLabel();
}

function bindDesktopUpdateControls() {
  refs.updateButton = appRoot.querySelector('[data-action="desktop-update"]');
  refs.updateLabel = appRoot.querySelector('[data-role="desktop-update-label"]');

  if (refs.updateButton) {
    refs.updateButton.addEventListener("click", handleDesktopUpdateClick);
  }

  syncDesktopUpdateControls();
}

function getAuthSubmitLabel() {
  if (state.desktopAuthBusy) {
    return state.desktopAuthCodeSent ? "Verifying..." : "Sending...";
  }

  if (!state.desktopAuthCodeSent) {
    const remainingMs = getAuthResendCooldownRemainingMs();
    if (remainingMs > 0) {
      return `Send code in ${formatCountdown(remainingMs)}`;
    }
    return "Continue";
  }

  return "Verify code";
}

function syncAuthCooldownTicker() {
  if (authCooldownIntervalId !== null) {
    window.clearInterval(authCooldownIntervalId);
    authCooldownIntervalId = null;
  }

  if (state.desktopAuthCodeSent) {
    return;
  }

  if (getAuthResendCooldownRemainingMs() <= 0) {
    if (refs.authSubmit && !state.desktopAuthBusy) {
      refs.authSubmit.disabled = false;
      refs.authSubmit.textContent = "Continue";
    }
    return;
  }

  authCooldownIntervalId = window.setInterval(() => {
    if (state.desktopAuthCodeSent) {
      syncAuthCooldownTicker();
      return;
    }

    const remainingMs = getAuthResendCooldownRemainingMs();
    if (remainingMs <= 0) {
      syncAuthCooldownTicker();
      if (refs.authSubmit && !state.desktopAuthBusy) {
        refs.authSubmit.disabled = false;
        refs.authSubmit.textContent = "Continue";
      }
      return;
    }

    if (refs.authSubmit && !state.desktopAuthBusy) {
      refs.authSubmit.disabled = true;
      refs.authSubmit.textContent = `Send code in ${formatCountdown(remainingMs)}`;
    }
  }, 1000);
}

function buildProfileView() {
  const profile = state.desktopAuthProfile;
  const email = profile?.email || state.desktopAuthEmail || "";
  const displayName = profile?.displayName || "";
  const isAdmin = Boolean(profile?.isAdmin);
  const initials = (displayName || email).slice(0, 1).toUpperCase() || "?";
  const profileBadgeHTML = [
    `<div class="profile-badge"><span class="dot"></span> Access granted</div>`,
    isAdmin ? `<div class="profile-badge profile-badge-admin"><span class="dot"></span> Admin</div>` : ""
  ].filter(Boolean).join("");
  const adminSectionHTML = isAdmin ? `
    <div class="profile-section profile-admin-section">
      <div class="profile-section-title">Invite & access</div>
      <div class="admin-hero">
        <div class="admin-hero-copy">
          <div class="admin-hero-title">Approve people from their email.</div>
          <p class="admin-hero-sub">
            Invite someone now and Lafz will automatically unlock them on first sign-in. Revoke access here to lock them out again.
          </p>
        </div>
        <div class="admin-hero-form">
          <input
            data-role="admin-email"
            type="email"
            placeholder="friend@example.com"
            autocomplete="off"
            spellcheck="false"
            class="admin-input"
            value="${escapeHtml(state.desktopAdminTargetEmail || "")}"
          />
          <div class="admin-actions">
            <button class="admin-btn primary" type="button" data-action="admin-grant">Invite / grant access</button>
            <button class="admin-btn" type="button" data-action="admin-revoke">Revoke access</button>
            <button class="admin-btn secondary" type="button" data-action="admin-refresh">Refresh list</button>
          </div>
        </div>
      </div>
      <div class="auth-message admin-message" data-role="admin-message" ${state.desktopAdminMessage ? "" : "hidden"}>${escapeHtml(state.desktopAdminMessage)}</div>
      <div class="admin-list" data-role="admin-list">
        <div class="admin-empty">Loading invite list…</div>
      </div>
    </div>
  ` : "";

  appRoot.innerHTML = `
    <div class="profile-view">
      <div class="profile-topbar">
        <div class="logo">la<span class="accent">F</span>z</div>
        <div class="profile-topbar-actions">
          ${buildDesktopUpdateControlMarkup()}
          <button class="profile-back-btn" type="button" data-action="profile-back" aria-label="Back">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back
          </button>
        </div>
      </div>

      <div class="profile-body">
        <div class="profile-card">
          <div class="profile-avatar">${escapeHtml(initials)}</div>
          <div class="profile-info">
            ${displayName ? `<div class="profile-name">${escapeHtml(displayName)}</div>` : ""}
            <div class="profile-email">${escapeHtml(email)}</div>
            ${profileBadgeHTML}
          </div>
        </div>

        <div class="profile-section">
          <div class="profile-section-title">Account</div>
          <div class="profile-row">
            <span class="profile-row-label">Email</span>
            <span class="profile-row-value">${escapeHtml(email)}</span>
          </div>
          <div class="profile-row">
            <span class="profile-row-label">Status</span>
            <span class="profile-row-value profile-row-active">Active</span>
          </div>
        </div>

        ${isAdmin ? `
          <button class="profile-admin-nav-btn" type="button" data-action="open-admin">
            <span class="profile-admin-nav-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z"/>
              </svg>
            </span>
            <span>Admin panel</span>
            <svg class="profile-admin-nav-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        ` : ""}

        <button class="profile-signout-btn" type="button" data-action="auth-signout">Disconnect</button>
      </div>
    </div>
  `;

  appRoot.querySelector('[data-action="profile-back"]')?.addEventListener("click", () => {
    buildShell();
    bootstrapShellRefs();
  });
  appRoot.querySelector('[data-action="open-admin"]')?.addEventListener("click", buildAdminView);
  appRoot.querySelector('[data-action="auth-signout"]')?.addEventListener("click", handleAuthSignOut);
  bindDesktopUpdateControls();
}

function buildAdminView() {
  appRoot.innerHTML = `
    <div class="profile-view">
      <div class="profile-topbar">
        <div class="logo">la<span class="accent">F</span>z</div>
        <button class="profile-back-btn" type="button" data-action="admin-back">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back
        </button>
      </div>

      <div class="profile-body">

        <!-- Header -->
        <div class="admin-page-header">
          <div class="admin-page-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z"/>
            </svg>
          </div>
          <div>
            <div class="admin-page-title">Admin Panel</div>
            <div class="admin-page-sub">Manage who can access Lafz</div>
          </div>
        </div>

        <!-- Invite card -->
        <div class="admin-invite-card">
          <div class="admin-invite-card-label">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Add member
          </div>
          <div class="admin-input-row">
            <input
              data-role="admin-email"
              type="email"
              placeholder="name@example.com"
              autocomplete="off"
              spellcheck="false"
              class="admin-input"
              value="${escapeHtml(state.desktopAdminTargetEmail || "")}"
            />
            <button class="admin-icon-btn grant" type="button" data-action="admin-grant" title="Invite / Grant access" aria-label="Invite or grant access">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </button>
            <button class="admin-icon-btn revoke" type="button" data-action="admin-revoke" title="Revoke access" aria-label="Revoke access">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="admin-input-hint">Press Enter to invite &bull; ✓ to grant &bull; ✕ to revoke</div>
          <div class="admin-message" data-role="admin-message" ${state.desktopAdminMessage ? "" : "hidden"}>${escapeHtml(state.desktopAdminMessage)}</div>
        </div>

        <!-- Users card -->
        <div class="admin-users-card">
          <div class="admin-users-header">
            <span class="admin-users-title">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M19 8v6M22 11h-6"/></svg>
              Users
            </span>
            <button class="admin-refresh-btn" type="button" data-action="admin-refresh" aria-label="Refresh user list">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Refresh
            </button>
          </div>
          <div class="admin-list" data-role="admin-list">
            <div class="admin-empty">
              <div class="admin-empty-icon">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg>
              </div>
              <div class="admin-empty-text">Loading users…</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  appRoot.querySelector('[data-action="admin-back"]')?.addEventListener("click", buildProfileView);

  refs.adminEmail = appRoot.querySelector('[data-role="admin-email"]');
  refs.adminMessage = appRoot.querySelector('[data-role="admin-message"]');
  refs.adminList = appRoot.querySelector('[data-role="admin-list"]');

  refs.adminEmail?.addEventListener("input", () => {
    state.desktopAdminTargetEmail = refs.adminEmail.value;
  });
  refs.adminEmail?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleDesktopAdminAccessChange(true);
    }
  });

  appRoot.querySelector('[data-action="admin-grant"]')?.addEventListener("click", () => {
    void handleDesktopAdminAccessChange(true);
  });
  appRoot.querySelector('[data-action="admin-revoke"]')?.addEventListener("click", () => {
    void handleDesktopAdminAccessChange(false);
  });
  appRoot.querySelector('[data-action="admin-refresh"]')?.addEventListener("click", () => {
    void loadDesktopAdminProfiles(true);
  });
  refs.adminList?.addEventListener("click", handleDesktopAdminListClick);

  void loadDesktopAdminProfiles(true);
}

function buildShell() {
  appRoot.innerHTML = `
    <div class="shell">
      <div class="topbar-wrap">
        <div class="topbar">
          <div class="logo">la<span class="accent">F</span>z</div>
          <div class="topbar-actions">
            ${buildDesktopUpdateControlMarkup()}
            <button class="topbar-profile-btn" type="button" data-action="open-profile" aria-label="Profile">
              <span class="topbar-avatar">${(state.desktopAuthProfile?.email || state.desktopAuthEmail || "?").slice(0, 1).toUpperCase()}</span>
            </button>
          </div>
        </div>
      </div>

      <aside class="left-pane">
        <div class="column-stack">
          <section class="card art-card strong">
            <div class="art-beat-glow" data-role="art-beat-glow"></div>
            <div class="art-beat-ring" aria-hidden="true"></div>
            <div class="art-beat-ring" aria-hidden="true"></div>
            <div class="art-beat-ring" aria-hidden="true"></div>
            <div class="art-media" data-role="art-media" hidden></div>
            <div class="art-fallback" data-role="art-fallback">
              <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
                <path d="M27 11v23.4c-1.9-1.1-4.2-1.7-6.6-1.7-6.8 0-12.4 4.4-12.4 9.8 0 5.4 5.6 9.8 12.4 9.8 6.9 0 12.5-4.4 12.5-9.8V25.3l16-4.3v15.8c-1.9-1.1-4.2-1.7-6.6-1.7-6.8 0-12.4 4.4-12.4 9.8 0 5.4 5.6 9.8 12.4 9.8 6.9 0 12.5-4.4 12.5-9.8V11L27 14.2V11z"/>
              </svg>
            </div>
            <div class="ring"></div>
            <div class="play-badge">
              <span class="badge-dot"></span>
              <span data-role="play-badge">IDLE</span>
            </div>
          </section>

          <section class="card player-card strong">
            <h2 class="title" data-role="track-title">Waiting for playback</h2>
            <p class="artist" data-role="track-artist">Open Spotify, Music, or another player</p>
            <p class="album" data-role="track-album">Lafz watches the active system player</p>

            <div class="progress" data-role="progress-section">
              <div class="progress-meta">
                <span data-role="progress-current">0:00</span>
                <span data-role="progress-total">0:00</span>
              </div>
              <div class="progress-track" data-role="progress-track" aria-label="Playback progress">
                <div class="progress-fill" data-role="progress-fill"></div>
                <div class="progress-knob" data-role="progress-knob"></div>
              </div>
            </div>

            <div class="controls" data-role="controls-section">
              <button class="control-btn small icon-skip is-prev" data-action="previous" aria-label="Previous track" title="Previous track">
                <span class="control-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M5 5h2v14H5zM9 6l10 6-10 6z"/>
                  </svg>
                </span>
              </button>
              <button class="control-btn primary" data-action="toggle" aria-label="Play or pause">▶</button>
              <button class="control-btn small icon-skip is-next" data-action="next" aria-label="Next track" title="Next track">
                <span class="control-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M5 5h2v14H5zM9 6l10 6-10 6z"/>
                  </svg>
                </span>
              </button>
            </div>

            <div class="player-footer" data-role="player-footer">
              <strong data-role="player-source">Reading from system media</strong><br />
            </div>

            <div class="player-actions">
              <button class="disconnect-btn" type="button" data-action="disconnect" aria-label="Disconnect desktop sync">
                <span class="disconnect-icon" aria-hidden="true">↩</span>
                <span data-role="disconnect-label">Disconnect</span>
              </button>
            </div>
          </section>
        </div>
      </aside>

      <main class="main-pane">
        <section class="card lyrics-card strong">
          <div class="lyrics-body" data-role="lyrics-body"></div>
          <div class="offline-banner" data-role="offline-banner" hidden></div>
        </section>
      </main>
    </div>
  `;

  refs.artCard = appRoot.querySelector(".art-card");
  refs.artMedia = appRoot.querySelector('[data-role="art-media"]');
  refs.artBeatGlow = appRoot.querySelector('[data-role="art-beat-glow"]');
  refs.beatRings = Array.from(appRoot.querySelectorAll('.art-beat-ring'));
  refs.artFallback = appRoot.querySelector('[data-role="art-fallback"]');
  refs.playBadge = appRoot.querySelector('[data-role="play-badge"]');
  refs.trackTitle = appRoot.querySelector('[data-role="track-title"]');
  refs.trackArtist = appRoot.querySelector('[data-role="track-artist"]');
  refs.trackAlbum = appRoot.querySelector('[data-role="track-album"]');
  refs.progressCurrent = appRoot.querySelector('[data-role="progress-current"]');
  refs.progressTotal = appRoot.querySelector('[data-role="progress-total"]');
  refs.progressTrack = appRoot.querySelector('[data-role="progress-track"]');
  refs.progressFill = appRoot.querySelector('[data-role="progress-fill"]');
  refs.progressKnob = appRoot.querySelector('[data-role="progress-knob"]');
  refs.playButton = appRoot.querySelector('[data-action="toggle"]');
  refs.previousButton = appRoot.querySelector('[data-action="previous"]');
  refs.nextButton = appRoot.querySelector('[data-action="next"]');
  refs.playerSource = appRoot.querySelector('[data-role="player-source"]');
  refs.progressSection = appRoot.querySelector('[data-role="progress-section"]');
  refs.controlsSection = appRoot.querySelector('[data-role="controls-section"]');
  refs.playerFooter = appRoot.querySelector('[data-role="player-footer"]');
  refs.disconnectLabel = appRoot.querySelector('[data-role="disconnect-label"]');
  refs.lyricsBody = appRoot.querySelector('[data-role="lyrics-body"]');
  refs.offlineBanner = appRoot.querySelector('[data-role="offline-banner"]');
  refs.controlButtons = [refs.previousButton, refs.playButton, refs.nextButton].filter(Boolean);
  bindDesktopUpdateControls();

  refs.progressTrack?.addEventListener("click", handleProgressSeek);
  refs.lyricsBody?.addEventListener("click", handleLyricsClick);
  refs.controlButtons.forEach((button) => {
    button.addEventListener("click", handleControlClick);
  });
  appRoot.querySelector('[data-action="disconnect"]')?.addEventListener("click", handleControlClick);
  appRoot.querySelector('[data-action="open-profile"]')?.addEventListener("click", buildProfileView);
}

function bootstrapShellRefs() {
  refs.artCard = appRoot.querySelector(".art-card");
  refs.artMedia = appRoot.querySelector('[data-role="art-media"]');
  refs.artBeatGlow = appRoot.querySelector('[data-role="art-beat-glow"]');
  refs.beatRings = Array.from(appRoot.querySelectorAll('.art-beat-ring'));
  refs.artFallback = appRoot.querySelector('[data-role="art-fallback"]');
  refs.playBadge = appRoot.querySelector('[data-role="play-badge"]');
  refs.trackTitle = appRoot.querySelector('[data-role="track-title"]');
  refs.trackArtist = appRoot.querySelector('[data-role="track-artist"]');
  refs.trackAlbum = appRoot.querySelector('[data-role="track-album"]');
  refs.progressCurrent = appRoot.querySelector('[data-role="progress-current"]');
  refs.progressTotal = appRoot.querySelector('[data-role="progress-total"]');
  refs.progressTrack = appRoot.querySelector('[data-role="progress-track"]');
  refs.progressFill = appRoot.querySelector('[data-role="progress-fill"]');
  refs.progressKnob = appRoot.querySelector('[data-role="progress-knob"]');
  refs.playButton = appRoot.querySelector('[data-action="toggle"]');
  refs.previousButton = appRoot.querySelector('[data-action="previous"]');
  refs.nextButton = appRoot.querySelector('[data-action="next"]');
  refs.playerSource = appRoot.querySelector('[data-role="player-source"]');
  refs.progressSection = appRoot.querySelector('[data-role="progress-section"]');
  refs.controlsSection = appRoot.querySelector('[data-role="controls-section"]');
  refs.playerFooter = appRoot.querySelector('[data-role="player-footer"]');
  refs.disconnectLabel = appRoot.querySelector('[data-role="disconnect-label"]');
  refs.lyricsBody = appRoot.querySelector('[data-role="lyrics-body"]');
  refs.offlineBanner = appRoot.querySelector('[data-role="offline-banner"]');
  refs.controlButtons = [refs.previousButton, refs.playButton, refs.nextButton].filter(Boolean);
}

function setStatus(kind, text) {
  state.statusKind = kind;
  state.statusText = text;
}

function clampSeekPosition(positionMs) {
  const track = state.playback?.track ?? null;
  const durationMs = Math.max(0, Number(track?.durationMs ?? 0));
  if (!Number.isFinite(positionMs)) {
    return 0;
  }

  return Math.max(0, durationMs > 0 ? Math.min(Math.round(positionMs), durationMs) : Math.round(positionMs));
}

function getCurrentTrack() {
  return state.playback?.track ?? null;
}

function getCurrentTranslation() {
  if (state.translation) {
    return state.translation;
  }

  if (!state.aiDraft) {
    return null;
  }

  return {
    spotifyTrackId: state.aiDraft.spotifyTrackId,
    title: state.playback?.track?.title ?? state.aiDraft.spotifyTrackId,
    artist: state.playback?.track?.artist ?? "",
    sourceLanguage: state.aiDraft.sourceLanguage ?? "Unknown",
    targetLanguage: state.aiDraft.targetLanguage ?? "English",
    lines: state.aiDraft.lines.map((line) => ({
      original: line.original,
      translated: line.translated,
      transliteration: line.transliteration ?? "",
      note: line.note ?? "",
      startMs: null,
      endMs: null
    }))
  };
}

function getDisplayProgressMs() {
  const playback = state.playback;
  const track = playback?.track;

  if (!playback || !track) {
    return 0;
  }

  if (!playback.isPlaying) {
    return playback.progressMs ?? 0;
  }

  const elapsed = Math.max(0, state.now - state.lastPlaybackFetchedAt);
  return Math.min((playback.progressMs ?? 0) + elapsed, track.durationMs ?? 0);
}

function normalizeBrowserHost(value) {
  const candidate = normalizeNonEmptyUrl(value);

  if (!candidate) {
    return "";
  }

  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${candidate}`).hostname.toLowerCase();
    } catch {
      return candidate.toLowerCase().replace(/^www\./, "");
    }
  }
}

function hostMatchesHint(host, hintSet) {
  if (!host) {
    return false;
  }

  return Array.from(hintSet).some((hint) => host === hint || host.endsWith(`.${hint}`));
}

function getBrowserSourceClassification(track) {
  const externalUrl = normalizeNonEmptyUrl(track?.externalUrl);
  const hostFromUrl = normalizeBrowserHost(externalUrl);
  const host = normalizeBrowserHost(track?.browserSourceHost) || hostFromUrl;
  const reportedKind = String(track?.browserSourceKind ?? "").trim().toLowerCase();
  const reportedConfidence = Number(track?.browserSourceConfidence);
  const explicitConfidence = Number.isFinite(reportedConfidence) ? reportedConfidence : null;

  let kind = "system";

  if (reportedKind === "player" || hostMatchesHint(host, BROWSER_PLAYER_SOURCE_HOST_HINTS)) {
    kind = "player";
  } else if (reportedKind === "generic" || hostMatchesHint(host, BROWSER_GENERIC_SOURCE_HOST_HINTS)) {
    kind = "generic";
  } else if (reportedKind === "unknown" || externalUrl) {
    kind = "unknown";
  }

  const confidence = explicitConfidence ?? (kind === "player" ? 0.98 : kind === "generic" ? 0.72 : kind === "unknown" ? 0.45 : 1);

  return {
    kind,
    confidence,
    host,
    externalUrl
  };
}

function isHighConfidenceBrowserPlayer(track) {
  const browserSource = getBrowserSourceClassification(track);
  return browserSource.kind === "player" && browserSource.confidence >= BROWSER_SYNC_CONFIDENCE_THRESHOLD;
}

function getBrowserSiteLabel(track) {
  const classification = getBrowserSourceClassification(track);
  const host = classification.host;

  if (!host) {
    return "browser";
  }

  if (hostMatchesHint(host, BROWSER_PLAYER_SOURCE_HOST_HINTS)) {
    if (host.includes("spotify")) {
      return "Spotify Web";
    }

    if (host.includes("music.apple.com")) {
      return "Apple Music";
    }

    if (host.includes("music.youtube.com")) {
      return "YouTube Music";
    }

    if (host.includes("soundcloud")) {
      return "SoundCloud";
    }
  }

  if (hostMatchesHint(host, BROWSER_GENERIC_SOURCE_HOST_HINTS)) {
    return "YouTube";
  }

  return host;
}

function getPlaybackSourceLabel(playback) {
  const deviceName = playback?.deviceName || "";
  const track = playback?.track ?? null;
  const browserSource = getBrowserSourceClassification(track);

  if (browserSource.kind === "player" && browserSource.confidence >= BROWSER_SYNC_CONFIDENCE_THRESHOLD) {
    return `Reading from browser media (${getBrowserSiteLabel(track)})`;
  }

  if (browserSource.kind === "generic") {
    return `Reading from browser tab (${getBrowserSiteLabel(track)})`;
  }

  if (browserSource.kind === "unknown") {
    return "Reading from browser tab";
  }

  if (BROWSER_SOURCE_APPS.has(deviceName)) {
    return `Reading from browser media (${deviceName})`;
  }

  if (deviceName) {
    return `Playing on ${deviceName}`;
  }

  return "Reading from system media";
}

function shouldRenderPlainBrowserTranslation(track) {
  const browserSource = getBrowserSourceClassification(track);

  if (browserSource.kind === "player") {
    return browserSource.confidence < BROWSER_SYNC_CONFIDENCE_THRESHOLD;
  }

  return browserSource.kind === "generic" || browserSource.kind === "unknown";
}

function hasTimedTranslationLines(translation) {
  if (!translation || !Array.isArray(translation.lines) || translation.lines.length === 0) {
    return false;
  }

  return translation.lines.every((line) => typeof line.startMs === "number" && typeof line.endMs === "number");
}

function findActiveLineIndex(progressMs) {
  const translation = getCurrentTranslation();

  if (!translation || !Array.isArray(translation.lines)) {
    return -1;
  }

  let lastTimedIndex = -1;

  for (let index = 0; index < translation.lines.length; index += 1) {
    const line = translation.lines[index];

    if (typeof line.startMs !== "number" || typeof line.endMs !== "number") {
      continue;
    }

    if (progressMs < line.startMs) {
      return lastTimedIndex >= 0 ? lastTimedIndex : -1;
    }

    if (progressMs >= line.startMs && progressMs < line.endMs) {
      return index;
    }

    lastTimedIndex = index;
  }

  return lastTimedIndex;
}

function buildLyricsRowsMarkup(translation, activeIndex) {
  if (!translation || !Array.isArray(translation.lines) || translation.lines.length === 0) {
    return "";
  }

  const rows = [];

  rows.push(`<div class="lyrics-spacer" data-role="lyrics-spacer-top" aria-hidden="true"></div>`);

  translation.lines.forEach((line, index) => {
    const isTimed = typeof line.startMs === "number" && typeof line.endMs === "number";
    const isActive = index === activeIndex;
    const classes = ["line-card"];

    if (isTimed) {
      if (index < activeIndex) {
        classes.push("past");
      } else if (index > activeIndex && activeIndex !== -1) {
        classes.push("upcoming");
      }
    }

    if (isActive) {
      classes.push("active");
    }

    const timeLabel = isTimed
      ? `${formatTime(line.startMs)} - ${formatTime(line.endMs)}`
      : `${index + 1}`;

    rows.push(`
      <div class="${classes.join(" ")}" data-index="${index}" data-has-timing="${isTimed ? "1" : "0"}" data-start-ms="${isTimed ? String(line.startMs) : ""}">
        <div class="line-main">
          <div class="line-active-tag">
            <span class="line-active-bars" aria-hidden="true">
              <span></span><span></span><span></span><span></span>
            </span>
            <span>PLAYING NOW</span>
          </div>
          <p class="line-text">${escapeHtml(line.translated || line.original || "")}</p>
          ${line.original ? `<div class="line-subtitle">${escapeHtml(line.original)}</div>` : ""}
          ${line.transliteration ? `<div class="line-note">${escapeHtml(line.transliteration)}</div>` : ""}
          ${formatTranslationNote(line.note) ? `<div class="line-note">${escapeHtml(formatTranslationNote(line.note))}</div>` : ""}
        </div>
        <div class="line-side">
          <div class="line-time">${escapeHtml(timeLabel)}</div>
          <button class="icon-btn" type="button" data-copy-line="${index}" aria-label="Copy line">C</button>
        </div>
      </div>
    `);
  });

  rows.push(`<div class="lyrics-spacer" data-role="lyrics-spacer-bottom" aria-hidden="true"></div>`);

  return rows.join("");
}

function buildPlainTranslationMarkup(translation, track) {
  const lines = Array.isArray(translation?.lines) ? translation.lines : [];
  const title = translation?.title || track?.title || "Unknown track";
  const artist = translation?.artist || track?.artist || "Unknown artist";
  const sourceLanguage = translation?.sourceLanguage || "Unknown";
  const targetLanguage = translation?.targetLanguage || "English";

  const rows = lines.map((line, index) => {
    const translatedText = line.translated || line.original || "";
    const hasDetails = Boolean(line.original || line.transliteration || line.note);

    return `
      <div class="plain-line-card" data-plain-line="${index}">
        <button class="plain-copy-btn" type="button" data-copy-line="${index}" aria-label="Copy translation">C</button>
        <p class="plain-line-text">${escapeHtml(translatedText)}</p>
        <p class="plain-line-hint" data-role="plain-hint">Click to expand original</p>
        <div class="plain-line-details" data-role="plain-details" hidden>
          ${line.original ? `<p class="plain-line-original">${escapeHtml(line.original)}</p>` : ""}
          ${line.transliteration ? `<p class="plain-line-transliteration">${escapeHtml(line.transliteration)}</p>` : ""}
          ${formatTranslationNote(line.note) ? `<p class="plain-line-note">${escapeHtml(formatTranslationNote(line.note))}</p>` : ""}
          ${!hasDetails ? `<p class="plain-line-note">No extra context yet.</p>` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <section class="plain-translation-shell">
      <div class="plain-translation-header">
        <div class="plain-translation-copy">
          <h2 class="plain-translation-title">${escapeHtml(title)}</h2>
          <div class="plain-translation-meta">
            <span class="plain-translation-artist">${escapeHtml(artist)}</span>
            <span class="plain-translation-dot" aria-hidden="true"></span>
            <div class="plain-translation-langs">
              <span class="plain-translation-pill">${escapeHtml(sourceLanguage)}</span>
              <span class="plain-translation-arrow" aria-hidden="true">→</span>
              <span class="plain-translation-pill plain-translation-pill-accent">${escapeHtml(targetLanguage)}</span>
            </div>
          </div>
        </div>

        <div class="plain-translation-badges">
          <div class="plain-translation-chip">${lines.length} lines</div>
          <div class="plain-translation-chip plain-translation-chip-accent">Reading mode</div>
        </div>
      </div>

      <div class="plain-translation-lines" data-role="plain-translation-lines">
        ${rows}
      </div>
    </section>
  `;
}

function collapsePlainTranslationCards(exceptCard = null) {
  if (!Array.isArray(refs.plainLineCards) || refs.plainLineCards.length === 0) {
    return;
  }

  refs.plainLineCards.forEach((card) => {
    if (exceptCard && card === exceptCard) {
      return;
    }

    card.classList.remove("expanded");

    const details = card.querySelector('[data-role="plain-details"]');
    const hint = card.querySelector('[data-role="plain-hint"]');

    if (details) {
      details.hidden = true;
    }

    if (hint) {
      hint.textContent = "Click to expand original";
    }
  });
}

function togglePlainTranslationCard(card) {
  const shouldExpand = !card.classList.contains("expanded");

  collapsePlainTranslationCards(shouldExpand ? card : null);
  card.classList.toggle("expanded", shouldExpand);

  const details = card.querySelector('[data-role="plain-details"]');
  const hint = card.querySelector('[data-role="plain-hint"]');

  if (details) {
    details.hidden = !shouldExpand;
  }

  if (hint) {
    hint.textContent = shouldExpand ? "Click to hide original" : "Click to expand original";
  }
}

function renderTrackCard() {
  const playback = state.playback;
  const track = playback?.track ?? null;
  const connected = state.desktopConnected;

  if (!track) {
    if (refs.artMedia) {
      refs.artMedia.hidden = true;
      refs.artMedia.style.backgroundImage = "";
    }

    if (refs.artFallback) {
      refs.artFallback.hidden = false;
    }

    updateArtworkGlow(null, false);

    if (refs.artCard) {
      refs.artCard.dataset.playing = "false";
    }

    if (refs.playBadge) {
      refs.playBadge.textContent = connected ? "READY" : "OFF";
    }

    if (refs.trackTitle) {
      refs.trackTitle.textContent = "Play something";
    }

    if (refs.trackArtist) {
      refs.trackArtist.textContent = "Open Spotify or Apple Music";
    }

    if (refs.trackAlbum) {
      refs.trackAlbum.textContent = "Lafz will show live translations as you listen";
    }

    if (refs.playerSource) {
      refs.playerSource.textContent = connected ? "Listening for music…" : "Desktop sync paused";
    }

    if (refs.playButton) {
      refs.playButton.textContent = "▶";
      refs.playButton.disabled = true;
    }

    if (refs.previousButton) {
      refs.previousButton.disabled = true;
    }

    if (refs.nextButton) {
      refs.nextButton.disabled = true;
    }

    if (refs.disconnectLabel) {
      refs.disconnectLabel.textContent = "Disconnect";
    }

    // Hide noisy controls when idle — nothing to interact with
    if (refs.progressSection) refs.progressSection.hidden = true;
    if (refs.controlsSection) refs.controlsSection.hidden = true;
    if (refs.playerFooter) refs.playerFooter.hidden = true;

    return;
  }

  const artwork = normalizeNonEmptyUrl(track.albumArtUrl) ?? normalizeNonEmptyUrl(state.albumArtUrl);
  const hasArtwork = Boolean(artwork);

  if (refs.artMedia) {
    refs.artMedia.hidden = !hasArtwork;
    refs.artMedia.style.backgroundImage = hasArtwork ? `url("${artwork}")` : "";
  }

  if (refs.artFallback) {
    refs.artFallback.hidden = true;
  }

  updateArtworkGlow(artwork, playback.isPlaying);

  // Beat rings — drive CSS animation speed from BPM and sync playing state
  if (refs.artCard) {
    refs.artCard.dataset.playing = playback.isPlaying ? "true" : "false";
    if (playback.isPlaying) {
      const beatMs = Math.max(180, state.artGlowBeatMs || 500);
      refs.artCard.style.setProperty("--beat-ms", `${beatMs}ms`);
    }
  }

  // Restore controls when a track is active
  if (refs.progressSection) refs.progressSection.hidden = false;
  if (refs.controlsSection) refs.controlsSection.hidden = false;
  if (refs.playerFooter) refs.playerFooter.hidden = false;

  if (refs.playBadge) {
    refs.playBadge.textContent = playback.isPlaying ? "PLAYING" : "PAUSED";
  }

  if (refs.trackTitle) {
    refs.trackTitle.textContent = track.title || "Unknown track";
  }

  if (refs.trackArtist) {
    refs.trackArtist.textContent = track.artist || "Unknown artist";
  }

  if (refs.trackAlbum) {
    refs.trackAlbum.textContent = track.album || "Unknown album";
  }

  if (refs.playerSource) {
    refs.playerSource.textContent = connected
      ? getPlaybackSourceLabel(playback)
      : "Desktop sync paused";
  }

  if (refs.playButton) {
    refs.playButton.disabled = false;
    refs.playButton.textContent = playback.isPlaying ? "⏸" : "▶";
  }

  if (refs.previousButton) {
    refs.previousButton.disabled = false;
  }

  if (refs.nextButton) {
    refs.nextButton.disabled = false;
  }

  if (refs.disconnectLabel) {
    refs.disconnectLabel.textContent = "Disconnect";
  }
}

function renderLyricsBody() {
  // Dismiss the loading overlay the first time we have something to show
  hideLoadingOverlay();

  const translation = getCurrentTranslation();
  const track = state.playback?.track ?? null;
  const shouldRenderPlain =
    Boolean(translation && track) && (
      shouldRenderPlainBrowserTranslation(track) ||
      !hasTimedTranslationLines(translation)
    );

  if (translation && track && shouldRenderPlain) {
    refs.lyricsBody.innerHTML = buildPlainTranslationMarkup(translation, track);
    refs.lineCards = [];
    refs.linesList = null;
    refs.lyricsSpacerTop = null;
    refs.lyricsSpacerBottom = null;
    refs.plainLineCards = Array.from(refs.lyricsBody.querySelectorAll(".plain-line-card"));
    state.activeLineIndex = -1;
    return;
  }

  if (!translation || !Array.isArray(translation.lines) || translation.lines.length === 0) {
    const isBrowserSource = Boolean(track?.externalUrl);
    const titleText = track ? (track.title ?? "") : "";
    const artistText = track && track.artist ? track.artist : "";
    const badgeText = isBrowserSource ? "Matched song" : "Working on it";
    const messageText = isBrowserSource
      ? "We found the song in your browser and are checking your Lafz library now."
      : "Translation coming soon — we'll show it here the moment it's ready.";
    const voteSummary = state.songVoteSummary;
    const voteCountText = voteSummary
      ? `${voteSummary.voteCount} ${voteSummary.voteCount === 1 ? "vote" : "votes"}`
      : "Checking votes...";
    const voteButtonLabel = state.songVoteSubmitting
      ? (voteSummary?.hasVoted ? "Removing vote..." : "Saving vote...")
      : voteSummary?.hasVoted
        ? "Remove vote"
        : "Vote for this song";
    const shouldShowVoteControls = state.lastTranslationFetchedAt > 0;

    refs.lyricsBody.innerHTML = track ? `
      <div class="empty-state">
        <div class="no-translation-card">
          <div class="no-translation-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 19V6l12-3v13"/>
              <circle cx="6" cy="19" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
          </div>
          <div class="no-translation-badge"><span class="badge-dot"></span> ${escapeHtml(badgeText)}</div>
          <h2 class="no-translation-title">${escapeHtml(titleText)}</h2>
          ${artistText ? `<div class="no-translation-artist">${escapeHtml(artistText)}</div>` : ""}
          <p class="no-translation-msg">${escapeHtml(messageText)}</p>
          ${shouldShowVoteControls ? `
            <div class="no-translation-vote">
              <button
                class="vote-song-btn"
                type="button"
                data-action="vote-song"
                data-voted="${voteSummary?.hasVoted ? "true" : "false"}"
                ${state.songVoteSubmitting ? "disabled" : ""}
                aria-pressed="${voteSummary?.hasVoted ? "true" : "false"}"
              >
                <span class="vote-song-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 C12 2 13 8.5 15.5 10.5 C17.5 12 22 12 22 12 C22 12 17.5 12 15.5 13.5 C13 15.5 12 22 12 22 C12 22 11 15.5 8.5 13.5 C6.5 12 2 12 2 12 C2 12 6.5 12 8.5 10.5 C11 8.5 12 2 12 2 Z"/></svg></span>
                <span>${escapeHtml(voteButtonLabel)}</span>
              </button>
            </div>
          ` : ""}
        </div>
      </div>
    ` : `
      <div class="empty-state">
        <div class="desktop-loading-wordmark">
          <span class="lafz-l1">l</span><span class="lafz-l2">a</span><span class="lafz-l3">F</span><span class="lafz-l4">z</span>
        </div>
      </div>
    `;
    refs.lineCards = [];
    refs.linesList = null;
    refs.plainLineCards = [];
    return;
  }

  const activeIndex = findActiveLineIndex(getDisplayProgressMs());

  refs.lyricsBody.innerHTML = `
    <div class="lines-list" data-role="lines-list">
      ${buildLyricsRowsMarkup(translation, activeIndex)}
    </div>
  `;

  refs.lineCards = Array.from(refs.lyricsBody.querySelectorAll(".line-card"));
  refs.linesList = refs.lyricsBody.querySelector('[data-role="lines-list"]');
  refs.lyricsSpacerTop = refs.lyricsBody.querySelector('[data-role="lyrics-spacer-top"]');
  refs.lyricsSpacerBottom = refs.lyricsBody.querySelector('[data-role="lyrics-spacer-bottom"]');
  refs.plainLineCards = [];
  updateLyricsCenterSpacers();
  syncActiveLine(activeIndex, { force: true });
}

function syncActiveLine(activeIndex, { force = false } = {}) {
  if (!Array.isArray(refs.lineCards) || refs.lineCards.length === 0) {
    state.activeLineIndex = -1;
    return;
  }

  if (!force && state.activeLineIndex === activeIndex) {
    return;
  }

  state.activeLineIndex = activeIndex;

  refs.lineCards.forEach((card, index) => {
    const isTimed = card.dataset.hasTiming === "1";
    card.classList.toggle("active", index === activeIndex);
    card.classList.toggle("past", isTimed && activeIndex !== -1 && index < activeIndex);
    card.classList.toggle("upcoming", isTimed && activeIndex !== -1 && index > activeIndex);
  });

  updateSectionLabels(activeIndex);
  updateLyricsCenterSpacers();

  const activeCard = activeIndex >= 0 ? refs.lineCards[activeIndex] : null;
  if (activeCard) {
    requestAnimationFrame(() => {
      centerActiveLine(activeCard);
    });
  }
}

function updateSectionLabels(activeIndex) {
  if (!refs.linesList || !Array.isArray(refs.lineCards) || refs.lineCards.length === 0) {
    return;
  }

  refs.linesList.querySelectorAll(".section-label-inline").forEach((label) => label.remove());

  const insertLabelBefore = (labelText, targetCard) => {
    if (!targetCard) {
      return;
    }

    const label = document.createElement("div");
    label.className = "section-label section-label-inline";
    label.textContent = labelText;
    targetCard.before(label);
  };

  if (activeIndex > 0 && refs.lineCards[0]) {
    insertLabelBefore("Earlier", refs.lineCards[0]);
  }

  if (activeIndex >= 0 && refs.lineCards[activeIndex]) {
    insertLabelBefore("Now playing", refs.lineCards[activeIndex]);
  }

  if (activeIndex >= 0 && refs.lineCards[activeIndex + 1]) {
    insertLabelBefore("Coming up", refs.lineCards[activeIndex + 1]);
  }
}

function updateLyricsCenterSpacers() {
  if (!refs.lyricsBody || !Array.isArray(refs.lineCards) || refs.lineCards.length === 0) {
    return;
  }

  const containerHeight = refs.lyricsBody.clientHeight || 0;
  const activeCard = state.activeLineIndex >= 0 ? refs.lineCards[state.activeLineIndex] ?? null : null;
  const activeHeight = activeCard?.offsetHeight || 0;
  const spacerHeight = Math.max(260, Math.round(containerHeight * 0.62) + Math.round(activeHeight * 0.15));

  if (refs.lyricsSpacerTop) {
    refs.lyricsSpacerTop.style.height = `${spacerHeight}px`;
  }

  if (refs.lyricsSpacerBottom) {
    refs.lyricsSpacerBottom.style.height = `${spacerHeight}px`;
  }
}

function centerActiveLine(card) {
  const container = refs.lyricsBody;
  if (!container || !card) {
    return;
  }

  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const targetTop = card.offsetTop - ((container.clientHeight - card.offsetHeight) / 2);
  const clampedTop = Math.max(0, Math.min(targetTop, maxScrollTop));

  container.scrollTop = clampedTop;
}

function updateProgressUI() {
  const playback = state.playback;
  const track = playback?.track ?? null;

  const duration = Math.max(track?.durationMs ?? 0, 0);
  const progress = getDisplayProgressMs();
  const safeDuration = duration > 0 ? duration : 1;
  const percentage = Math.min(100, Math.max(0, (progress / safeDuration) * 100));

  if (refs.progressCurrent) {
    refs.progressCurrent.textContent = formatTime(progress);
  }

  if (refs.progressTotal) {
    refs.progressTotal.textContent = formatTime(duration);
  }

  if (refs.progressFill) {
    refs.progressFill.style.width = `${percentage}%`;
  }

  if (refs.progressKnob) {
    refs.progressKnob.style.left = `${percentage}%`;
  }

  if (refs.playButton && track) {
    refs.playButton.textContent = playback.isPlaying ? "⏸" : "▶";
  }

  syncActiveLine(findActiveLineIndex(progress));
}

function updateOfflineBanner() {
  if (!refs.offlineBanner) {
    return;
  }

  if (!state.bannerText) {
    refs.offlineBanner.hidden = true;
    refs.offlineBanner.textContent = "";
    return;
  }

  refs.offlineBanner.hidden = false;
  refs.offlineBanner.textContent = state.bannerText;
}

function schedulePlaybackRefresh(delayMs) {
  const timer = window.setTimeout(() => {
    playbackRefreshTimers.delete(timer);
    void refreshPlayback();
  }, delayMs);

  playbackRefreshTimers.add(timer);
  return timer;
}

function burstRefreshPlayback() {
  [0, 40, 100, 220, 420].forEach((delayMs) => schedulePlaybackRefresh(delayMs));
}

function seekPlaybackToPosition(positionMs) {
  const clampedPosition = clampSeekPosition(positionMs);
  const controlPromise = invokePlaybackControl("seek", { position_ms: clampedPosition });

  state.lastPlaybackFetchedAt = 0;
  burstRefreshPlayback();

  return controlPromise
    .then(() => null)
    .catch((error) => {
      state.bannerText = formatPlaybackControlError(error);
      renderStaticPanels();
      return null;
    });
}

function buildArtworkResolveUrl(track) {
  const params = new URLSearchParams();

  if (track.spotifyTrackId) {
    params.set("trackId", track.spotifyTrackId);
  }

  if (track.title) {
    params.set("title", track.title);
  }

  if (track.artist) {
    params.set("artist", track.artist);
  }

  if (track.album) {
    params.set("album", track.album);
  }

  if (track.externalUrl) {
    params.set("externalUrl", track.externalUrl);
  }

  return `${readApiBaseUrl()}/api/desktop/art/resolve?${params.toString()}`;
}

function parseRgbColor(value) {
  const parts = String(value ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));

  if (parts.length !== 3) {
    return [255, 20, 100];
  }

  return parts.map((part) => Math.max(0, Math.min(255, Math.round(part))));
}

function setArtworkGlowColor(rgb) {
  if (!refs.artCard || !refs.artBeatGlow) {
    return;
  }

  const [r, g, b] = parseRgbColor(rgb);
  state.artGlowColor = [r, g, b];
  refs.artCard.style.setProperty("--art-glow-r", String(r));
  refs.artCard.style.setProperty("--art-glow-g", String(g));
  refs.artCard.style.setProperty("--art-glow-b", String(b));
  applyArtworkGlowStyle();
}

function setArtworkGlowPulse(active, progressMs = 0) {
  if (!refs.artBeatGlow) {
    return;
  }

  const beatMs = Math.max(180, state.artGlowBeatMs || 500);
  // t: position within current beat, 0 → 1
  const t = (progressMs % beatMs) / beatMs;
  const sine = Math.sin(t * Math.PI * 2);

  // ── Background glow blob (smooth sine) ───────────────────────────────
  const pulse = active ? 0.82 + (sine * 0.24) : 0.28;
  const scale = active ? 0.975 + (sine * 0.025) : 0.95;
  state.artGlowPulse = Math.max(0.12, pulse);
  refs.artBeatGlow.style.opacity = String(pulse);
  refs.artBeatGlow.style.transform = `scale(${scale})`;
  refs.artCard?.style.setProperty("--art-glow-ring-opacity", String(active ? 0.96 + (Math.max(0, sine) * 0.18) : 0.52));
  applyArtworkGlowStyle();


}

function applyArtworkGlowStyle() {
  if (!refs.artCard) {
    return;
  }

  refs.artCard.style.boxShadow = "";
}

async function updateArtworkGlow(artworkUrl, active) {
  if (!artworkUrl) {
    setArtworkGlowColor("255,20,100");
    setArtworkGlowPulse(active, getDisplayProgressMs());
    return;
  }

  const requestId = ++state.artworkThemeRequestId;

  if (state.artworkThemeKey === artworkUrl) {
    setArtworkGlowPulse(active, getDisplayProgressMs());
    return;
  }

  state.artworkThemeKey = artworkUrl;
  setArtworkGlowColor("255,20,100");
  setArtworkGlowPulse(active, getDisplayProgressMs());

  if (state.artworkThemePollInFlight) {
    return;
  }

  state.artworkThemePollInFlight = true;

  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = artworkUrl;
    await image.decode().catch(() => null);

    const canvas = document.createElement("canvas");
    const size = 12;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      throw new Error("No canvas context.");
    }

    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let totalWeight = 0;
    let red = 0;
    let green = 0;
    let blue = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3] / 255;
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const vibrancy = Math.max(0.18, chroma / 255);
      const weight = Math.max(0.08, luminance) * (0.58 + vibrancy) * a;
      red += r * weight;
      green += g * weight;
      blue += b * weight;
      totalWeight += weight;
    }

    if (requestId !== state.artworkThemeRequestId) {
      return;
    }

    if (totalWeight > 0) {
      const rawRed = red / totalWeight;
      const rawGreen = green / totalWeight;
      const rawBlue = blue / totalWeight;
      const boost = 0.10;
      const color = [
        rawRed * (1 - boost) + 255 * boost,
        rawGreen * (1 - boost) + 20 * boost,
        rawBlue * (1 - boost) + 100 * boost
      ];
      setArtworkGlowColor(`${color[0]},${color[1]},${color[2]}`);
    }
  } catch {
    if (requestId !== state.artworkThemeRequestId) {
      return;
    }

    setArtworkGlowColor("255,20,100");
  } finally {
    if (requestId === state.artworkThemeRequestId) {
      state.artworkThemePollInFlight = false;
      setArtworkGlowPulse(active, getDisplayProgressMs());
    }
  }
}

function renderStatus() {
  const playback = state.playback;
  const track = playback?.track ?? null;

  if (!state.desktopConnected) {
    setStatus("offline", "Desktop sync disconnected");
    return;
  }

  if (state.bannerText) {
    setStatus("offline", "Offline");
    return;
  }

  if (!track) {
    setStatus("idle", playback?.deviceName ? `Reading from ${playback.deviceName}` : "No active playback");
    return;
  }

  setStatus("ready", playback.isPlaying ? "Desktop sync ready" : "Paused but synced");
}

function renderChrome() {
  renderTrackCard();
  renderStatus();
  updateOfflineBanner();
  updateProgressUI();
}

function renderStaticPanels() {
  renderTrackCard();
  renderStatus();
  updateOfflineBanner();
}

function readApiBaseUrl() {
  return state.apiBaseUrl || DEFAULT_API_BASE_URL;
}

function readSupabaseBaseUrl() {
  return state.supabaseUrl?.trim() || "";
}

function readSupabaseAnonKey() {
  return state.supabaseAnonKey?.trim() || "";
}

function normalizeNonEmptyUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatTranslationNote(note) {
  if (typeof note !== "string") {
    return null;
  }

  let text = note.normalize("NFKC").replace(/\s+/g, " ").trim();

  if (!text) {
    return null;
  }

  text = text
    .replace(
      /^\s*(?:generator\s+[ab]|gemini|openai)(?:['’]s)?(?:\s+(?:interpretation|reading|take|use|choice|version|draft|explanation|note))?(?:\s+of)?\s*/i,
      ""
    )
    .replace(/^\s*(?:this\s+means|note:)\s*/i, "")
    .replace(/\b(?:generator\s+[ab]|gemini|openai)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const interpretationMatch = text.match(/^(?:[“"']?)(.+?)(?:[”"']?)\s+(?:as|means|is)\s+(?:[“"']?)(.+?)(?:[”"']?)(?:[.!?]\s*|$)/i);

  if (interpretationMatch?.[1] && interpretationMatch?.[2]) {
    const term = interpretationMatch[1].trim();
    const meaning = interpretationMatch[2].trim().replace(/[.!?]+$/, "");
    text = `“${term}” means “${meaning}”`;
  }

  text = text.replace(/^[\s\-–—:]+/, "").trim();

  if (!text) {
    return null;
  }

  if (!/[.!?]$/.test(text)) {
    text += ".";
  }

  if (text.length > 180) {
    const sentenceMatch = text.match(/^.+?[.!?](?=\s|$)/);
    if (sentenceMatch?.[0]) {
      text = sentenceMatch[0];
    } else {
      text = text.slice(0, 177).trimEnd() + "…";
    }
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sanitizeTrackTranslationPayload(translation) {
  if (!isTrackTranslationLike(translation)) {
    return translation;
  }

  return {
    ...translation,
    lines: translation.lines.map((line) => ({
      ...line,
      note: formatTranslationNote(line.note) ?? undefined
    }))
  };
}

function normalizeEmailAddress(value) {
  const trimmed = normalizeNonEmptyUrl(value);
  return trimmed ? trimmed.toLowerCase() : "";
}

function desktopAuthHeaders(accessToken) {
  const supabaseAnonKey = readSupabaseAnonKey();
  const bearer = normalizeNonEmptyUrl(accessToken) ?? supabaseAnonKey;

  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${bearer}`,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

function normalizeDesktopAuthSession(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const accessToken = typeof value.accessToken === "string" ? value.accessToken.trim() : "";
  const refreshToken = typeof value.refreshToken === "string" ? value.refreshToken.trim() : "";
  const expiresAt = Number.parseInt(String(value.expiresAt ?? ""), 10);
  const user = value.user && typeof value.user === "object" ? value.user : null;
  const userId = typeof user?.id === "string" ? user.id.trim() : "";
  const email = typeof user?.email === "string" ? user.email.trim() : "";

  if (!accessToken || !refreshToken || !userId || !Number.isFinite(expiresAt)) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: {
      id: userId,
      email,
      aud: typeof user?.aud === "string" ? user.aud : "",
      role: typeof user?.role === "string" ? user.role : ""
    }
  };
}

function readStoredDesktopAuthSession() {
  try {
    const raw = window.localStorage.getItem(DESKTOP_AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return normalizeDesktopAuthSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredDesktopAuthSession(session) {
  if (!session) {
    return;
  }

  window.localStorage.setItem(DESKTOP_AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredDesktopAuthSession() {
  window.localStorage.removeItem(DESKTOP_AUTH_STORAGE_KEY);
}

function readStoredDesktopLocation() {
  try {
    const raw = window.localStorage.getItem(DESKTOP_LOCATION_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const cachedAt = Number(payload.cachedAt ?? 0);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > DESKTOP_LOCATION_CACHE_TTL_MS) {
      return null;
    }

    const country = typeof payload.country === "string" ? payload.country.trim() : "";
    const city = typeof payload.city === "string" ? payload.city.trim() : "";
    if (!country && !city) {
      return null;
    }

    return {
      country: country || null,
      city: city || null
    };
  } catch {
    return null;
  }
}

function writeStoredDesktopLocation(geo) {
  try {
    window.localStorage.setItem(
      DESKTOP_LOCATION_CACHE_KEY,
      JSON.stringify({
        country: typeof geo?.country === "string" ? geo.country : "",
        city: typeof geo?.city === "string" ? geo.city : "",
        cachedAt: Date.now()
      })
    );
  } catch {
    // Ignore cache write failures.
  }
}

async function resolveDesktopLocation() {
  const cached = readStoredDesktopLocation();
  if (cached) {
    return cached;
  }

  if (tauriInvoke) {
    try {
      const payload = await tauriInvoke("desktop_lookup_location");
      const country = typeof payload?.country === "string" ? payload.country.trim() : "";
      const city = typeof payload?.city === "string" ? payload.city.trim() : "";

      if (country || city) {
        const geo = {
          country: country || null,
          city: city || null
        };
        writeStoredDesktopLocation(geo);
        return geo;
      }
    } catch {
      // Fall through to the browser-based fallback below.
    }
  }

  const services = [
    "https://ipwho.is/?output=json",
    "https://ipapi.co/json/"
  ];

  for (const serviceUrl of services) {
    try {
      const response = await fetch(serviceUrl, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }

      const payload = await response.json().catch(() => null);
      const country = typeof payload?.country_name === "string" && payload.country_name.trim()
        ? payload.country_name.trim()
        : typeof payload?.country === "string" && payload.country.trim()
          ? payload.country.trim()
          : "";
      const city = typeof payload?.city === "string" && payload.city.trim()
        ? payload.city.trim()
        : "";

      if (country || city) {
        const geo = {
          country: country || null,
          city: city || null
        };
        writeStoredDesktopLocation(geo);
        return geo;
      }
    } catch {
      // Try the next provider.
    }
  }

  return null;
}

function readDesktopAccessToken() {
  return state.desktopAuthSession?.accessToken?.trim() || "";
}

function isDesktopAuthSessionExpiring(session) {
  if (!session || typeof session.expiresAt !== "number") {
    return true;
  }

  return Date.now() + DESKTOP_AUTH_REFRESH_BUFFER_MS >= session.expiresAt;
}

async function desktopAuthFetch(path, { method = "POST", body, accessToken } = {}) {
  const supabaseUrl = readSupabaseBaseUrl();
  const supabaseAnonKey = readSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase runtime config is unavailable.");
  }

  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    cache: "no-store",
    headers: desktopAuthHeaders(accessToken),
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof payload?.msg === "string"
      ? payload.msg
      : typeof payload?.message === "string"
        ? payload.message
      : typeof payload?.error_description === "string"
        ? payload.error_description
        : typeof payload?.error === "string"
          ? payload.error
          : `Authentication request failed (${response.status}).`;

    throw new Error(message);
  }

  return payload;
}

async function sendDesktopAuthCode(email) {
  return desktopAuthFetch("/auth/v1/otp", {
    body: {
      email,
      create_user: true
    }
  });
}

async function verifyDesktopAuthCode(email, code) {
  const payload = await desktopAuthFetch("/auth/v1/verify", {
    body: {
      email,
      token: code,
      type: "email"
    }
  });

  const normalized = normalizeDesktopAuthSession({
    accessToken: payload?.access_token,
    refreshToken: payload?.refresh_token,
    expiresAt: Date.now() + Number(payload?.expires_in ?? 0) * 1000,
    user: payload?.user
  });

  if (!normalized) {
    throw new Error("Supabase did not return a usable session.");
  }

  return normalized;
}

async function refreshDesktopAuthSession(session) {
  const payload = await desktopAuthFetch("/auth/v1/token?grant_type=refresh_token", {
    body: {
      refresh_token: session.refreshToken
    }
  });

  const normalized = normalizeDesktopAuthSession({
    accessToken: payload?.access_token,
    refreshToken: payload?.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + Number(payload?.expires_in ?? 0) * 1000,
    user: payload?.user ?? session.user
  });

  if (!normalized) {
    throw new Error("Supabase session refresh failed.");
  }

  return normalized;
}

async function fetchDesktopAccessProfile(session) {
  const supabaseUrl = readSupabaseBaseUrl();
  const accessToken = session?.accessToken?.trim() || "";

  if (!supabaseUrl || !accessToken || !session?.user?.id) {
    return null;
  }

  const url = new URL("/rest/v1/lafz_app_profiles", supabaseUrl);
  url.searchParams.set("select", "id,email,display_name,can_access_lafz,is_admin,updated_at");
  url.searchParams.set("id", `eq.${session.user.id}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: desktopAuthHeaders(accessToken)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load Lafz access profile (${response.status}).`);
  }

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;

  if (!row) {
    return null;
  }

  return {
    id: typeof row.id === "string" ? row.id : session.user.id,
    email: typeof row.email === "string" ? row.email : session.user.email,
    displayName: typeof row.display_name === "string" ? row.display_name : "",
    canAccessLafz: Boolean(row.can_access_lafz),
    isAdmin: Boolean(row.is_admin),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : ""
  };
}

function normalizeDesktopAdminTarget(row) {
  return {
    email: normalizeEmailAddress(row?.email),
    displayName: typeof row?.display_name === "string" ? row.display_name.trim() : "",
    canAccessLafz: Boolean(row?.can_access_lafz),
    isAdmin: Boolean(row?.is_admin),
    hasProfile: Boolean(row?.has_profile),
    createdAt: typeof row?.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : "",
    lastSeenAt: typeof row?.last_seen_at === "string" ? row.last_seen_at : "",
    lastSeenCountry: typeof row?.last_seen_country === "string" ? row.last_seen_country : "",
    lastSeenCity: typeof row?.last_seen_city === "string" ? row.last_seen_city : "",
    inviteCreatedAt: typeof row?.invite_created_at === "string" ? row.invite_created_at : "",
    inviteUpdatedAt: typeof row?.invite_updated_at === "string" ? row.invite_updated_at : ""
  };
}

function formatDesktopLastSeenLocation(profile) {
  const city = typeof profile?.lastSeenCity === "string" ? profile.lastSeenCity.trim() : "";
  const country = typeof profile?.lastSeenCountry === "string" ? profile.lastSeenCountry.trim() : "";
  const location = [city, country].filter(Boolean).join(", ");

  if (location) {
    return location;
  }

  return "";
}

function formatDesktopLastSeenAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return date.toLocaleString("en-IN");
  }
}

function renderDesktopAdminMessage(message) {
  if (!refs.adminMessage) {
    return;
  }

  const text = typeof message === "string" ? message.trim() : "";

  if (!text) {
    refs.adminMessage.hidden = true;
    refs.adminMessage.textContent = "";
    return;
  }

  refs.adminMessage.hidden = false;
  refs.adminMessage.textContent = text;
}

function setDesktopAdminMessage(message) {
  state.desktopAdminMessage = typeof message === "string" ? message : "";
  renderDesktopAdminMessage(state.desktopAdminMessage);
}

function setDesktopAdminBusy(isBusy) {
  state.desktopAdminBusy = Boolean(isBusy);

  if (refs.adminEmail) {
    refs.adminEmail.disabled = state.desktopAdminBusy;
  }

  if (refs.adminList) {
    refs.adminList.querySelectorAll("[data-action='admin-toggle-access']").forEach((button) => {
      button.disabled = state.desktopAdminBusy;
    });
  }

  appRoot.querySelectorAll("[data-action='admin-grant'], [data-action='admin-revoke'], [data-action='admin-refresh']").forEach((button) => {
    button.disabled = state.desktopAdminBusy;
  });
}

function renderDesktopAdminList() {
  if (!refs.adminList) {
    return;
  }

  if (!Array.isArray(state.desktopAdminProfiles) || state.desktopAdminProfiles.length === 0) {
    refs.adminList.innerHTML = `
      <div class="admin-empty">
        <div class="admin-empty-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg>
        </div>
        <div class="admin-empty-text">No users yet. Add an email above to invite someone.</div>
      </div>
    `;
    return;
  }

  refs.adminList.innerHTML = state.desktopAdminProfiles.map((profile) => {
    // Status chip — only show access state, not "Admin" (admin gets its own chip)
    const statusLabel = profile.canAccessLafz
      ? profile.hasProfile ? "Active" : "Invite ready"
      : profile.hasProfile ? "Waitlist" : "Invite saved";
    const statusClass = profile.canAccessLafz ? "enabled" : profile.hasProfile ? "waitlist" : "pending";
    const actionLabel = profile.canAccessLafz ? "Revoke" : "Grant";
    const initials = (profile.displayName || profile.email || "?").slice(0, 1).toUpperCase() || "?";
    // Show display name as title if available, otherwise email; only show email row when it differs from title
    const nameText = profile.displayName || profile.email || "Unknown user";
    const showEmailRow = Boolean(profile.displayName && profile.email);
    // Only show meta if they haven't signed in yet
    const showMeta = !profile.hasProfile;
    const lastSeenText = formatDesktopLastSeenAt(profile.lastSeenAt);
    const locationText = formatDesktopLastSeenLocation(profile);

    return `
      <div class="admin-row">
        <div class="admin-row-avatar">${escapeHtml(initials)}</div>
        <div class="admin-row-copy">
          <div class="admin-row-topline">
            <span class="admin-row-name">${escapeHtml(nameText)}</span>
            <span class="admin-chip ${statusClass}">${escapeHtml(statusLabel)}</span>
            ${profile.isAdmin ? `<span class="admin-chip accent">Admin</span>` : ""}
          </div>
          ${showEmailRow ? `<div class="admin-row-email">${escapeHtml(profile.email)}</div>` : ""}
          ${showMeta
            ? `<div class="admin-row-meta">Pending first sign-in</div>`
            : lastSeenText
              ? `<div class="admin-row-meta">Last seen ${escapeHtml(lastSeenText)} IST${locationText ? ` · ${escapeHtml(locationText)}` : ""}</div>`
              : ""}
        </div>
        <button class="admin-row-btn" type="button" data-action="admin-toggle-access" data-email="${escapeHtml(profile.email)}" data-next-access="${profile.canAccessLafz ? "false" : "true"}">
          ${escapeHtml(actionLabel)}
        </button>
      </div>
    `;
  }).join("");
}

async function loadDesktopAdminProfiles(force = false) {
  if (!state.desktopAuthProfile?.isAdmin) {
    return;
  }

  const supabaseUrl = readSupabaseBaseUrl();
  const accessToken = readDesktopAccessToken();

  if (!supabaseUrl || !accessToken) {
    setDesktopAdminMessage("Supabase runtime config is unavailable.");
    return;
  }

  if (state.desktopAdminBusy && !force) {
    return;
  }

  try {
    setDesktopAdminBusy(true);
    const payload = await desktopAuthFetch("/rest/v1/rpc/list_lafz_admin_access_targets", {
      accessToken,
      body: {}
    });

    state.desktopAdminProfiles = Array.isArray(payload)
      ? payload.map(normalizeDesktopAdminTarget)
      : [];
    renderDesktopAdminList();
    if (!state.desktopAdminMessage) {
      renderDesktopAdminMessage("");
    }
  } catch (error) {
    setDesktopAdminMessage(error instanceof Error ? error.message : "Unable to load admin access targets.");
    state.desktopAdminProfiles = [];
    renderDesktopAdminList();
  } finally {
    setDesktopAdminBusy(false);
  }
}

async function handleDesktopAdminAccessChange(canAccess, emailOverride = "") {
  const email = normalizeEmailAddress(emailOverride || refs.adminEmail?.value || state.desktopAdminTargetEmail);

  if (!email) {
    setDesktopAdminMessage("Enter an email address first.");
    return;
  }

  const accessToken = readDesktopAccessToken();

  if (!accessToken) {
    setDesktopAdminMessage("Sign in again to continue.");
    return;
  }

  try {
    setDesktopAdminBusy(true);
    const payload = await desktopAuthFetch("/rest/v1/rpc/set_lafz_access_by_email", {
      accessToken,
      body: {
        target_email: email,
        can_access: Boolean(canAccess)
      }
    });

    const profileFound = Boolean(payload?.profileFound);
    const label = canAccess ? "granted" : "revoked";
    setDesktopAdminMessage(
      canAccess
        ? profileFound
          ? `Access granted for ${email}.`
          : `Invite saved for ${email}. They’ll unlock on first sign-in.`
        : profileFound
          ? `Access revoked for ${email}.`
          : `Invite removed for ${email}.`
    );

    state.desktopAdminTargetEmail = email;
    if (refs.adminEmail) {
      refs.adminEmail.value = email;
    }

    await loadDesktopAdminProfiles(true);
    if (!state.desktopAdminMessage) {
      setDesktopAdminMessage(`Access ${label} for ${email}.`);
    }
  } catch (error) {
    setDesktopAdminMessage(error instanceof Error ? error.message : "Unable to update access.");
  } finally {
    setDesktopAdminBusy(false);
  }
}

function handleDesktopAdminListClick(event) {
  const button = event.target.closest("[data-action='admin-toggle-access']");
  if (!button) {
    return;
  }

  const email = normalizeEmailAddress(button.dataset.email);
  const nextAccess = button.dataset.nextAccess === "true";

  if (!email) {
    return;
  }

  void handleDesktopAdminAccessChange(nextAccess, email);
}

async function saveDesktopDisplayName(displayName) {
  const supabaseUrl = readSupabaseBaseUrl();
  const accessToken = readDesktopAccessToken();
  const cleanedName = typeof displayName === "string" ? displayName.trim() : "";

  if (!supabaseUrl || !accessToken) {
    throw new Error("Supabase runtime config is unavailable.");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/set_lafz_display_name`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: readSupabaseAnonKey(),
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ display_name: cleanedName })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.msg === "string"
        ? payload.msg
        : `Unable to save your name (${response.status}).`;

    throw new Error(message);
  }

  return payload;
}

async function touchDesktopLastSeen(session = state.desktopAuthSession) {
  const accessToken = session?.accessToken?.trim() || "";

  if (!accessToken) {
    return null;
  }

  try {
    const geo = await resolveDesktopLocation();
    const response = await desktopAuthFetch("/rest/v1/rpc/touch_lafz_last_seen", {
      accessToken,
      body: {
        p_last_seen_country: geo?.country ?? "",
        p_last_seen_city: geo?.city ?? ""
      }
    });

    return response ?? null;
  } catch {
    return null;
  }
}

async function restoreDesktopAuthSession() {
  const storedSession = readStoredDesktopAuthSession();

  if (!storedSession) {
    state.desktopAuthSession = null;
    state.desktopAuthProfile = null;
    state.desktopAuthStatus = "signed_out";
    state.desktopAuthMessage = "";
    state.desktopAuthEmail = "";
    state.desktopAuthCode = "";
    state.desktopAuthCodeSent = false;
    return { allowed: false, reason: "signed_out" };
  }

  let session = storedSession;

  try {
    if (isDesktopAuthSessionExpiring(session)) {
      session = await refreshDesktopAuthSession(session);
      writeStoredDesktopAuthSession(session);
    }
  } catch (error) {
    clearStoredDesktopAuthSession();
    state.desktopAuthSession = null;
    state.desktopAuthProfile = null;
    state.desktopAuthStatus = "signed_out";
    state.desktopAuthMessage = error instanceof Error ? error.message : "Sign in again to continue.";
    return { allowed: false, reason: "expired", error };
  }

  try {
    await touchDesktopLastSeen(session);
    const profile = await fetchDesktopAccessProfile(session);

    state.desktopAuthSession = session;
    state.desktopAuthProfile = profile;
    state.desktopAuthEmail = session.user.email || profile?.email || "";
    state.desktopAuthName = profile?.displayName || state.desktopAuthName || "";
    state.desktopAuthCode = "";
    state.desktopAuthCodeSent = false;

    if (!profile?.canAccessLafz) {
      state.desktopAuthStatus = "locked";
      state.desktopAuthMessage = profile?.displayName
        ? "You’re on the list. We’ll enable your access shortly."
        : "You’re on the list. Add your name so we can keep your invite ready.";
      return { allowed: false, reason: "locked", profile };
    }

    state.desktopAuthStatus = "allowed";
    state.desktopAuthMessage = "";
    return { allowed: true, profile, session };
  } catch (error) {
    clearStoredDesktopAuthSession();
    state.desktopAuthSession = null;
    state.desktopAuthProfile = null;
    state.desktopAuthStatus = "signed_out";
    state.desktopAuthMessage = error instanceof Error ? error.message : "Sign in again to continue.";
    return { allowed: false, reason: "error", error };
  }
}

function isTrackTranslationLike(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.spotifyTrackId === "string" &&
    typeof value.title === "string" &&
    typeof value.artist === "string" &&
    Array.isArray(value.lines)
  );
}

async function loadRuntimeConfig() {
  if (!tauriInvoke) {
    state.apiBaseUrl = DEFAULT_API_BASE_URL;
    state.supabaseUrl = "";
    state.supabaseAnonKey = "";
    state.runtimeReady = false;
    state.bannerText = "Tauri bridge not available. The desktop shell is running in fallback mode.";
    return;
  }

  try {
    const runtime = await tauriInvoke("desktop_runtime_config");
    const apiBaseUrl = typeof runtime?.apiBaseUrl === "string" && runtime.apiBaseUrl.trim()
      ? runtime.apiBaseUrl.trim().replace(/\/$/, "")
      : DEFAULT_API_BASE_URL;
    const supabaseUrl = typeof runtime?.supabaseUrl === "string" && runtime.supabaseUrl.trim()
      ? runtime.supabaseUrl.trim().replace(/\/$/, "")
      : "";
    const supabaseAnonKey = typeof runtime?.supabaseAnonKey === "string" && runtime.supabaseAnonKey.trim()
      ? runtime.supabaseAnonKey.trim()
      : "";
    const appVersion = typeof runtime?.appVersion === "string" ? runtime.appVersion.trim() : "";

    state.apiBaseUrl = apiBaseUrl;
    state.supabaseUrl = supabaseUrl;
    state.supabaseAnonKey = supabaseAnonKey;
    state.desktopAppVersion = appVersion;
    state.desktopUpdateConfigured = Boolean(runtime?.updaterConfigured);
    state.desktopUpdateChecking = false;
    state.desktopUpdateAvailable = false;
    state.desktopUpdateInstalling = false;
    state.desktopUpdateCurrentVersion = appVersion;
    state.desktopUpdateLatestVersion = "";
    state.desktopUpdatePublishedAt = "";
    state.desktopUpdateMessage = "";
    state.runtimeReady = true;
    state.bannerText = "";
  } catch (error) {
    state.apiBaseUrl = DEFAULT_API_BASE_URL;
    state.supabaseUrl = "";
    state.supabaseAnonKey = "";
    state.desktopAppVersion = "";
    state.desktopUpdateConfigured = false;
    state.desktopUpdateChecking = false;
    state.desktopUpdateAvailable = false;
    state.desktopUpdateInstalling = false;
    state.desktopUpdateCurrentVersion = "";
    state.desktopUpdateLatestVersion = "";
    state.desktopUpdatePublishedAt = "";
    state.desktopUpdateMessage = "";
    state.runtimeReady = false;
    state.bannerText = error instanceof Error ? error.message : "Unable to read desktop runtime config.";
  }
}

async function checkDesktopUpdate({ silent = false } = {}) {
  if (!tauriInvoke || !state.desktopUpdateConfigured) {
    syncDesktopUpdateControls();
    return null;
  }

  state.desktopUpdateChecking = true;
  if (!silent) {
    state.desktopUpdateMessage = "Checking for updates...";
  }
  syncDesktopUpdateControls();

  try {
    const result = await tauriInvoke("desktop_check_update");

    state.desktopUpdateConfigured = Boolean(result?.configured);
    state.desktopUpdateAvailable = Boolean(result?.available);
    state.desktopUpdateCurrentVersion = typeof result?.currentVersion === "string" ? result.currentVersion : state.desktopUpdateCurrentVersion;
    state.desktopUpdateLatestVersion = typeof result?.latestVersion === "string" ? result.latestVersion : "";
    state.desktopUpdatePublishedAt = typeof result?.publishedAt === "string" ? result.publishedAt : "";
    state.desktopUpdateMessage = typeof result?.message === "string" ? result.message : "";

    return result;
  } catch (error) {
    state.desktopUpdateAvailable = false;
    state.desktopUpdateMessage = error instanceof Error ? error.message : "Unable to check for updates.";
    if (!silent) {
      state.bannerText = state.desktopUpdateMessage;
      updateOfflineBanner();
    }
    return null;
  } finally {
    state.desktopUpdateChecking = false;
    syncDesktopUpdateControls();
  }
}

async function installDesktopUpdate() {
  if (!tauriInvoke || !state.desktopUpdateConfigured || state.desktopUpdateInstalling) {
    return;
  }

  state.desktopUpdateInstalling = true;
  state.desktopUpdateMessage = "Installing update...";
  syncDesktopUpdateControls();

  try {
    await tauriInvoke("desktop_install_update");
  } catch (error) {
    state.desktopUpdateInstalling = false;
    state.desktopUpdateMessage = error instanceof Error ? error.message : "Unable to install the update.";
    syncDesktopUpdateControls();
    state.bannerText = state.desktopUpdateMessage;
    updateOfflineBanner();
  }
}

async function handleDesktopUpdateClick() {
  if (!state.desktopUpdateConfigured || state.desktopUpdateInstalling || state.desktopUpdateChecking) {
    return;
  }

  if (state.desktopUpdateAvailable) {
    await installDesktopUpdate();
    return;
  }

  await checkDesktopUpdate();
}

function buildBackendTranslationUrl(track) {
  const params = new URLSearchParams();
  if (track.spotifyTrackId) {
    params.set("trackId", track.spotifyTrackId);
  }
  if (track.title) {
    params.set("title", track.title);
  }
  if (track.artist) {
    params.set("artist", track.artist);
  }
  if (track.album) {
    params.set("album", track.album);
  }

  return `${readApiBaseUrl()}/api/desktop/translation/resolve?${params.toString()}`;
}

function normalizeBrowserTitleCandidate(value) {
  return String(value ?? "")
    .replace(/^\(\s*\d+\s*\)\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\s(?:[-–—]|[|•·])\s(?:YouTube Music|YouTube|Spotify Web|Apple Music|SoundCloud|Google Search)$/i, "")
    .replace(/\((?:[^()]|\([^()]*\))*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:official(?:\s+music)?\s+video|official\s+audio|audio|video|lyrics?|visualizer|topic|mv)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBrowserLookupText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeBrowserLooseTitle(value) {
  return normalizeBrowserLookupText(
    String(value ?? "")
      .replace(/^\(\s*\d+\s*\)\s*/, "")
      .replace(/\((?:[^()]|\([^()]*\))*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s(?:[-–—]|[|•·:])\s.*$/, " ")
      .replace(/\b(?:feat|ft|featuring)\b.*$/i, " ")
  );
}

function normalizeBrowserLooseArtist(value) {
  return normalizeBrowserLookupText(
    String(value ?? "")
      .replace(/\b(?:feat|ft|featuring|with)\b.*$/i, " ")
      .replace(/[()/\[\]{}]/g, " ")
  );
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function scoreBrowserTitleMatch(targetTitle, translationTitle) {
  const normalizedTargetTitle = normalizeBrowserLookupText(targetTitle);
  const normalizedTranslationTitle = normalizeBrowserLookupText(translationTitle);

  if (!normalizedTargetTitle || !normalizedTranslationTitle) {
    return null;
  }

  if (normalizedTargetTitle === normalizedTranslationTitle) {
    return 100;
  }

  const looseTargetTitle = normalizeBrowserLooseTitle(targetTitle);
  const looseTranslationTitle = normalizeBrowserLooseTitle(translationTitle);

  if (!looseTargetTitle || !looseTranslationTitle) {
    return null;
  }

  if (looseTargetTitle === looseTranslationTitle) {
    return 92;
  }

  if (looseTargetTitle.includes(looseTranslationTitle) || looseTranslationTitle.includes(looseTargetTitle)) {
    const shorterLength = Math.min(looseTargetTitle.length, looseTranslationTitle.length);
    const longerLength = Math.max(looseTargetTitle.length, looseTranslationTitle.length);
    const overlapRatio = longerLength > 0 ? shorterLength / longerLength : 0;

    if (overlapRatio >= 0.8) {
      return 88;
    }

    if (overlapRatio >= 0.65) {
      return 82;
    }

    return 74;
  }

  return null;
}

function scoreBrowserArtistMatch(targetArtist, translationArtist) {
  const normalizedTargetArtist = normalizeBrowserLooseArtist(targetArtist);
  const normalizedTranslationArtist = normalizeBrowserLooseArtist(translationArtist);

  if (!normalizedTargetArtist || !normalizedTranslationArtist) {
    return null;
  }

  if (normalizedTargetArtist === normalizedTranslationArtist) {
    return 100;
  }

  const targetTokens = new Set(normalizedTargetArtist.split(/\s+/).filter(Boolean));
  const translationTokens = normalizedTranslationArtist.split(/\s+/).filter(Boolean);
  const overlap = translationTokens.filter((token) => targetTokens.has(token)).length;

  if (overlap === 0) {
    return null;
  }

  const overlapRatio = overlap / Math.max(targetTokens.size, translationTokens.length);

  if (overlapRatio >= 0.8) {
    return 92;
  }

  if (overlapRatio >= 0.5) {
    return 80;
  }

  return 68;
}

function buildBrowserTranslationTitleCandidates(track) {
  const seen = new Set();
  const candidates = [];

  function pushCandidate(value) {
    const candidate = normalizeBrowserTitleCandidate(value);
    if (!candidate) {
      return;
    }

    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  const baseTitle = normalizeBrowserTitleCandidate(track?.title ?? "");
  if (baseTitle) {
    pushCandidate(baseTitle);

    const primarySegment = baseTitle
      .split(/\s(?:[-–—]|[|•·])\s|\sby\s/i)
      .map((segment) => segment.trim())
      .filter(Boolean)[0];

    if (primarySegment) {
      pushCandidate(primarySegment);

      const words = primarySegment.split(/\s+/).filter(Boolean);
      const maxWindow = Math.min(words.length, 8);

      for (let length = maxWindow; length >= 1; length -= 1) {
        pushCandidate(words.slice(0, length).join(" "));
      }
    }

    const segments = baseTitle
      .split(/\s(?:[-–—]|[|•·])\s|\sby\s/i)
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments.slice(1)) {
      pushCandidate(segment);
    }
  }

  return candidates;
}

function getPlaybackIdentityKey(track) {
  if (!track) {
    return "";
  }

  const trackId = typeof track.spotifyTrackId === "string" ? track.spotifyTrackId : "";
  if (trackId.startsWith("browser:")) {
    return [
      trackId,
      normalizeBrowserTitleCandidate(track.title ?? ""),
      normalizeBrowserTitleCandidate(track.externalUrl ?? "")
    ].filter(Boolean).join("|");
  }

  return trackId || `${track.title ?? ""}:${track.artist ?? ""}:${track.album ?? ""}`;
}

function buildSongVoteKey(track) {
  if (!track) {
    return "";
  }

  const title = normalizeBrowserTitleCandidate(track.title ?? "");
  const artist = normalizeBrowserLooseArtist(track.artist ?? "");
  const album = normalizeBrowserLookupText(track.album ?? "");
  const metadataParts = [title, artist, album].filter(Boolean);

  if (metadataParts.length > 0) {
    return metadataParts.join("|");
  }

  const trackId = typeof track.spotifyTrackId === "string" ? track.spotifyTrackId.trim() : "";
  if (trackId) {
    return trackId;
  }

  return normalizeBrowserLookupText(track.externalUrl ?? "");
}

async function fetchDesktopSupabaseRpc(rpcName, body) {
  const supabaseUrl = readSupabaseBaseUrl();
  const accessToken = readDesktopAccessToken();
  const supabaseAnonKey = readSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    return null;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    cache: "no-store",
    headers: desktopAuthHeaders(accessToken),
    body: JSON.stringify(body)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Lafz needs to be signed in before voting.");
  }

  if (!response.ok) {
    throw new Error(`Song vote request failed (${response.status}).`);
  }

  return response.json().catch(() => null);
}

async function fetchSongVoteSummary(track) {
  const songKey = buildSongVoteKey(track);
  if (!songKey) {
    return null;
  }

  const payload = await fetchDesktopSupabaseRpc("get_lafz_song_vote_summary", {
    p_song_key: songKey
  });

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const voteCount = Number(payload.voteCount ?? payload.vote_count ?? 0);

  return {
    songKey,
    voteCount: Number.isFinite(voteCount) ? Math.max(0, Math.floor(voteCount)) : 0,
    hasVoted: Boolean(payload.hasVoted ?? payload.has_voted)
  };
}

async function castSongVote(track) {
  const songKey = buildSongVoteKey(track);
  if (!songKey) {
    throw new Error("Song vote lookup failed.");
  }

  const payload = await fetchDesktopSupabaseRpc("cast_lafz_song_vote", {
    p_song_key: songKey,
    p_spotify_track_id: typeof track?.spotifyTrackId === "string" ? track.spotifyTrackId : "",
    p_song_title: typeof track?.title === "string" ? track.title : "",
    p_song_artist: typeof track?.artist === "string" ? track.artist : "",
    p_song_album: typeof track?.album === "string" ? track.album : ""
  });

  if (!payload || typeof payload !== "object") {
    return {
      songKey,
      voteCount: 0,
      hasVoted: true
    };
  }

  const voteCount = Number(payload.voteCount ?? payload.vote_count ?? 0);

  return {
    songKey,
    voteCount: Number.isFinite(voteCount) ? Math.max(0, Math.floor(voteCount)) : 0,
    hasVoted: Boolean(payload.hasVoted ?? payload.has_voted ?? true),
    created: Boolean(payload.created ?? payload.created_vote ?? true)
  };
}

async function removeSongVote(track) {
  const songKey = buildSongVoteKey(track);
  if (!songKey) {
    throw new Error("Song vote lookup failed.");
  }

  const payload = await fetchDesktopSupabaseRpc("remove_lafz_song_vote", {
    p_song_key: songKey,
    p_spotify_track_id: typeof track?.spotifyTrackId === "string" ? track.spotifyTrackId : "",
    p_song_title: typeof track?.title === "string" ? track.title : "",
    p_song_artist: typeof track?.artist === "string" ? track.artist : "",
    p_song_album: typeof track?.album === "string" ? track.album : ""
  });

  if (!payload || typeof payload !== "object") {
    return {
      songKey,
      voteCount: 0,
      hasVoted: false,
      removed: true
    };
  }

  const voteCount = Number(payload.voteCount ?? payload.vote_count ?? 0);

  return {
    songKey,
    voteCount: Number.isFinite(voteCount) ? Math.max(0, Math.floor(voteCount)) : 0,
    hasVoted: Boolean(payload.hasVoted ?? payload.has_voted ?? false),
    removed: Boolean(payload.removed ?? payload.removed_vote ?? true)
  };
}

async function fetchTranslationFromSupabase(track) {
  const supabaseUrl = readSupabaseBaseUrl();
  const accessToken = readDesktopAccessToken();
  const supabaseAnonKey = readSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey || !accessToken || !track.spotifyTrackId) {
    return null;
  }

  async function requestPublishedTranslation(includeAlbumArt) {
    const url = new URL("/rest/v1/published_translations", supabaseUrl);
    url.searchParams.set(
      "select",
      includeAlbumArt ? "spotify_track_id,translation_json,album_art_url,updated_at" : "spotify_track_id,translation_json,updated_at"
    );
    url.searchParams.set("spotify_track_id", `eq.${track.spotifyTrackId}`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error("Supabase read access to published translations is not enabled yet.");
    }

    if (!response.ok) {
      if (includeAlbumArt && response.status === 400) {
        return { fallback: true };
      }

      throw new Error(`Supabase translation lookup failed (${response.status}).`);
    }

    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row?.translation_json || !isTrackTranslationLike(row.translation_json)) {
      return null;
    }

    return {
      translation: sanitizeTrackTranslationPayload(row.translation_json),
      aiDraft: null,
      albumArtUrl: typeof row.album_art_url === "string" && row.album_art_url.trim().length > 0
        ? row.album_art_url.trim()
        : null,
      source: "supabase"
    };
  }

  const primary = await requestPublishedTranslation(true);
  if (primary && !primary.fallback) {
    return primary;
  }

  const fallback = await requestPublishedTranslation(false);
  if (fallback && !fallback.fallback) {
    return fallback;
  }

  return null;
}

async function fetchArtworkFromSupabase(track) {
  const supabaseUrl = readSupabaseBaseUrl();
  const accessToken = readDesktopAccessToken();
  const supabaseAnonKey = readSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey || !accessToken || !track.spotifyTrackId) {
    return null;
  }

  const url = new URL("/rest/v1/published_translations", supabaseUrl);
  url.searchParams.set("select", "spotify_track_id,album_art_url,updated_at");
  url.searchParams.set("spotify_track_id", `eq.${track.spotifyTrackId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

  if (response.status === 404) {
    return null;
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Supabase read access to published translations is not enabled yet.");
  }

  if (!response.ok) {
    if (response.status === 400) {
      return null;
    }

    throw new Error(`Supabase artwork lookup failed (${response.status}).`);
  }

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;

  return normalizeNonEmptyUrl(row?.album_art_url);
}

async function fetchTranslationFromBackend(track) {
  const response = await fetch(buildBackendTranslationUrl(track), {
    method: "GET",
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }

    throw new Error(payload?.error || "Unable to load translation.");
  }

  if (!payload?.translation && !payload?.aiDraft) {
    return null;
  }

  return {
    translation: payload.translation ? sanitizeTrackTranslationPayload(payload.translation) : null,
    aiDraft: payload.aiDraft ?? null,
    albumArtUrl: typeof payload.albumArtUrl === "string" && payload.albumArtUrl.trim().length > 0
      ? payload.albumArtUrl.trim()
      : null,
    source: "backend"
  };
}

function getBrowserTranslationCandidates(track) {
  const seen = new Set();
  const candidates = [];

  const push = (value) => {
    const candidate = normalizeBrowserTitleCandidate(value);
    if (!candidate) {
      return;
    }

    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(candidate);
  };

  const baseTitle = normalizeBrowserTitleCandidate(track?.title ?? "");
  if (!baseTitle) {
    return candidates;
  }

  push(baseTitle);

  const segments = baseTitle
    .split(/\s(?:[-–—]|[|•·])\s|\sby\s/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length > 0) {
    push(segments[0]);

    const firstSegmentWords = segments[0].split(/\s+/).filter(Boolean);
    for (let length = firstSegmentWords.length; length >= 1; length -= 1) {
      push(firstSegmentWords.slice(0, length).join(" "));
    }
  }

  for (const segment of segments.slice(1)) {
    push(segment);
  }

  return candidates;
}

async function fetchBrowserTranslationFromSupabase(track) {
  const supabaseUrl = readSupabaseBaseUrl();
  const accessToken = readDesktopAccessToken();
  const supabaseAnonKey = readSupabaseAnonKey();
  const candidates = getBrowserTranslationCandidates(track);
  const targetArtist = normalizeBrowserLooseArtist(track?.artist ?? "");
  const browserSource = getBrowserSourceClassification(track);
  const strictMode = browserSource.kind !== "player" || browserSource.confidence < BROWSER_SYNC_CONFIDENCE_THRESHOLD;
  const allowLooseTitleMatching = Boolean(targetArtist);

  if (!supabaseUrl || !supabaseAnonKey || !accessToken || candidates.length === 0) {
    return null;
  }

  if (!targetArtist) {
    return null;
  }

  async function requestBrowserRows(includeIdentityColumns) {
    const url = new URL("/rest/v1/published_translations", supabaseUrl);
    url.searchParams.set(
      "select",
      includeIdentityColumns
        ? "spotify_track_id,translation_json,canonical_title,canonical_artist,alternate_titles,source_host,match_confidence,album_art_url,updated_at"
        : "spotify_track_id,translation_json,album_art_url,updated_at"
    );
    url.searchParams.set("limit", "2000");

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (response.status === 404) {
      return { rows: [] };
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error("Supabase read access to published translations is not enabled yet.");
    }

    if (!response.ok) {
      if (includeIdentityColumns && response.status === 400) {
        return { fallback: true };
      }

      throw new Error(`Supabase browser translation lookup failed (${response.status}).`);
    }

    const rows = await response.json().catch(() => []);
    return { rows: Array.isArray(rows) ? rows : [] };
  }

  const primary = await requestBrowserRows(true);
  const list = !primary.fallback ? primary.rows : (await requestBrowserRows(false)).rows;
  const scoredMatches = [];

  for (const row of list) {
    const translation = row?.translation_json;
    const rowTitles = [
      typeof row?.canonical_title === "string" ? row.canonical_title.trim() : "",
      typeof translation?.title === "string" ? translation.title.trim() : "",
      ...asStringArray(row?.alternate_titles)
    ].filter(Boolean);
    const rowArtists = [
      typeof row?.canonical_artist === "string" ? row.canonical_artist.trim() : "",
      typeof translation?.artist === "string" ? translation.artist.trim() : ""
    ].filter(Boolean);

    if (rowTitles.length === 0) {
      continue;
    }

    let rowBestScore = null;
    for (const candidate of candidates) {
      for (const rowTitle of rowTitles) {
        const score = strictMode
          ? (normalizeBrowserLookupText(candidate) === normalizeBrowserLookupText(rowTitle) ? 100 : null)
          : (allowLooseTitleMatching
            ? scoreBrowserTitleMatch(candidate, rowTitle)
            : (normalizeBrowserLookupText(candidate) === normalizeBrowserLookupText(rowTitle) ? 100 : null));
        if (score === null) {
          continue;
        }

        let artistScore = null;
        if (targetArtist) {
          for (const rowArtist of rowArtists) {
            const candidateArtistScore = scoreBrowserArtistMatch(targetArtist, rowArtist);
            if (candidateArtistScore !== null && (artistScore === null || candidateArtistScore > artistScore)) {
              artistScore = candidateArtistScore;
            }
          }

          if (artistScore === null) {
            continue;
          }
        }

        const totalScore = score + (artistScore ?? 0);
        if (rowBestScore === null || totalScore > rowBestScore) {
          rowBestScore = totalScore;
        }
      }
    }

    if (rowBestScore === null) {
      continue;
    }

    scoredMatches.push({
      score: rowBestScore,
      payload: {
        translation: sanitizeTrackTranslationPayload(translation),
        aiDraft: null,
        albumArtUrl: typeof row?.album_art_url === "string" && row.album_art_url.trim().length > 0
          ? row.album_art_url.trim()
          : null,
        source: "supabase"
      }
    });
  }

  if (scoredMatches.length === 0) {
    return null;
  }

  const topScore = Math.max(...scoredMatches.map((entry) => entry.score));
  const topMatches = scoredMatches.filter((entry) => entry.score === topScore);

  if (topMatches.length !== 1) {
    return null;
  }

  return topMatches[0].payload;
}

async function resolveTranslation(track) {
  try {
    const trackId = typeof track.spotifyTrackId === "string" ? track.spotifyTrackId : "";
    const isSyntheticBrowserTrack = trackId.startsWith("browser:");
    const isWindowsSyntheticTrack = trackId.startsWith("windows:");
    const browserSource = isSyntheticBrowserTrack ? getBrowserSourceClassification(track) : null;

    if (!isSyntheticBrowserTrack) {
      const exactMatch = await fetchTranslationFromSupabase(track);
      if (exactMatch) {
        return exactMatch;
      }

      if (track.title && track.artist) {
        const metadataMatch = await fetchTranslationFromBackend(track).catch(() => null);
        if (metadataMatch) {
          return metadataMatch;
        }
      }

      if (isWindowsSyntheticTrack && track.title && track.artist) {
        const metadataMatch = await fetchTranslationFromBackend(track).catch(() => null);
        if (metadataMatch) {
          return metadataMatch;
        }
      }

      return null;
    }

    if (isSyntheticBrowserTrack) {
      const browserSupabaseMatch = await fetchBrowserTranslationFromSupabase(track);
      if (browserSupabaseMatch) {
        return browserSupabaseMatch;
      }

      const browserArtist = normalizeBrowserLooseArtist(track.artist ?? "");
      if (browserSource?.kind === "player" && browserSource.confidence >= BROWSER_SYNC_CONFIDENCE_THRESHOLD && browserArtist) {
        const browserTitleCandidates = buildBrowserTranslationTitleCandidates(track);

        for (const title of browserTitleCandidates) {
          const candidateMatch = await fetchTranslationFromBackend({
            ...track,
            title,
            artist: track.artist ?? ""
          }).catch(() => null);

          if (candidateMatch) {
            return candidateMatch;
          }
        }

        const metadataMatch = await fetchTranslationFromBackend(track).catch(() => null);
        if (metadataMatch) {
          return metadataMatch;
        }
      }

      return null;
    }

    const metadataMatch = await fetchTranslationFromBackend(track).catch(() => null);
    if (metadataMatch) {
      return metadataMatch;
    }

    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Supabase read access")) {
      throw error;
    }

    throw error;
  }
}

function renderAuthMessage(message) {
  if (!refs.authMessage) {
    return;
  }

  const text = typeof message === "string" ? message.trim() : "";

  if (!text) {
    refs.authMessage.hidden = true;
    refs.authMessage.textContent = "";
    return;
  }

  refs.authMessage.hidden = false;
  refs.authMessage.textContent = text;
}

function setAuthMessage(message) {
  state.desktopAuthMessage = typeof message === "string" ? message : "";
  renderAuthMessage(state.desktopAuthMessage);
}

function setAuthFormBusy(isBusy) {
  state.desktopAuthBusy = isBusy;

  if (refs.authSubmit) {
    refs.authSubmit.disabled = isBusy;
    refs.authSubmit.textContent = getAuthSubmitLabel();
  }

  if (refs.authReset) {
    refs.authReset.disabled = isBusy;
  }

  if (refs.authEmail) {
    refs.authEmail.disabled = isBusy;
  }

  if (refs.authCode) {
    refs.authCode.disabled = isBusy;
  }

  if (refs.authName) {
    refs.authName.disabled = isBusy;
  }

  if (refs.authNameSave) {
    refs.authNameSave.disabled = isBusy;
  }

  if (!isBusy) {
    syncAuthCooldownTicker();
  }
}

async function ensureDesktopAuthSession() {
  if (state.desktopAuthStatus !== "allowed") {
    return false;
  }

  if (!state.desktopAuthSession) {
    const restored = await restoreDesktopAuthSession();
    return restored.allowed;
  }

  if (!isDesktopAuthSessionExpiring(state.desktopAuthSession)) {
    return true;
  }

  try {
    state.desktopAuthSession = await refreshDesktopAuthSession(state.desktopAuthSession);
    writeStoredDesktopAuthSession(state.desktopAuthSession);
    state.desktopAuthProfile = await fetchDesktopAccessProfile(state.desktopAuthSession);
    if (!state.desktopAuthProfile?.canAccessLafz) {
      state.desktopAuthStatus = "locked";
      state.desktopAuthMessage = state.desktopAuthProfile?.displayName
        ? "You’re on the list. We’ll enable your access shortly."
        : "You’re on the list. Add your name so we can keep your invite ready.";
      return false;
    }
    return true;
  } catch (error) {
    clearStoredDesktopAuthSession();
    state.desktopAuthSession = null;
    state.desktopAuthProfile = null;
    state.desktopAuthStatus = "signed_out";
    setAuthMessage(error instanceof Error ? error.message : "Please sign in again.");
    return false;
  }
}

function stopDesktopRuntime() {
  if (playbackRefreshIntervalId !== null) {
    window.clearInterval(playbackRefreshIntervalId);
    playbackRefreshIntervalId = null;
  }

  if (clockRefreshIntervalId !== null) {
    window.clearInterval(clockRefreshIntervalId);
    clockRefreshIntervalId = null;
  }

  playbackRefreshTimers.forEach((timer) => window.clearTimeout(timer));
  playbackRefreshTimers.clear();
  state.desktopRuntimeStarted = false;
  state.desktopShellBuilt = false;

  if (authCooldownIntervalId !== null) {
    window.clearInterval(authCooldownIntervalId);
    authCooldownIntervalId = null;
  }
}

function showLoadingOverlay() {
  if (document.getElementById("lafz-loading-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "lafz-loading-overlay";
  overlay.innerHTML = `
    <div class="desktop-loading-wordmark">
      <span class="lafz-l1">l</span><span class="lafz-l2">a</span><span class="lafz-l3">F</span><span class="lafz-l4">z</span>
    </div>
  `;
  document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("lafz-loading-overlay");
  if (!overlay || overlay.classList.contains("lafz-overlay-hiding")) return;
  overlay.classList.add("lafz-overlay-hiding");
  setTimeout(() => overlay.remove(), 420);
}

function startDesktopRuntime() {
  if (state.desktopRuntimeStarted) {
    return;
  }

  state.desktopRuntimeStarted = true;
  state.desktopShellBuilt = false;
  state.bannerText = "";
  showLoadingOverlay();
  buildShell();
  bootstrapShellRefs();
  renderChrome();
  if (state.desktopAuthSession) {
    void touchDesktopLastSeen(state.desktopAuthSession);
  }
  void refreshPlayback();

  playbackRefreshIntervalId = window.setInterval(() => {
    void refreshPlayback();
  }, DESKTOP_POLL_INTERVAL_MS);

  clockRefreshIntervalId = window.setInterval(updateClock, DESKTOP_CLOCK_TICK_MS);

  if (!desktopRuntimeListenersAttached) {
    window.addEventListener("focus", () => {
      if (state.desktopAuthStatus === "allowed") {
        if (state.desktopAuthSession) {
          void touchDesktopLastSeen(state.desktopAuthSession);
        }
        void refreshPlayback();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.desktopAuthStatus === "allowed") {
        if (state.desktopAuthSession) {
          void touchDesktopLastSeen(state.desktopAuthSession);
        }
        void refreshPlayback();
      }
    });

    desktopRuntimeListenersAttached = true;
  }
}

async function handleAuthSubmit() {
  const email = normalizeEmailAddress(refs.authEmail?.value);
  const code = normalizeNonEmptyUrl(refs.authCode?.value);

  if (!email) {
    setAuthMessage("Enter your email address.");
    return;
  }

  if (!state.desktopAuthCodeSent) {
    try {
      setAuthFormBusy(true);
      await sendDesktopAuthCode(email);
      state.desktopAuthResendCooldownUntil = Date.now() + DESKTOP_AUTH_RESEND_COOLDOWN_MS;
      state.desktopAuthEmail = email;
      state.desktopAuthCodeSent = true;
      state.desktopAuthCode = "";
      setAuthMessage(`8-digit code sent to ${email}.`);
      buildAuthGate();
      refs.authCode?.focus();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not send the sign-in code.";
      const normalized = detail.toLowerCase();

      if (normalized.includes("rate limit") || normalized.includes("too many") || normalized.includes("too soon")) {
        state.desktopAuthResendCooldownUntil = Date.now() + DESKTOP_AUTH_RESEND_COOLDOWN_MS;
        setAuthMessage("Supabase asked us to slow down. Please wait 60 seconds before requesting another code.");
        buildAuthGate();
      } else {
        setAuthMessage(detail);
      }
    } finally {
      setAuthFormBusy(false);
    }
    return;
  }

  if (!code) {
    setAuthMessage("Enter the 8-digit code from your email.");
    return;
  }

  try {
    setAuthFormBusy(true);
    const session = await verifyDesktopAuthCode(email, code);
    writeStoredDesktopAuthSession(session);
    state.desktopAuthSession = session;
    state.desktopAuthEmail = email;
    state.desktopAuthCode = "";
    const access = await restoreDesktopAuthSession();
    if (!access.allowed) {
      state.desktopAuthStatus = "locked";
      state.desktopAuthMessage = state.desktopAuthProfile?.displayName
        ? "You’re on the list. We’ll enable your access shortly."
        : "You’re on the list. Add your name so we can keep your invite ready.";
      buildAuthGate();
      return;
    }

    stopDesktopRuntime();
    startDesktopRuntime();
  } catch (error) {
    setAuthMessage(error instanceof Error ? error.message : "Could not verify the code.");
  } finally {
    setAuthFormBusy(false);
  }
}

async function handleAuthNameSave() {
  const name = normalizeNonEmptyUrl(refs.authName?.value);
  if (!name) {
    setAuthMessage("Enter your name so we can keep your invite ready.");
    return;
  }

  try {
    setAuthFormBusy(true);
    await saveDesktopDisplayName(name);
    state.desktopAuthName = name;
    if (state.desktopAuthProfile) {
      state.desktopAuthProfile = {
        ...state.desktopAuthProfile,
        displayName: name
      };
    }
    state.desktopAuthMessage = "Thanks — we’ve saved your name. We’ll keep your invite ready while desktop access is being enabled.";
    const access = await restoreDesktopAuthSession();
    if (access.allowed) {
      stopDesktopRuntime();
      startDesktopRuntime();
      return;
    }
    buildAuthGate();
  } catch (error) {
    setAuthMessage(error instanceof Error ? error.message : "Could not save your name.");
  } finally {
    setAuthFormBusy(false);
  }
}

function handleAuthReset() {
  state.desktopAuthEmail = "";
  state.desktopAuthCode = "";
  state.desktopAuthCodeSent = false;
  state.desktopAuthProfile = null;
  state.desktopAuthName = "";
  state.desktopAdminProfiles = [];
  state.desktopAdminTargetEmail = "";
  state.desktopAdminMessage = "";
  state.desktopAdminBusy = false;
  state.desktopAuthBusy = false;
  state.songVoteRequestId += 1;
  state.songVoteSummary = null;
  state.songVoteKey = "";
  state.lastVoteFetchedAt = 0;
  state.songVoteSubmitting = false;
  setAuthMessage("");
  buildAuthGate();
}

function handleAuthSignOut() {
  clearStoredDesktopAuthSession();
  state.desktopAuthSession = null;
  state.desktopAuthProfile = null;
  state.desktopAuthName = "";
  state.desktopAdminProfiles = [];
  state.desktopAdminTargetEmail = "";
  state.desktopAdminMessage = "";
  state.desktopAdminBusy = false;
  state.desktopAuthStatus = "signed_out";
  state.desktopAuthEmail = "";
  state.desktopAuthCode = "";
  state.desktopAuthCodeSent = false;
  state.desktopAuthBusy = false;
  state.bannerText = "";
  state.playback = null;
  state.translation = null;
  state.aiDraft = null;
  state.albumArtUrl = null;
  state.songVoteRequestId += 1;
  state.songVoteSummary = null;
  state.songVoteKey = "";
  state.lastVoteFetchedAt = 0;
  state.songVoteSubmitting = false;
  stopDesktopRuntime();
  buildAuthGate();
}

async function refreshTranslation(force = false) {
  const playback = state.playback;
  const track = playback?.track ?? null;

  if (!track) {
    state.translation = null;
    state.aiDraft = null;
    state.translationKey = "";
    state.lastTranslationFetchedAt = 0;
    renderLyricsBody();
    renderChrome();
    return;
  }

  const translationKey = getPlaybackIdentityKey(track);
  const now = Date.now();

  if (!force && state.translationKey === translationKey && now - state.lastTranslationFetchedAt < DESKTOP_TRANSLATION_REFRESH_MS) {
    return;
  }

  if (state.translationPollInFlight) {
    return;
  }

  state.translationPollInFlight = true;
  const requestId = ++state.translationRequestId;

  try {
    const payload = await resolveTranslation(track);

    if (requestId !== state.translationRequestId) {
      return;
    }

    if (!payload) {
      state.translation = null;
      state.aiDraft = null;
      state.translationKey = translationKey;
      state.lastTranslationFetchedAt = now;
      state.bannerText = "";
      renderLyricsBody();
      renderChrome();
      void refreshSongVoteSummary(true);
      return;
    }

    state.translation = payload.translation ?? null;
    state.aiDraft = payload.aiDraft ?? null;
    if (typeof payload.albumArtUrl === "string" && payload.albumArtUrl.trim().length > 0) {
      state.albumArtUrl = payload.albumArtUrl.trim();
    }
    state.songVoteSummary = null;
    state.songVoteKey = "";
    state.lastVoteFetchedAt = 0;
    state.translationKey = translationKey;
    state.lastTranslationFetchedAt = now;
    state.bannerText = "";

    renderLyricsBody();
    renderChrome();
  } catch (error) {
    if (requestId !== state.translationRequestId) {
      return;
    }

    state.translation = null;
    state.aiDraft = null;
    state.translationKey = translationKey;
    state.lastTranslationFetchedAt = now;
    state.bannerText = "";
    state.songVoteSummary = null;
    state.songVoteKey = "";
    state.lastVoteFetchedAt = 0;
    renderLyricsBody();
    renderChrome();
  } finally {
    state.translationPollInFlight = false;
  }
}

async function refreshSongVoteSummary(force = false) {
  const playback = state.playback;
  const track = playback?.track ?? null;

  if (!track || state.translation || state.aiDraft) {
    state.songVoteSummary = null;
    state.songVoteKey = "";
    state.lastVoteFetchedAt = 0;
    return;
  }

  const songKey = buildSongVoteKey(track);
  const now = Date.now();

  if (!songKey) {
    state.songVoteSummary = null;
    state.songVoteKey = "";
    state.lastVoteFetchedAt = 0;
    return;
  }

  if (!force && state.songVoteKey === songKey && now - state.lastVoteFetchedAt < 30_000) {
    return;
  }

  if (state.songVotePollInFlight) {
    return;
  }

  state.songVotePollInFlight = true;
  const requestId = ++state.songVoteRequestId;

  try {
    const summary = await fetchSongVoteSummary(track);

    if (requestId !== state.songVoteRequestId) {
      return;
    }

    state.songVoteSummary = summary ?? {
      songKey,
      voteCount: 0,
      hasVoted: false
    };
    state.songVoteKey = songKey;
    state.lastVoteFetchedAt = now;
    renderLyricsBody();
  } catch {
    if (requestId !== state.songVoteRequestId) {
      return;
    }

    state.songVoteSummary = {
      songKey,
      voteCount: 0,
      hasVoted: false
    };
    state.songVoteKey = songKey;
    state.lastVoteFetchedAt = now;
    renderLyricsBody();
  } finally {
    state.songVotePollInFlight = false;
  }
}

async function handleSongVote() {
  const playback = state.playback;
  const track = playback?.track ?? null;

  if (!track || state.songVoteSubmitting) {
    return;
  }

  if (state.translation || state.aiDraft) {
    return;
  }

  try {
    state.songVoteSubmitting = true;
    renderLyricsBody();

    const result = state.songVoteSummary?.hasVoted
      ? await removeSongVote(track)
      : await castSongVote(track);
    const songKey = result.songKey || buildSongVoteKey(track);

    state.songVoteSummary = {
      songKey,
      voteCount: result.voteCount,
      hasVoted: Boolean(result.hasVoted)
    };
    state.songVoteKey = songKey;
    state.lastVoteFetchedAt = Date.now();
    renderLyricsBody();
  } catch (error) {
    state.bannerText = error instanceof Error ? error.message : "Could not save your vote.";
    updateOfflineBanner();
  } finally {
    state.songVoteSubmitting = false;
    renderLyricsBody();
  }
}

async function refreshArtwork(force = false) {
  const playback = state.playback;
  const track = playback?.track ?? null;

  if (!track) {
    state.albumArtUrl = null;
    state.artworkKey = "";
    state.lastArtworkFetchedAt = 0;
    renderTrackCard();
    return;
  }

  const artworkKey = getPlaybackIdentityKey(track);
  const now = Date.now();

  const trackArtUrl = normalizeNonEmptyUrl(track.albumArtUrl);
  if (trackArtUrl) {
    state.albumArtUrl = trackArtUrl;
    state.artworkKey = artworkKey;
    state.lastArtworkFetchedAt = now;
    renderTrackCard();
    return;
  }

  const cachedArtUrl = normalizeNonEmptyUrl(state.albumArtUrl);
  if (cachedArtUrl) {
    state.artworkKey = artworkKey;
    state.lastArtworkFetchedAt = now;
    renderTrackCard();
    return;
  }

  if (!force && state.artworkKey === artworkKey && now - state.lastArtworkFetchedAt < 15 * 60_000) {
    return;
  }

  if (state.artworkPollInFlight) {
    return;
  }

  state.artworkPollInFlight = true;
  const requestId = ++state.artworkRequestId;

  try {
    const supabaseArtUrl = await fetchArtworkFromSupabase(track).catch(() => null);

    if (requestId !== state.artworkRequestId) {
      return;
    }

    if (supabaseArtUrl) {
      state.albumArtUrl = supabaseArtUrl;
      state.artworkKey = artworkKey;
      state.lastArtworkFetchedAt = now;
      renderTrackCard();
      return;
    }

    const response = await fetch(buildArtworkResolveUrl(track), {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json"
      }
    });

    const payload = await response.json().catch(() => null);

    if (requestId !== state.artworkRequestId) {
      return;
    }

    if (!response.ok) {
      if (response.status === 404) {
        state.albumArtUrl = null;
        state.artworkKey = artworkKey;
        state.lastArtworkFetchedAt = now;
        renderTrackCard();
        return;
      }

      state.albumArtUrl = null;
      state.artworkKey = artworkKey;
      state.lastArtworkFetchedAt = now;
      renderTrackCard();
      return;
    }

    const albumArtUrl = normalizeNonEmptyUrl(payload?.albumArtUrl);

    state.albumArtUrl = albumArtUrl;
    state.artworkKey = artworkKey;
    state.lastArtworkFetchedAt = now;
    renderTrackCard();
  } catch (error) {
    if (requestId !== state.artworkRequestId) {
      return;
    }

    state.albumArtUrl = null;
    state.artworkKey = artworkKey;
    state.lastArtworkFetchedAt = now;
    renderTrackCard();
  } finally {
    state.artworkPollInFlight = false;
  }
}

async function refreshPlayback() {
  if (!tauriInvoke || state.playbackPollInFlight || !state.desktopConnected) {
    return;
  }

  if (!(await ensureDesktopAuthSession())) {
    state.playback = null;
    state.lastTrackKey = "";
    state.translation = null;
    state.aiDraft = null;
    state.albumArtUrl = null;
    state.translationKey = "";
    state.artworkKey = "";
    renderAuthMessage(state.desktopAuthMessage);
    if (state.desktopRuntimeStarted) {
      stopDesktopRuntime();
      buildAuthGate();
    }
    return;
  }

  state.playbackPollInFlight = true;

  try {
    const playback = await tauriInvoke("desktop_now_playing");

    const trackKey = getPlaybackIdentityKey(playback?.track ?? null);
    const trackChanged = trackKey !== state.lastTrackKey;

    state.playback = playback;
    state.lastPlaybackFetchedAt = Date.now();
    state.bannerText = "";

    if (trackChanged) {
      state.lastTrackKey = trackKey;
      state.translation = null;
      state.aiDraft = null;
      state.albumArtUrl = null;
      state.translationKey = "";
      state.lastTranslationFetchedAt = 0;
      state.artworkKey = "";
      state.lastArtworkFetchedAt = 0;
      state.songVoteRequestId += 1;
      state.songVoteSummary = null;
      state.songVoteKey = "";
      state.lastVoteFetchedAt = 0;
      state.songVoteSubmitting = false;
      state.activeLineIndex = -1;
      renderLyricsBody();
      renderTrackCard();
      renderChrome();
      void refreshTranslation(true);
      void refreshArtwork(true);
    } else if (trackKey) {
      void refreshTranslation(false);
      void refreshArtwork(false);
    } else {
      state.translation = null;
      state.aiDraft = null;
      state.albumArtUrl = null;
      state.translationKey = "";
      state.lastTranslationFetchedAt = 0;
      state.artworkKey = "";
      state.lastArtworkFetchedAt = 0;
      state.songVoteRequestId += 1;
      state.songVoteSummary = null;
      state.songVoteKey = "";
      state.lastVoteFetchedAt = 0;
      state.songVoteSubmitting = false;
      renderLyricsBody();
      renderTrackCard();
    }

    renderChrome();
  } catch (error) {
    state.playback = null;
    state.lastTrackKey = "";
    state.translation = null;
    state.aiDraft = null;
    state.albumArtUrl = null;
    state.translationKey = "";
    state.artworkKey = "";
    state.songVoteRequestId += 1;
    state.songVoteSummary = null;
    state.songVoteKey = "";
    state.lastVoteFetchedAt = 0;
    state.songVoteSubmitting = false;
    // Fail silently — don't surface technical errors to consumers
    state.bannerText = "";
    renderLyricsBody();
    renderTrackCard();
    renderChrome();
  } finally {
    state.playbackPollInFlight = false;
  }
}

async function invokePlaybackControl(action, extra = {}) {
  if (!tauriInvoke) {
    throw new Error("Tauri bridge unavailable.");
  }

  return tauriInvoke("desktop_control_playback", {
    command: {
      action,
      ...extra
    }
  });
}

async function controlPlayback(action, extra = {}) {
  try {
    const controlPromise = invokePlaybackControl(action, extra);
    state.lastPlaybackFetchedAt = 0;
    burstRefreshPlayback();

    const snapshot = await controlPromise;

    if (snapshot?.track) {
      const nextTrackKey = getPlaybackIdentityKey(snapshot.track);
      const trackChanged = nextTrackKey !== state.lastTrackKey;

      state.playback = snapshot;
      state.lastPlaybackFetchedAt = Date.now();
      state.bannerText = "";

      if (trackChanged) {
        state.lastTrackKey = nextTrackKey;
        state.translation = null;
        state.aiDraft = null;
        state.albumArtUrl = null;
        state.translationKey = "";
        state.lastTranslationFetchedAt = 0;
        state.artworkKey = "";
        state.lastArtworkFetchedAt = 0;
        state.activeLineIndex = -1;
        renderLyricsBody();
        renderTrackCard();
        renderChrome();
      }

      renderTrackCard();
      renderChrome();
      if (trackChanged) {
        renderLyricsBody();
        void refreshTranslation(true);
        void refreshArtwork(true);
      }
    }

    state.lastPlaybackFetchedAt = 0;
  } catch (error) {
    state.bannerText = formatPlaybackControlError(error);
    renderStaticPanels();
  }
}

function toggleDesktopSync() {
  state.desktopConnected = !state.desktopConnected;
  state.bannerText = "";

  if (state.desktopConnected) {
    renderChrome();
    void refreshPlayback();
    return;
  }

  renderChrome();
}

function buildCopyText(index) {
  const translation = getCurrentTranslation();
  if (!translation || !translation.lines[index]) {
    return "";
  }

  const line = translation.lines[index];
  const segments = [line.translated || line.original || ""];

  if (line.original) {
    segments.push(`Original: ${line.original}`);
  }

  if (line.transliteration) {
    segments.push(`Transliteration: ${line.transliteration}`);
  }

  if (line.note) {
    segments.push(`Note: ${line.note}`);
  }

  return segments.filter(Boolean).join("\n");
}

async function handleLyricsClick(event) {
  const button = event.target.closest("[data-copy-line]");
  if (!button) {
    const voteButton = event.target.closest("[data-action='vote-song']");
    if (voteButton) {
      void handleSongVote();
      return;
    }

    const plainCard = event.target.closest(".plain-line-card");
    if (plainCard) {
      togglePlainTranslationCard(plainCard);
      return;
    }

    const lineCard = event.target.closest(".line-card");
    if (!lineCard || lineCard.dataset.hasTiming !== "1") {
      return;
    }

    const startMs = Number(lineCard.dataset.startMs);
    if (!Number.isFinite(startMs)) {
      return;
    }

    void seekPlaybackToPosition(startMs);
    return;
  }

  const index = Number(button.dataset.copyLine);
  const text = buildCopyText(index);

  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "✓";
    setTimeout(() => {
      button.textContent = "C";
    }, 1000);
  } catch {
    state.bannerText = "Unable to copy the lyric line.";
    updateOfflineBanner();
  }
}

function handleProgressSeek(event) {
  const playback = state.playback;
  const track = playback?.track ?? null;
  if (!track) {
    return;
  }

  const rect = refs.progressTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const positionMs = clampSeekPosition((track.durationMs || 0) * ratio);
  void seekPlaybackToPosition(positionMs);
}

function handleControlClick(event) {
  const action = event.currentTarget?.dataset?.action;

  if (action === "toggle") {
    controlPlayback("toggle");
    return;
  }

  if (action === "disconnect") {
    handleAuthSignOut();
    return;
  }

  if (action === "previous") {
    controlPlayback("previous");
    return;
  }

  if (action === "next") {
    controlPlayback("next");
  }
}

function updateClock() {
  if (!state.desktopConnected) {
    return;
  }

  state.now = Date.now();
  setArtworkGlowPulse(Boolean(state.playback?.isPlaying), getDisplayProgressMs());
  updateProgressUI();
}

async function boot() {
  buildAuthGate();
  setAuthMessage("Preparing Lafz desktop...");

  await loadRuntimeConfig();
  buildAuthGate();
  void checkDesktopUpdate({ silent: true });

  const storedSession = readStoredDesktopAuthSession();
  if (!storedSession) {
    setAuthMessage("");
    return;
  }

  void (async () => {
    const access = await restoreDesktopAuthSession();

    if (!access.allowed) {
      buildAuthGate();
      return;
    }

    stopDesktopRuntime();
    startDesktopRuntime();
  })();
}

boot().catch((error) => {
  state.bannerText = error instanceof Error ? error.message : "Failed to start Lafz desktop.";
  buildAuthGate();
  renderAuthMessage(state.bannerText);
});
