/* =========================================================
   DASHBOARD HORLOGE — script.js
   3 modules : Horloge, Fond d'écran (localStorage), Spotify.
   ========================================================= */

/* =========================================================
   MODULE 1 — HORLOGE & DATE
   ========================================================= */

const clockEls = {
  hours: document.getElementById("hours"),
  minutes: document.getElementById("minutes"),
  seconds: document.getElementById("seconds"),
  date: document.getElementById("current-date"),
};

// Formateur de date en français, mis en cache (plus performant qu'un
// nouvel objet Intl.DateTimeFormat à chaque tick).
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function updateClock() {
  const now = new Date();

  clockEls.hours.textContent = String(now.getHours()).padStart(2, "0");
  clockEls.minutes.textContent = String(now.getMinutes()).padStart(2, "0");
  clockEls.seconds.textContent = String(now.getSeconds()).padStart(2, "0");

  clockEls.date.textContent = capitalize(dateFormatter.format(now));
}

function startClock() {
  updateClock();
  // On se resynchronise sur le début de chaque seconde exacte pour
  // éviter toute dérive cumulée au fil du temps.
  const msUntilNextSecond = 1000 - (Date.now() % 1000);
  setTimeout(() => {
    updateClock();
    setInterval(updateClock, 1000);
  }, msUntilNextSecond);
}

startClock();

/* =========================================================
   MODULE 2 — FOND D'ÉCRAN PERSONNALISÉ (localStorage)
   ========================================================= */

const WALLPAPER_STORAGE_KEY = "dashboard.wallpaper.base64";

const wallpaperEl = document.getElementById("wallpaper");
const wallpaperInput = document.getElementById("wallpaper-input");
const wallpaperResetBtn = document.getElementById("wallpaper-reset");
const wallpaperStatus = document.getElementById("wallpaper-status");

const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");

function applyWallpaper(base64) {
  wallpaperEl.style.backgroundImage = `url("${base64}")`;
}

function clearWallpaper() {
  wallpaperEl.style.backgroundImage = "";
}

function loadWallpaperFromStorage() {
  try {
    const saved = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (saved) applyWallpaper(saved);
  } catch (err) {
    // localStorage peut être indisponible (navigation privée, quota, etc.)
    console.warn("Impossible de lire le fond d'écran sauvegardé :", err);
  }
}

function setStatus(message) {
  wallpaperStatus.textContent = message;
  // Le message s'efface tout seul après quelques secondes.
  clearTimeout(setStatus._timer);
  setStatus._timer = setTimeout(() => {
    wallpaperStatus.textContent = "";
  }, 3000);
}

wallpaperInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setStatus("Fichier invalide : choisis une image.");
    return;
  }

  // Limite raisonnable pour rester sous les quotas de localStorage (~5 Mo).
  const MAX_SIZE_BYTES = 4 * 1024 * 1024;
  if (file.size > MAX_SIZE_BYTES) {
    setStatus("Image trop lourde (max. 4 Mo).");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    applyWallpaper(base64);
    try {
      localStorage.setItem(WALLPAPER_STORAGE_KEY, base64);
      setStatus("Fond d'écran mis à jour.");
    } catch (err) {
      console.warn("Impossible de sauvegarder le fond d'écran :", err);
      setStatus("Image appliquée (non sauvegardée : quota dépassé).");
    }
  };
  reader.onerror = () => setStatus("Erreur de lecture du fichier.");
  reader.readAsDataURL(file);
});

wallpaperResetBtn.addEventListener("click", () => {
  clearWallpaper();
  try {
    localStorage.removeItem(WALLPAPER_STORAGE_KEY);
  } catch (err) {
    console.warn(err);
  }
  wallpaperInput.value = "";
  setStatus("Fond par défaut rétabli.");
});

// Ouverture / fermeture du panneau de réglages.
function toggleSettingsPanel(forceState) {
  const isOpen = forceState ?? !settingsPanel.classList.contains("is-open");
  settingsPanel.classList.toggle("is-open", isOpen);
  settingsPanel.setAttribute("aria-hidden", String(!isOpen));
  settingsToggle.setAttribute("aria-expanded", String(isOpen));
}

settingsToggle.addEventListener("click", () => toggleSettingsPanel());

