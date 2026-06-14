const COLLECTION = "vhsvault";
const SEARCH_URL = "https://archive.org/advancedsearch.php";
const METADATA_URL = "https://archive.org/metadata";
const HAS_WORKER_API = !["localhost", "127.0.0.1", "::1"].includes(location.hostname) && !location.hostname.endsWith("github.io");
const MIN_RUNTIME_SECONDS = 45 * 60;
const MAX_CONTENT_YEAR = 1999;
const COLLECTION_QUERY = "collection:" + COLLECTION + " AND mediatype:movies AND runtime:[" + MIN_RUNTIME_SECONDS + " TO *] AND date:[0000-01-01 TO " + MAX_CONTENT_YEAR + "-12-31]";
const ROWS = 250;
const FALLBACK_CATALOG_URL = "./fallback-identifiers.json";
const MAX_ATTEMPTS = 25;
const RECENT_HISTORY_KEY = "vhsVaultRecentIdentifiers";
const RECENT_HISTORY_LIMIT = 100;
const FALLBACK_DECK_KEY = "vhsVaultFallbackDeck45MinPre2000";
const FALLBACK_IDENTIFIERS = [
  "the-man-in-the-iron-mask-1977-historical-adventure",
  "francis-joins-the-wacs-1954-classic-comedy-talking-mule"
];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const els = {
  screenShell: document.querySelector("#screenShell"),
  video: document.querySelector("#video"),
  title: document.querySelector("#title"),
  description: document.querySelector("#description"),
  identifier: document.querySelector("#identifier"),
  runtime: document.querySelector("#runtime"),
  sourceFile: document.querySelector("#sourceFile"),
  archiveLink: document.querySelector("#archiveLink"),
  randomButton: document.querySelector("#randomButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  loading: document.querySelector("#loading"),
  bars: document.querySelector("#bars"),
  osd: document.querySelector("#osd"),
  errorPanel: document.querySelector("#errorPanel"),
  errorMessage: document.querySelector("#errorMessage"),
  playPrompt: document.querySelector("#playPrompt"),
  snow: document.querySelector("#snow"),
  flash: document.querySelector("#flash"),
  transportIcon: document.querySelector("#transportIcon"),
  transportState: document.querySelector("#transportState"),
  tapeMode: document.querySelector("#tapeMode"),
  channel: document.querySelector("#channel"),
  stamp: document.querySelector("#stamp"),
  timecode: document.querySelector("#timecode"),
};

let totalItems = null;
let fallbackCatalogPromise = null;
let currentTape = null;

function pad(value) {
  return String(value).padStart(2, "0");
}

function archiveFileUrl(identifier, fileName) {
  return "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + fileName.split("/").map(encodeURIComponent).join("/");
}

function searchUrl(params) {
  return (HAS_WORKER_API ? "/api/search" : SEARCH_URL) + "?" + params;
}

function metadataUrl(identifier) {
  const encoded = encodeURIComponent(identifier);
  return HAS_WORKER_API ? "/api/metadata/" + encoded : METADATA_URL + "/" + encoded;
}

function textFromValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value;
  return "";
}

