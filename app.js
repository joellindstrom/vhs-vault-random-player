const COLLECTION = "vhsvault";
const SEARCH_URL = "https://archive.org/advancedsearch.php";
const METADATA_URL = "https://archive.org/metadata";
const HAS_WORKER_API = !["localhost", "127.0.0.1", "::1"].includes(location.hostname) && !location.hostname.endsWith("github.io");
const ROWS = 250;
const FALLBACK_CATALOG_URL = "./fallback-identifiers.json";
const MAX_ATTEMPTS = 8;
const RECENT_HISTORY_KEY = "vhsVaultRecentIdentifiers";
const RECENT_HISTORY_LIMIT = 100;
const FALLBACK_DECK_KEY = "vhsVaultFallbackDeck";
const FALLBACK_IDENTIFIERS = [
  "rare-servicio-de-radiodifusion-publica-logo-1971-1985",
  "national-security-2003-trailer"
];

const els = {
  video: document.querySelector("#video"),
  poster: document.querySelector("#poster"),
  title: document.querySelector("#title"),
  description: document.querySelector("#description"),
  identifier: document.querySelector("#identifier"),
  runtime: document.querySelector("#runtime"),
  sourceFile: document.querySelector("#sourceFile"),
  archiveLink: document.querySelector("#archiveLink"),
  randomButton: document.querySelector("#randomButton"),
  loading: document.querySelector("#loading"),
};

let totalItems = null;
let fallbackCatalogPromise = null;

function archiveFileUrl(identifier, fileName) {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${fileName
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
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

  if (!raw) return "No description was provided for this item.";
  return raw.length > 360 ? `${raw.slice(0, 357)}...` : raw;
}

function secondsToRuntime(seconds) {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return "-";

  const hours = Math.floor(parsed / 3600);
  const minutes = Math.floor((parsed % 3600) / 60);
  const secs = Math.floor(parsed % 60);

  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function playableFile(files) {
  const candidates = files.filter((file) => {
    const name = file.name || "";
    const format = `${file.format || ""} ${file.source || ""}`.toLowerCase();
    return (
      /\.(mp4|m4v|webm|ogv)$/i.test(name) ||
      format.includes("mpeg4") ||
      format.includes("h.264") ||
      format.includes("webm")
    );
  });

  return candidates.sort((a, b) => {
    const aName = a.name || "";
    const bName = b.name || "";
    const aScore = /\.mp4$/i.test(aName) ? 0 : /\.m4v$/i.test(aName) ? 1 : 2;
    const bScore = /\.mp4$/i.test(bName) ? 0 : /\.m4v$/i.test(bName) ? 1 : 2;
    return aScore - bScore || Number(b.size || 0) - Number(a.size || 0);
  })[0];
}

function posterFile(identifier, files) {
  const file = files.find((item) => /(__ia_thumb|\.jpg|\.jpeg|\.png)$/i.test(item.name || ""));
  return file ? archiveFileUrl(identifier, file.name) : "";
}

function setLoading(message) {
  els.loading.textContent = message;
  els.loading.hidden = false;
  els.randomButton.disabled = true;
}

function clearLoading() {
  els.loading.hidden = true;
  els.randomButton.disabled = false;
}

function searchUrl(params) {
  return (HAS_WORKER_API ? "/api/search" : SEARCH_URL) + "?" + params;
}

function metadataUrl(identifier) {
  const encoded = encodeURIComponent(identifier);
  return HAS_WORKER_API ? "/api/metadata/" + encoded : METADATA_URL + "/" + encoded;
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });

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
    q: "collection:" + COLLECTION + " AND mediatype:movies",
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

  const next = [
    identifier,
    ...recentIdentifiers().filter((item) => item !== identifier),
  ].slice(0, RECENT_HISTORY_LIMIT);

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

  if (!deck.length) {
    deck = shuffle(source.filter((identifier) => !isRecentlyPlayed(identifier)));
  }

  if (!deck.length) {
    deck = shuffle(source);
  }

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
      q: "collection:" + COLLECTION + " AND mediatype:movies",
      "fl[]": "identifier",
      rows: String(ROWS),
      page: String(page),
      output: "json",
    });

    const data = await fetchJson(searchUrl(params), "Archive search");
    const identifiers = (data.response?.docs || [])
      .map((doc) => doc.identifier)
      .filter(Boolean);
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
      const file = playableFile(item.files || []);
      if (file) return { item, file };
      lastError = new Error("No playable video file found for " + identifier);
    } catch (error) {
      lastError = error;
      console.warn(error);
    }
  }

  throw lastError || new Error("Could not find a browser-playable video after several random picks.");
}

async function loadRandomVideo() {
  setLoading("Finding a tape...");

  try {
    const { item, file } = await randomPlayableItem();
    const metadata = item.metadata || {};
    const identifier = metadata.identifier || item.item?.identifier || "";
    const title = textFromValue(metadata.title) || identifier || "Untitled VHS item";
    const videoUrl = archiveFileUrl(identifier, file.name);
    const posterUrl = posterFile(identifier, item.files || []);

    els.video.pause();
    els.video.removeAttribute("src");
    els.video.load();
    els.video.src = videoUrl;
    els.video.poster = posterUrl;

    els.poster.src = posterUrl;
    els.poster.alt = title ? `${title} thumbnail` : "";
    els.title.textContent = title;
    els.description.textContent = cleanDescription(metadata.description);
    els.identifier.textContent = identifier || "-";
    els.runtime.textContent = secondsToRuntime(file.length || metadata.runtime);
    els.sourceFile.textContent = file.name || "-";
    els.archiveLink.href = identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : "https://archive.org/details/vhsvault";
    rememberIdentifier(identifier);

    clearLoading();
    await els.video.play().catch(() => {
      // Browser autoplay rules may require the user to press play.
    });
  } catch (error) {
    els.title.textContent = "Could not load a random tape";
    els.description.textContent = error.message;
    els.identifier.textContent = "-";
    els.runtime.textContent = "-";
    els.sourceFile.textContent = "-";
    els.archiveLink.href = "https://archive.org/details/vhsvault";
    clearLoading();
  }
}

els.randomButton.addEventListener("click", loadRandomVideo);
loadRandomVideo();