document.addEventListener("click", (event) => {
  const clickedInsidePanel = settingsPanel.contains(event.target);
  const clickedToggle = settingsToggle.contains(event.target);
  if (!clickedInsidePanel && !clickedToggle) toggleSettingsPanel(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") toggleSettingsPanel(false);
});

loadWallpaperFromStorage();

/* =========================================================
   MODULE 3 — WIDGET SPOTIFY "NOW PLAYING"
   =========================================================

   COMMENT OBTENIR TES IDENTIFIANTS SPOTIFY :
   1. Va sur https://developer.spotify.com/dashboard et connecte-toi.
   2. Clique sur "Create app". Renseigne un nom / description au choix.
   3. Dans "Redirect URIs", ajoute EXACTEMENT l'URL sur laquelle cette
      page sera servie, par ex. http://127.0.0.1:5500/index.html ou
      https://tondomaine.com/index.html (doit correspondre à REDIRECT_URI
      ci-dessous, caractère pour caractère).
   4. Coche "Web API" dans les API utilisées.
   5. Une fois l'app créée, copie le "Client ID" affiché sur la page
      des réglages de l'app et colle-le dans CLIENT_ID ci-dessous.

   SÉCURITÉ — POURQUOI PAS DE CLIENT_SECRET NI DE REFRESH_TOKEN EN DUR ICI :
   Un Client Secret ne doit JAMAIS être placé dans du code exécuté côté
   navigateur : n'importe qui peut l'extraire depuis les sources de la
   page. Spotify recommande pour les applications 100% front-end le flux
   "Authorization Code with PKCE", qui ne nécessite aucun secret : la
   preuve cryptographique (code_verifier / code_challenge) remplace le
   Client Secret. C'est le flux implémenté ci-dessous.
   Le résultat (jeton d'accès + jeton de rafraîchissement) est conservé
   uniquement dans le localStorage du navigateur de l'utilisateur, donc
   aucune information sensible ne transite par un serveur tiers.
   ========================================================= */

// --- Constantes à personnaliser ---
const SPOTIFY_CLIENT_ID = "b5a01af1ef494890b381088c34a0fb1b"; // Étape 5 ci-dessus
const SPOTIFY_REDIRECT_URI = "https://origame23137.github.io/clock/idex.html"; // doit être déclarée telle quelle dans le dashboard Spotify
const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
];

// --- Clés de stockage local ---
const LS_ACCESS_TOKEN = "spotify.access_token";
const LS_REFRESH_TOKEN = "spotify.refresh_token";
const LS_EXPIRES_AT = "spotify.expires_at";
const LS_PKCE_VERIFIER = "spotify.pkce_verifier";

const spotifyCard = document.getElementById("spotify-card");
const spotifyArt = document.getElementById("spotify-art");
const spotifyBadgeIcon = document.getElementById("spotify-badge-icon");
const songTitleEl = document.getElementById("song-title");
const artistNameEl = document.getElementById("artist-name");
const progressFillEl = document.getElementById("playback-progress");
const playPauseEl = document.getElementById("play-pause");
const spotifyConnectBtn = document.getElementById("spotify-connect");
const spotifyConnectLabel = document.getElementById("spotify-connect-label");

/* ---------- Utilitaires PKCE ---------- */

function generateRandomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => possible[v % possible.length]).join("");
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(arrayBuffer) {
  let str = "";
  const bytes = new Uint8Array(arrayBuffer);
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateCodeChallenge(verifier) {
  const hashed = await sha256(verifier);
  return base64UrlEncode(hashed);
}

/* ---------- Flux d'authentification ---------- */

async function redirectToSpotifyAuth() {
  if (
    !SPOTIFY_CLIENT_ID ||
    SPOTIFY_CLIENT_ID === "REMPLACE_PAR_TON_CLIENT_ID"
  ) {
    alert(
      "Configure d'abord SPOTIFY_CLIENT_ID en haut de script.js avec ton propre Client ID Spotify.",
    );
    return;
  }

  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(LS_PKCE_VERIFIER, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: SPOTIFY_REDIRECT_URI,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem(LS_PKCE_VERIFIER);

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok)
    throw new Error("Échec de l'échange du code d'autorisation.");
  return response.json();
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    // Refresh token invalide/expiré : on force une reconnexion.
    disconnectSpotify();
    return null;
  }
  return response.json();
}

function storeTokenResponse(tokenData) {
  localStorage.setItem(LS_ACCESS_TOKEN, tokenData.access_token);
  if (tokenData.refresh_token) {
    localStorage.setItem(LS_REFRESH_TOKEN, tokenData.refresh_token);
  }
  const expiresAt = Date.now() + tokenData.expires_in * 1000;
  localStorage.setItem(LS_EXPIRES_AT, String(expiresAt));
}

function disconnectSpotify() {
  [LS_ACCESS_TOKEN, LS_REFRESH_TOKEN, LS_EXPIRES_AT, LS_PKCE_VERIFIER].forEach(
    (k) => localStorage.removeItem(k),
  );
  updateSpotifyConnectButton();
  setIdleState();
}

