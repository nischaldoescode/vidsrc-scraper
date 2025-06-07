# Video Stream Extractor API

A Node.js Express server that scrapes video streaming URLs (HLS `.m3u8` links) and subtitle URLs from multiple VidSrc provider domains using [Playwright](https://playwright.dev/).

---

## Features

- Scrapes multiple VidSrc domains for movie and TV stream URLs.
- Extracts HLS video `.m3u8` URLs and subtitle files (`.vtt`, `.srt`).
- Headless browser automation with Playwright and Chromium.
- Takes screenshots of the stream page during scraping (saved in `/screenshots`).
- Simple REST API with `/extract` endpoint.
- Ready for deployment on Railway or any Docker-compatible host.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or higher installed.
- [Docker](https://www.docker.com/) installed (optional, recommended for deployment).
- Git (for version control).

---

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/your-repo.git
   cd your-repo

   ```

2. Install dependencies:
   npm install

3. Run the server locally:
   npm start

By default, the server listens on port 3000. To use a different port, set the environment variable: PORT=4000

---

## API Usage

Endpoint: /extract
Method: GET

Extract video stream URLs and subtitles.

## Query Parameters:

### Parameter Type Required Description

tmdb_id string Yes TMDB movie or TV show ID
type string No "movie" (default) or "tv"
season integer Required if type=tv TV show season number
episode integer Required if type=tv TV show episode number

---

## Examples

Movie
GET /extract?tmdb_id=550&type=movie

TV Show
GET /extract?tmdb_id=1399&type=tv&season=1&episode=1

Response Format:
{
"success": true,
"results": {
"https://vidsrc.xyz": {
"hls_url": "https://example.m3u8",
"subtitles": [
"https://example.vtt"
],
"error": null
},
"https://vidsrc.in": {
"hls_url": "https://example.m3u8",
"subtitles": [
"https://example.vtt"
],
"error": null
},
"https://vidsrc.pm": {
"hls_url": "https://example.m3u8",
"subtitles": [
"https://example.vtt"
],
"error": null
},
"https://vidsrc.net": {
"hls_url": "https://example.m3u8",
"subtitles": [
"https://example.vtt"
],
"error": null
}
}
}
