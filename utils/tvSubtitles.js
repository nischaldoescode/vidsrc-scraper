import fetch from "node-fetch";
import * as cheerio from "cheerio";
import AdmZip from "adm-zip";
import srt2vtt from "srt-to-vtt";
import { Readable } from "stream";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

//random sleep function to delay Promise resolving
function randomSleep(min = 4000, max = 6000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  console.log(`⏳ Sleeping for ${delay}ms`);
  return sleep(delay);
}

// Function to build Zip url from title
function buildZipUrlFromTitle(title) {
  // 1. Remove parentheses
  console.log("Title: " + title);
  const clean = title.replace(/[()]/g, "").trim();
  console.log("Cleaned Title: " + clean);

  // 2. Use regex to split the title into showName, episode, and release
  const match = clean.match(/^(.+?)\s+(\d+x\d+)\s+(.+)$/);
  if (!match) {
    console.warn("⚠️ Unexpected title format. Using fallback.");
    const fallback = clean.replace(/\s+/g, "_") + ".en.zip";
    return `https://www.tvsubtitles.net/files/${fallback}`;
  }

  const [showTitle, showName, episodeCode, releaseInfo] = match;

  const fileName = `${showName}_${episodeCode}_${releaseInfo}.en.zip`;

  // 3. Return encoded full URL
  return `https://www.tvsubtitles.net/files/${encodeURIComponent(fileName)}`;
}

// Function to search exact tv show and return id
async function searchTVShow(title) {
  try {
    const searchRes = await fetch("https://www.tvsubtitles.net/search.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ qs: title }).toString(),
    });

    const html = await searchRes.text();
    const $ = cheerio.load(html);

    // Find anchor tags with href starting with '/tvshow-' and filter by text content
    const link = $("a[href^='/tvshow-']")
      .filter(function () {
        return $(this).text().toLowerCase().includes(title.toLowerCase());
      })
      .first()
      .attr("href");

    if (!link) throw new Error("No TV show found");

    const idMatch = link.match(/tvshow-(\d+)\.html/);
    if (!idMatch) throw new Error("Show ID not found");

    return idMatch[1];
  } catch (err) {
    console.error("❌ TVSubtitles Search Error:", err.message);
  }
}

// Function to return Subtitle Id and Episode Title from episode page
async function getSubtitleIDAndEpisodeTitle(episodePageId) {
  try {
    const url = `https://www.tvsubtitles.net/episode-${episodePageId}-en.html`;
    console.log("📄 Fetching episode page:", url);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Connection: "keep-alive",
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Get the first English subtitle link on the episode page
    const anchor = $("a[href^='/subtitle-']").first();
    if (!anchor.length) {
      console.warn("❌ No subtitle link found");
      return null;
    }

    // Extract subtitleId
    const subtitleId = anchor.attr("href")?.match(/subtitle-(\d+)\.html/)?.[1];

    // Get the cleaned title
    const h5Text = anchor
      .find("h5")
      .clone()
      .find("img")
      .remove()
      .end()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (!h5Text || !subtitleId) {
      console.warn("❌ Could not extract subtitle title or ID");
      return null;
    }

    console.log("✅ Subtitle ID:", subtitleId);
    console.log("📝 Subtitle Title:", h5Text);
    return { subtitleId, subtitleTitle: h5Text };
  } catch (err) {
    console.error("❌ Subtitle Page Scrape Error:", err.message);
    return null;
  }
}

// Function to return episode page Id from TV Show page
async function getEpisodePageId(showId, seasonNumber, episodeNumber) {
  try {
    const url = `https://www.tvsubtitles.net/tvshow-${showId}-${seasonNumber}.html`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Connection: "keep-alive",
      },
    });

    if (!res.ok) throw new Error("Failed to fetch season page");

    const html = await res.text();
    const $ = cheerio.load(html);

    let episodePageId = null;

    $("table.tableauto tr").each((_, row) => {
      const episodeCell = $(row).find("td").first().text().trim();
      const episodeMatch = episodeCell.match(/^(\d+)x(\d+)$/);

      if (
        episodeMatch &&
        parseInt(episodeMatch[1]) === parseInt(seasonNumber) &&
        parseInt(episodeMatch[2]) === parseInt(episodeNumber)
      ) {
        console.log(
          `✅ Match found for episode ${seasonNumber}x${episodeNumber}`
        );

        const episodeLink = $(row).find("td").eq(1).find("a").attr("href");
        const episodeMatch = episodeLink?.match(/episode-(\d+)\.html/);
        if (episodeMatch) {
          episodePageId = episodeMatch[1];
          console.log(`🎯 Episode Page ID: ${episodePageId}`);
        }
      }
    });

    if (!episodePageId) {
      throw new Error("Episode Page ID not found");
    }

    return episodePageId;
  } catch (err) {
    console.error("❌ TVSubtitles Season Scrape Error:", err.message);
    return null;
  }
}