async function getValidAccessToken() {
  const expiresAt = Number(localStorage.getItem(LS_EXPIRES_AT) || 0);
  let accessToken = localStorage.getItem(LS_ACCESS_TOKEN);

  // Marge de sécurité de 30s avant l'expiration réelle.
  if (!accessToken || Date.now() > expiresAt - 30000) {
    const refreshed = await refreshAccessToken();
    accessToken = refreshed ? refreshed.access_token : null;
  }
  return accessToken;
}

function updateSpotifyConnectButton() {
  const connected = Boolean(localStorage.getItem(LS_REFRESH_TOKEN));
  spotifyConnectLabel.textContent = connected
    ? "Déconnecter Spotify"
    : "Connecter Spotify";
}

spotifyConnectBtn.addEventListener("click", () => {
  const connected = Boolean(localStorage.getItem(LS_REFRESH_TOKEN));
  if (connected) {
    disconnectSpotify();
  } else {
    redirectToSpotifyAuth();
  }
});

// Gestion du retour de redirection OAuth (?code=... dans l'URL).
async function handleAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;

  try {
    const tokenData = await exchangeCodeForToken(code);
    storeTokenResponse(tokenData);
  } catch (err) {
    console.error(err);
    setStatus?.("Connexion Spotify échouée.");
  } finally {
    // Nettoie l'URL pour ne pas garder le code en query string.
    window.history.replaceState({}, document.title, SPOTIFY_REDIRECT_URI);
    updateSpotifyConnectButton();
  }
}

/* ---------- Récupération et affichage du morceau en cours ---------- */

let localProgressMs = 0;
let localDurationMs = 0;
let localTrackIsPlaying = false;
let progressTickerId = null;

function setIdleState() {
  spotifyCard.classList.add("is-idle");
  spotifyBadgeIcon.textContent = "music_off";
  songTitleEl.textContent = "Aucune musique en cours";
  artistNameEl.textContent = "Connecte Spotify dans les réglages";
  spotifyArt.removeAttribute("src");
  spotifyArt.alt = "";
  progressFillEl.style.width = "0%";
  playPauseEl.textContent = "play_circle";
  localTrackIsPlaying = false;
}

function setNowPlayingState(track) {
  spotifyCard.classList.remove("is-idle");
  spotifyBadgeIcon.textContent = "music_note";

  songTitleEl.textContent = track.item.name;
  artistNameEl.textContent = track.item.artists.map((a) => a.name).join(", ");

  const albumImage = track.item.album?.images?.[0]?.url;
  if (albumImage) {
    spotifyArt.src = albumImage;
    spotifyArt.alt = `Pochette de l'album ${track.item.album.name}`;
  }

  playPauseEl.textContent = track.is_playing ? "pause_circle" : "play_circle";

  localProgressMs = track.progress_ms || 0;
  localDurationMs = track.item.duration_ms || 1;
  localTrackIsPlaying = track.is_playing;

  renderProgress();
}

function renderProgress() {
  const percent = Math.min(100, (localProgressMs / localDurationMs) * 100);
  progressFillEl.style.width = `${percent}%`;
}

// Timer local qui interpole la progression entre deux appels API,
// pour une barre fluide sans devoir interroger l'API chaque seconde.
function startProgressTicker() {
  clearInterval(progressTickerId);
  progressTickerId = setInterval(() => {
    if (!localTrackIsPlaying) return;
    localProgressMs = Math.min(localDurationMs, localProgressMs + 1000);
    renderProgress();
  }, 1000);
}

async function fetchCurrentlyPlaying() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    setIdleState();
    return;
  }

  try {
    const response = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    // 204 = aucune lecture en cours (réponse vide, comportement normal de l'API).
    if (response.status === 204) {
      setIdleState();
      return;
    }

    if (response.status === 401) {
      // Jeton expiré entre-temps : on retentera au prochain cycle.
      return;
    }

    if (!response.ok)
      throw new Error(`Erreur API Spotify : ${response.status}`);

    const data = await response.json();

    if (!data || !data.item || !data.is_playing) {
      setIdleState();
      return;
    }

    setNowPlayingState(data);
  } catch (err) {
    console.error("Erreur lors de la récupération du morceau en cours :", err);
    setIdleState();
  }
}

/* ---------- Initialisation ---------- */

async function initSpotify() {
  updateSpotifyConnectButton();
  setIdleState();

  await handleAuthRedirect();

  const connected = Boolean(localStorage.getItem(LS_REFRESH_TOKEN));
  if (!connected) return;

  await fetchCurrentlyPlaying();
  startProgressTicker();
  // Nouvelle synchronisation avec l'API toutes les 15 secondes
  // (évite de dépasser les limites de requêtes de l'API Spotify).
  setInterval(fetchCurrentlyPlaying, 15000);
}

initSpotify();
