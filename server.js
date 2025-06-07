const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Create screenshots folder if doesn't exist
const screenshotsDir = path.join(__dirname, "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir);
}

// List of vidsrc domains to try
const PROVIDERS = [
  "https://vidsrc.xyz",
  "https://vidsrc.in",
  "https://vidsrc.pm",
  "https://vidsrc.net",
];

// Removed withTimeout helper function entirely

async function scrapeProvider(domain, url) {
  console.log(`\n[${domain}] Starting scrape for URL: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  const page = await context.newPage();

  let hlsUrl = null;
  let subtitles = [];

  try {
    await page.route("**/*", (route) => {
      const request = route.request();
      const reqUrl = request.url();

      if (!hlsUrl && reqUrl.includes(".m3u8")) {
        hlsUrl = reqUrl;
        console.log(`[${domain}] Found HLS URL: ${hlsUrl}`);
      }
      if (reqUrl.endsWith(".vtt") || reqUrl.endsWith(".srt")) {
        subtitles.push(reqUrl);
        console.log(`[${domain}] Found subtitle URL: ${reqUrl}`);
      }
      route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log(`[${domain}] Page loaded`);

    // Wait for #the_frame div
    const frameDiv = await page.waitForSelector("#the_frame", {
      timeout: 8000,
    });

    if (!frameDiv) {
      throw new Error(`#the_frame div not found on ${domain}`);
    }

    const box = await frameDiv.boundingBox();

    if (box) {
      const clickX = box.x + box.width / 2;
      const clickY = box.y + box.height / 2;
      console.log(
        `[${domain}] Clicking #the_frame at (${clickX.toFixed(
          1
        )}, ${clickY.toFixed(1)})`
      );

      await page.mouse.move(clickX, clickY);
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(5000); // wait 5 sec for streams to load
    } else {
      console.warn(`[${domain}] Could not get bounding box for #the_frame`);
      // fallback to JS click
      await page.evaluate(() => {
        document.querySelector("#the_frame")?.click();
      });
      await page.waitForTimeout(5000);
    }

    // Take screenshot
    const screenshotName = `${domain
      .replace(/^https?:\/\//, "")
      .replace(/\./g, "_")}_${Date.now()}.png`;
    const screenshotPath = path.join(screenshotsDir, screenshotName);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${domain}] Screenshot saved to ${screenshotPath}`);

    await browser.close();

    if (!hlsUrl) {
      throw new Error("HLS URL not found");
    }

    return {
      hls_url: hlsUrl,
      subtitles,
      screenshot: screenshotName,
      error: null,
    };
  } catch (error) {
    await browser.close();
    console.error(`[${domain}] Error: ${error.message}`);
    return {
      hls_url: null,
      subtitles: [],
      screenshot: null,
      error: error.message,
    };
  }
}

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

  // Build URLs per domain
  const urls = PROVIDERS.reduce((acc, domain) => {
    if (type === "tv") {
      acc[
        domain
      ] = `${domain}/embed/tv?tmdb=${tmdb_id}&season=${season}&episode=${episode}`;
    } else {
      acc[domain] = `${domain}/embed/movie/${tmdb_id}`;
    }
    return acc;
  }, {});

  // Run all scrapes without timeout wrapper
  const promises = Object.entries(urls).map(async ([domain, url]) => {
    try {
      return [domain, await scrapeProvider(domain, url)];
    } catch (err) {
      console.error(`[${domain}] Error: ${err.message}`);
      return [
        domain,
        { hls_url: null, subtitles: [], screenshot: null, error: err.message },
      ];
    }
  });

  const resultsArr = await Promise.all(promises);
  const results = Object.fromEntries(resultsArr);

  // Determine if any success
  const success = Object.values(results).some((r) => r.hls_url);

  res.json({ success, results });
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`Screenshots saved in /screenshots folder`);
});
