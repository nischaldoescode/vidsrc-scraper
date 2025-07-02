import express, { json } from "express";
import cors from "cors";
import { chromium } from "playwright";
import pLimit from "p-limit";
import { pipeline } from "stream";
import { promisify } from "util";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENSUB_API_KEY = process.env.OPENSUB_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BEARER_TOKEN = process.env.TMDB_BEARER_TOKEN;

const headers = {
  Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
  "Content-Type": "application/json;charset=utf-8",
};

const streamPipeline = promisify(pipeline);

app.use(cors());
app.use(json());

const PROVIDERS = [
  "https://vidsrc.xyz",
  "https://vidsrc.in",
  "https://vidsrc.pm",
  "https://vidsrc.net",
];

const LANGUAGE_NAMES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  ar: "Arabic",
  de: "German",
  it: "Italian",
  tr: "Turkish",
  hi: "Hindi",
  ru: "Russian",
};

const COMMON_LANGUAGES = Object.keys(LANGUAGE_NAMES);

// Global browser instance, launched once
let browser;

// Simple in-memory cache to avoid scraping same query repeatedly (15 minutes)
const cache = new Map();

// Limit concurrent scraping to 2 providers at a time
const limit = pLimit(2);

//Scraper util function
async function scrapeProvider(domain, url) {
  console.log(`\n[${domain}] Starting scrape for URL: ${url}`);

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  let hlsUrl = null;
  const subtitles = [];

  const isSubtitle = (url) => {
    return (
      /\.(vtt|srt)(\?.*)?$/.test(url) ||
      url.includes(".vtt") ||
      url.includes(".srt")
    );
  };

  try {
    // Intercept requests
    await page.route("**/*", (route) => {
      const reqUrl = route.request().url();

      if (!hlsUrl && reqUrl.includes(".m3u8")) {
        hlsUrl = reqUrl;
        console.log(`[${domain}] Found HLS URL: ${hlsUrl}`);
      }

      if (isSubtitle(reqUrl) && !subtitles.includes(reqUrl)) {
        subtitles.push(reqUrl);
        console.log(`[${domain}] (route) Found subtitle URL: ${reqUrl}`);
      }

      route.continue();
    });

    // Also listen for subtitle requests via page events
    page.on("request", (request) => {
      const reqUrl = request.url();
      if (isSubtitle(reqUrl) && !subtitles.includes(reqUrl)) {
        subtitles.push(reqUrl);
        console.log(`[${domain}] (onRequest) Found subtitle: ${reqUrl}`);
      }
    });

    // Optional: log when iframe is attached
    page.on("frameattached", (frame) => {
      console.log(`[${domain}] Frame attached: ${frame.url()}`);
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log(`[${domain}] Page loaded`);

    const frameDiv = await page.waitForSelector("#the_frame", {
      timeout: 10000,
    });

    if (frameDiv) {
      const box = await frameDiv.boundingBox();

      if (box) {
        const clickX = box.x + box.width / 2;
        const clickY = box.y + box.height / 2;
        console.log(
          `[${domain}] Clicking at (${clickX.toFixed(1)}, ${clickY.toFixed(1)})`
        );

        await page.mouse.move(clickX, clickY);
        await page.mouse.click(clickX, clickY);
      } else {
        console.warn(`[${domain}] Fallback: clicking via JS`);
        await page.evaluate(() => {
          document.querySelector("#the_frame")?.click();
        });
      }

      // Give time for network requests (especially subtitle .vtt)
      await page.waitForTimeout(7000);

      // Try waiting for the HLS URL (if not already found)
      if (!hlsUrl) {
        await page
          .waitForResponse((resp) => resp.url().includes(".m3u8"), {
            timeout: 5000,
          })
          .catch(() => {
            console.warn(`[${domain}] .m3u8 request not detected within 5s`);
          });
      }

      // Extra wait if subtitles not found yet
      if (subtitles.length === 0) {
        console.warn(`[${domain}] No subtitles yet, waiting extra 5s...`);
        await page.waitForTimeout(5000);
      }
    } else {
      throw new Error(`#the_frame div not found`);
    }

    await page.close();
    await context.close();

    if (!hlsUrl) throw new Error("HLS URL not found");

    return { hls_url: hlsUrl, subtitles, error: null };
  } catch (error) {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    console.error(`[${domain}] Error: ${error.message}`);
    return { hls_url: null, subtitles: [], error: error.message };
  }
}

//Extract endpoint
app.get("/extract", async (req, res) => {
  const type = req.query.type || "movie";
  const tmdb_id = req.query.tmdb_id;
  const season = req.query.season ? parseInt(req.query.season) : undefined;
  const episode = req.query.episode ? parseInt(req.query.episode) : undefined;

  if (!tmdb_id) {
    return res.status(400).json({
      success: false,
      error: "tmdb_id query param is required",
      results: {},
    });
  }

  if (type === "tv" && (season == null || episode == null)) {
    return res.status(400).json({
      success: false,
      error: "season and episode query params are required for TV shows",
      results: {},
    });
  }

  const cacheKey = JSON.stringify(req.query);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60 * 15) {
    console.log("Serving from cache");
    return res.json(cached.response);
  }

  const urls = PROVIDERS.reduce((acc, domain) => {
    acc[domain] =
      type === "tv"
        ? `${domain}/embed/tv?tmdb=${tmdb_id}&season=${season}&episode=${episode}`
        : `${domain}/embed/movie/${tmdb_id}`;
    return acc;
  }, {});

  try {
    const resultsArr = await Promise.all(
      Object.entries(urls).map(([domain, url]) =>
        limit(async () => {
          try {
            const result = await scrapeProvider(domain, url);
            return [domain, result];
          } catch (err) {
            console.error(`[${domain}] Final error: ${err.message}`);
            return [
              domain,
              { hls_url: null, subtitles: [], error: err.message },
            ];
          }
        })
      )
    );

    const results = Object.fromEntries(resultsArr);
    const success = Object.values(results).some((r) => r.hls_url);

    const response = { success, results };

    cache.set(cacheKey, {
      timestamp: Date.now(),
      response,
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Unexpected server error",
      results: {},
    });
  }
});

// 🎯 TMDB -> IMDb
async function getIMDbIdFromTMDB(tmdb_id, type = "movie") {
  const url = `https://api.themoviedb.org/3/${type}/${tmdb_id}/external_ids?api_key=${TMDB_API_KEY}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    console.error("[TMDB] Error:", text);
    throw new Error("Failed to fetch IMDb ID from TMDB");
  }
  const json = await response.json();
  return json.imdb_id || null;
}

// 🧠 Step 1: Search subtitles from OpenSubtitles
async function searchSubtitles(imdb_id) {
  const res = await fetch(
    `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${imdb_id}`,
    {
      headers: { "Api-Key": OPENSUB_API_KEY, "User-Agent": "Cinemi v1.0.0" },
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error("[OpenSubtitles] Search failed:", error);
    throw new Error("Subtitle search failed");
  }

  const json = await res.json();

  const subtitles = json.data
    ?.filter(
      (item) =>
        item.attributes?.files?.[0]?.file_id &&
        COMMON_LANGUAGES.includes(item.attributes.language)
    )
    .map((item) => {
      const file = item.attributes.files[0];
      const langCode = item.attributes.language;
      return {
        language: langCode,
        language_name: LANGUAGE_NAMES[langCode] || langCode,
        file_id: file.file_id,
      };
    });

  return subtitles || [];
}

// 🧠 Step 2: Get usable download URL from OpenSubtitles API
async function getSubtitleDownloadUrl(file_id) {
  const res = await fetch("https://api.opensubtitles.com/api/v1/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": OPENSUB_API_KEY,
      "User-Agent": "Cinemi v1.0.0", // ✅ Required
    },
    body: JSON.stringify({ file_id }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[OpenSubtitles] Failed to get download link:", text);
    throw new Error("Subtitle download URL fetch failed");
  }

  const json = await res.json();
  return json.link;
}

// 🧠 Step 3: Orchestrate full subtitle fetch flow
async function getSubtitlesWithDownloadLinks(imdb_id) {
  const baseList = await searchSubtitles(imdb_id);

  const results = await Promise.all(
    baseList.map(async (sub) => {
      try {
        const downloadUrl = await getSubtitleDownloadUrl(sub.file_id);
        return {
          language: sub.language,
          language_name: sub.language_name,
          url: downloadUrl,
        };
      } catch (err) {
        console.warn(`[Subtitle] Failed for ${sub.language}: ${err.message}`);
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

// 🟢 Subtitles endpoint
app.get("/subtitles", async (req, res) => {
  const { tmdb_id, type = "movie", season, episode } = req.query;

  if (!tmdb_id) {
    return res
      .status(400)
      .json({ success: false, error: "tmdb_id is required" });
  }

  try {
    const imdb_id = await getIMDbIdFromTMDB(tmdb_id, type);

    if (!imdb_id) {
      return res
        .status(404)
        .json({ success: false, error: "IMDb ID not found" });
    }

    const subtitles = await getSubtitlesWithDownloadLinks(imdb_id);

    return res.json({
      success: true,
      subtitles,
      meta: {
        tmdb_id,
        imdb_id,
        type,
        season: season || null,
        episode: episode || null,
      },
    });
  } catch (err) {
    console.error("[/subtitles] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send(
    "🎬 VidSrc Scraper API is running. Visit /subtitles or /extract to use."
  );
});

// Launch browser once before server starts listening
(async () => {
  browser = await chromium.launch({
    headless: true,
  });
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
})();

// Graceful shutdown: close browser on exit
process.on("SIGINT", async () => {
  console.log("Closing browser...");
  if (browser) await browser.close();
  process.exit();
});
process.on("SIGTERM", async () => {
  console.log("Closing browser...");
  if (browser) await browser.close();
  process.exit();
});