function cleanDescription(value) {
  const raw = textFromValue(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "VHS Vault - archive.org";
  return raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
}

function secondsToRuntime(seconds) {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return "-";

  const hours = Math.floor(parsed / 3600);
  const minutes = Math.floor((parsed % 3600) / 60);
  const secs = Math.floor(parsed % 60);

  if (hours) return hours + ":" + pad(minutes) + ":" + pad(secs);
  return minutes + ":" + pad(secs);
}

function randomStamp() {
  const ampm = Math.random() < 0.5 ? "AM" : "PM";
  const hour = pad(Math.floor(Math.random() * 12) + 1);
  const minute = pad(Math.floor(Math.random() * 60));
  const month = MONTHS[Math.floor(Math.random() * MONTHS.length)];
  const day = pad(Math.floor(Math.random() * 28) + 1);
  const year = "19" + pad(Math.floor(Math.random() * 9) + 90);
  return ampm + " " + hour + ":" + minute + " " + month + " " + day + " " + year;
}

function flashScreen() {
  els.flash.classList.remove("on");
  void els.flash.offsetWidth;
  els.flash.classList.add("on");
}

function fieldValues(value) {
  if (Array.isArray(value)) return value.flatMap(fieldValues);
  if (value === null || value === undefined) return [];
  return [String(value)];
}

function yearsFromValue(value) {
  return fieldValues(value)
    .join(" ")
    .match(/\b(?:18|19|20)\d{2}\b/g)
    ?.map(Number) || [];
}

function pre2000ContentYear(metadata = {}) {
  const years = [
    ...yearsFromValue(metadata.date),
    ...yearsFromValue(metadata.year),
  ];

  if (!years.length) return null;
  if (years.some((year) => year > MAX_CONTENT_YEAR)) return null;
  return Math.max(...years.filter((year) => year <= MAX_CONTENT_YEAR));
}

function playableFile(files) {
  const candidates = files.filter((file) => {
    const name = file.name || "";
    const format = String((file.format || "") + " " + (file.source || "")).toLowerCase();
    const length = Number(file.length || 0);
    const playable = /\.(mp4|m4v|webm|ogv)$/i.test(name) || format.includes("mpeg4") || format.includes("h.264") || format.includes("webm");
    return playable && length >= MIN_RUNTIME_SECONDS;
  });

  return candidates.sort((a, b) => {
    const aName = a.name || "";
    const bName = b.name || "";
    const aScore = /\.mp4$/i.test(aName) ? 0 : /\.m4v$/i.test(aName) ? 1 : 2;
    const bScore = /\.mp4$/i.test(bName) ? 0 : /\.m4v$/i.test(bName) ? 1 : 2;
    return aScore - bScore || Number(b.size || 0) - Number(a.size || 0);
  })[0];
}

function setLoading(message) {
  els.loading.hidden = false;
  els.errorPanel.hidden = true;
  els.bars.hidden = false;
  els.osd.hidden = true;
  els.playPrompt.hidden = true;
  els.snow.classList.add("heavy");
  els.loading.querySelector(".standby-sub").textContent = message.toUpperCase();
  els.randomButton.disabled = true;
}

function setPlayingUi() {
  els.loading.hidden = true;
  els.errorPanel.hidden = true;
  els.bars.hidden = true;
  els.osd.hidden = false;
  els.snow.classList.remove("heavy");
  els.randomButton.disabled = false;
}

function setErrorUi(message) {
  els.loading.hidden = true;
  els.errorPanel.hidden = false;
  els.bars.hidden = false;
  els.osd.hidden = true;
  els.playPrompt.hidden = true;
  els.snow.classList.add("heavy");
  els.errorMessage.textContent = message;
  els.randomButton.disabled = false;
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { mode: "cors", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(label + ": " + response.status + " " + response.statusText);
    return response.json();
  } catch (error) {
    const reason = error.name === "AbortError" ? "request timed out" : error.message;
    throw new Error(label + ": " + reason);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function getTotalItems() {
  if (totalItems !== null) return totalItems;

  const params = new URLSearchParams({
    q: COLLECTION_QUERY,
    "fl[]": "identifier",
    rows: "0",
    page: "1",
    output: "json",
  });
  const data = await fetchJson(searchUrl(params), "Archive search count");
  totalItems = data.response?.numFound || 0;
  if (!totalItems) throw new Error("The VHS Vault search did not return any items.");
  return totalItems;
}

function recentIdentifiers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (error) {
    console.warn(error);
    return [];
  }
}

function isRecentlyPlayed(identifier) {
  return recentIdentifiers().includes(identifier);
}

function rememberIdentifier(identifier) {
  if (!identifier) return;
  const next = [identifier, ...recentIdentifiers().filter((item) => item !== identifier)].slice(0, RECENT_HISTORY_LIMIT);
  localStorage.setItem(RECENT_HISTORY_KEY, JSON.stringify(next));
}

function shuffle(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function pickIdentifier(identifiers) {
  const unique = [...new Set(identifiers)].filter(Boolean);
  const unseen = unique.filter((identifier) => !isRecentlyPlayed(identifier));
  const pool = unseen.length ? unseen : unique;
  return pool[Math.floor(Math.random() * pool.length)];
}

function readDeck(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (error) {
    console.warn(error);
    return [];
  }
}

function writeDeck(key, deck) {
  localStorage.setItem(key, JSON.stringify(deck));
}

function drawFromDeck(key, sourceIdentifiers) {
  const source = [...new Set(sourceIdentifiers)].filter(Boolean);
  let deck = readDeck(key).filter((identifier) => source.includes(identifier) && !isRecentlyPlayed(identifier));
  if (!deck.length) deck = shuffle(source.filter((identifier) => !isRecentlyPlayed(identifier)));
  if (!deck.length) deck = shuffle(source);
  const identifier = deck.shift();
  writeDeck(key, deck);
  return identifier;
}

async function fallbackCatalog() {
  if (!fallbackCatalogPromise) {
    fallbackCatalogPromise = fetchJson(FALLBACK_CATALOG_URL, "Local fallback catalog")
      .then((identifiers) => Array.isArray(identifiers) ? identifiers : FALLBACK_IDENTIFIERS)
      .catch((error) => {
        console.warn(error);
        return FALLBACK_IDENTIFIERS;
      });
  }
  return fallbackCatalogPromise;
}

async function randomFallbackIdentifier() {
  return drawFromDeck(FALLBACK_DECK_KEY, await fallbackCatalog());
}

async function randomIdentifier() {
  try {
    const total = await getTotalItems();
    const start = Math.floor(Math.random() * total);
    const page = Math.floor(start / ROWS) + 1;
    const params = new URLSearchParams({
      q: COLLECTION_QUERY,
      "fl[]": "identifier",
      rows: String(ROWS),
      page: String(page),
      output: "json",
    });
    const data = await fetchJson(searchUrl(params), "Archive search");
    const identifiers = (data.response?.docs || []).map((doc) => doc.identifier).filter(Boolean);
    if (!identifiers.length) throw new Error("Archive.org returned an empty random page.");
    return pickIdentifier(identifiers);
  } catch (error) {
    console.warn(error);
    return await randomFallbackIdentifier();
  }
}

async function randomPlayableItem() {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const identifier = await randomIdentifier();
      const item = await fetchJson(metadataUrl(identifier), "Archive metadata");
      const metadata = item.metadata || {};
      const contentYear = pre2000ContentYear(metadata);
      if (!contentYear) {
        lastError = new Error("No pre-2000 content date found for " + identifier);
        continue;
      }

      const file = playableFile(item.files || []);
      if (file) return { item, file, contentYear };
      lastError = new Error("No playable video file at least 45 minutes long found for " + identifier);
    } catch (error) {
      lastError = error;
      console.warn(error);
    }
  }
  throw lastError || new Error("Could not find a browser-playable video after several random picks.");
}

async function loadRandomVideo() {
  setLoading("Tuning - finding a tape");

  try {
    const { item, file, contentYear } = await randomPlayableItem();
    const metadata = item.metadata || {};
    const identifier = metadata.identifier || item.item?.identifier || "";
    const title = textFromValue(metadata.title) || identifier || "Untitled VHS item";
    const videoUrl = archiveFileUrl(identifier, file.name);

    currentTape = { identifier, title };
    els.video.pause();
    els.video.removeAttribute("src");
    els.video.load();
    els.video.src = videoUrl;
    els.video.muted = false;

    els.title.textContent = title;
    els.description.textContent = cleanDescription(metadata.creator || metadata.date || metadata.description) + (contentYear ? " - " + contentYear : "");
    els.identifier.textContent = identifier || "-";
    els.runtime.textContent = secondsToRuntime(file.length || metadata.runtime);
    els.sourceFile.textContent = file.name || "-";
    els.archiveLink.href = identifier ? "https://archive.org/details/" + encodeURIComponent(identifier) : "https://archive.org/details/vhsvault";
    els.tapeMode.textContent = Math.random() < 0.5 ? "SP" : "EP";
    els.channel.textContent = pad(Math.floor(Math.random() * 60) + 2);
    els.stamp.textContent = randomStamp();
    els.timecode.textContent = "0:00:00";
    rememberIdentifier(identifier);

    setPlayingUi();
    flashScreen();
    await els.video.play().then(() => {
      els.playPrompt.hidden = true;
      els.transportIcon.textContent = "PLAY";
      els.transportState.textContent = "PLAY";
    }).catch(() => {
      els.playPrompt.hidden = false;
      els.transportIcon.textContent = "PAUSE";
      els.transportState.textContent = "PAUSE";
    });
  } catch (error) {
    currentTape = null;
    els.title.textContent = "No signal";
    els.description.textContent = error.message;
    els.identifier.textContent = "-";
    els.runtime.textContent = "-";
    els.sourceFile.textContent = "-";
    els.archiveLink.href = "https://archive.org/details/vhsvault";
    setErrorUi(error.message);
  }
}

function updateTransportUi() {
  const playing = !els.video.paused && !els.video.ended;
  els.playPrompt.hidden = playing || els.osd.hidden;
  els.transportIcon.textContent = playing ? "PLAY" : "PAUSE";
  els.transportState.textContent = playing ? "PLAY" : "PAUSE";
}

function isFullscreen() {
  return document.fullscreenElement === els.screenShell;
}

function updateFullscreenUi() {
  const active = isFullscreen();
  els.fullscreenButton.textContent = active ? "EXIT FULL SCREEN" : "FULL SCREEN";
  els.fullscreenButton.setAttribute("aria-pressed", String(active));
  els.screenShell.classList.toggle("is-fullscreen", active);
}

async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      await document.exitFullscreen();
    } else {
      await els.screenShell.requestFullscreen();
    }
  } catch (error) {
    console.warn(error);
  } finally {
    updateFullscreenUi();
  }
}

function togglePlayback() {
  if (!currentTape) return;
  if (els.video.paused) {
    els.video.muted = false;
    els.video.play().catch(() => {});
  } else {
    els.video.pause();
  }
}

els.randomButton.addEventListener("click", loadRandomVideo);
els.fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenUi);
els.video.addEventListener("click", togglePlayback);
els.video.addEventListener("play", updateTransportUi);
els.video.addEventListener("pause", updateTransportUi);
els.video.addEventListener("ended", loadRandomVideo);
els.video.addEventListener("timeupdate", () => {
  els.timecode.textContent = secondsToRuntime(els.video.currentTime);
});
els.video.addEventListener("loadedmetadata", () => {
  if (!els.runtime.textContent || els.runtime.textContent === "-") {
    els.runtime.textContent = secondsToRuntime(els.video.duration);
  }
});
els.video.addEventListener("error", () => {
  if (currentTape) loadRandomVideo();
});

loadRandomVideo();