// Function to return subtitle download link from Subtitle Page (Optional)
async function getActualFilenameFromSubtitlePage(subtitleId) {
  try {
    const url = `https://www.tvsubtitles.net/subtitle-${subtitleId}.html`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Connection: "keep-alive",
      },
    });

    if (!res.ok) throw new Error("Failed to fetch subtitle page");

    const html = await res.text();
    const $ = cheerio.load(html);

    let filename = null;

    $(".subtitle_grid div").each((i, el) => {
      const label = $(el).text().trim().toLowerCase();
      if (label === "filename:") {
        const value = $(el).next().text().trim();
        filename = value;
      }
    });

    if (!filename) {
      console.warn("⚠️ Could not find filename on subtitle page");
      return null;
    }

    return filename;
  } catch (err) {
    console.error("❌ Subtitle Download Page Scrape Error:", err.message);
    return null;
  }
}

// Utility to convert buffer to string
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    let result = "";
    stream.on("data", (chunk) => (result += chunk.toString()));
    stream.on("end", () => resolve(result));
    stream.on("error", reject);
  });
}

// New helper to extract release part from filename
function extractReleaseFromFilename(filename) {
  const parts = filename.split(".");
  const releaseParts = parts.slice(-4, -2); // e.g. ['WebRip', 'NTb', 'en']
  return releaseParts.join(".");
}

// Function to download and convert .srt file and return .vtt content using the zipUrl
async function downloadAndConvertToVTT(zipUrl) {
  try {
    const zipRes = await fetch(zipUrl);
    if (!zipRes.ok) throw new Error("Failed to download subtitle ZIP");

    const zipBuffer = await zipRes.buffer();
    const zip = new AdmZip(zipBuffer);
    const srtEntry = zip
      .getEntries()
      .find((entry) => entry.entryName.endsWith(".srt"));

    if (!srtEntry) throw new Error("No .srt file found in ZIP");

    const srtBuffer = srtEntry.getData();
    const srtStream = Readable.from(srtBuffer);

    const vttStream = srtStream.pipe(srt2vtt());
    const vttText = await streamToString(vttStream);

    console.log("✅ Converted VTT:\n");
    console.log(vttText.slice(0, 500)); // show first 500 characters for preview
    return vttText;
  } catch (err) {
    console.error("❌ Conversion error:", err.message);
    return null;
  }
}

export async function getTVSubtitleVTT(title, season, episode) {
  const showId = await searchTVShow(title);
  await randomSleep();
  const episodeId = await getEpisodePageId(showId, season, episode);
  await randomSleep();
  const subtitleMeta = await getSubtitleIDAndEpisodeTitle(episodeId);
  const { subtitleId, subtitleTitle } = subtitleMeta;
  const actualFilename = await getActualFilenameFromSubtitlePage(subtitleId);

  let finalTitle = subtitleTitle;

  if (actualFilename) {
    const correctRelease = extractReleaseFromFilename(actualFilename); // e.g. "WebRip.NTb.en"

    // Extract current release inside parentheses
    const match = subtitleTitle.match(/\(([^)]+)\)/);
    const currentRelease = match ? match[1] : null;

    if (currentRelease && currentRelease !== correctRelease) {
      finalTitle = subtitleTitle.replace(/\([^)]+\)/, `(${correctRelease})`);
    }
  }
  await randomSleep();
  const zipUrl = buildZipUrlFromTitle(finalTitle);
  return await downloadAndConvertToVTT(zipUrl);
}
