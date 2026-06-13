const ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php";
const ARCHIVE_METADATA_URL = "https://archive.org/metadata";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...(init.headers || {}),
    },
  });
}

async function archiveJson(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "vhs-vault-random-player/1.0",
    },
  });

  if (!response.ok) {
    return jsonResponse({ error: label + ": " + response.status + " " + response.statusText }, { status: response.status });
  }

  return new Response(await response.text(), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

async function search(requestUrl) {
  const params = new URLSearchParams(requestUrl.search);
  const archiveParams = new URLSearchParams({
    q: params.get("q") || "collection:vhsvault AND mediatype:movies",
    rows: params.get("rows") || "250",
    page: params.get("page") || "1",
    output: "json",
  });
  archiveParams.append("fl[]", "identifier");
  return archiveJson(ARCHIVE_SEARCH_URL + "?" + archiveParams, "Archive search");
}

async function metadata(pathname) {
  const identifier = pathname.replace(/^\/api\/metadata\//, "");
  if (!identifier) {
    return jsonResponse({ error: "Missing Archive identifier" }, { status: 400 });
  }

  return archiveJson(ARCHIVE_METADATA_URL + "/" + encodeURIComponent(decodeURIComponent(identifier)), "Archive metadata");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/search") {
      return search(url);
    }

    if (url.pathname.startsWith("/api/metadata/")) {
      return metadata(url.pathname);
    }

    return env.ASSETS.fetch(request);
  },
};
