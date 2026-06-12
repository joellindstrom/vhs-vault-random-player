const COLLECTION = "vhsvault";
const SEARCH_URL = "https://archive.org/advancedsearch.php";
const METADATA_URL = "https://archive.org/metadata";
const ROWS = 50;
const MAX_ATTEMPTS = 8;
const FALLBACK_IDENTIFIERS = [
  "rare-servicio-de-radiodifusion-publica-logo-1971-1985",
  "conneticut-broadcasting",
  "BillCollinsGodsCountryAndTheWomanTEN10_8-12-90",
  "VHSFoxMMPRWOC",
  "BP_1987",
  "coca-cola-cal-king-commercial-2002",
  "Film_Almost_Famous_Movie_Trailer",
  "armenian-holiday-desserts-1996-vhs",
  "abc-promo-breaks-news-19991128",
  "mca-tv-logo-1991-1993",
  "national-security-2003-trailer",
  "capture-a-5180",
  "capture-a-5518",
  "capture-a-5556",
  "capture-a-6054",
  "capture-a-6244"
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
  const data = await fetchJson(SEARCH_URL + "?" + params, "Archive search count");
  totalItems = data.response?.numFound || 0;
  if (!totalItems) throw new Error("The VHS Vault search did not return any items.");
  return totalItems;
}

function randomFallbackIdentifier() {
  return FALLBACK_IDENTIFIERS[Math.floor(Math.random() * FALLBACK_IDENTIFIERS.length)];
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

    const data = await fetchJson(SEARCH_URL + "?" + params, "Archive search");
    const docs = data.response?.docs || [];
    if (!docs.length) throw new Error("Archive.org returned an empty random page.");
    return docs[Math.floor(Math.random() * docs.length)].identifier;
  } catch (error) {
    console.warn(error);
    return randomFallbackIdentifier();
  }
}

async function randomPlayableItem() {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const identifier = await randomIdentifier();
      const item = await fetchJson(METADATA_URL + "/" + encodeURIComponent(identifier), "Archive metadata");
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
