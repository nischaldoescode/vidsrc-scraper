function extractReleaseFromFilename(filename) {
  const hyphenParts = filename.split(" - ");
  const lastPart = hyphenParts[2] || "";

  // Remove extensions
  const noExt = lastPart.replace(/\.en\.srt$|\.srt$/, "").trim();

  const parts = noExt.split(".");
  const hasResolution = parts.some((p) => /\d{3,4}p/.test(p));

  if (hasResolution) {
    // e.g. "720p HDTV" or "720p HDTV.LOL"
    const resIndex = parts.findIndex((p) => /\d{3,4}p/.test(p));
    const release = parts.slice(resIndex).join(".");
    const [resolution, rip = "", group] = release.split(".");

    return group ? `${resolution} ${rip}.${group}` : `${resolution} ${rip}`;
  } else {
    // No resolution present
    const releaseParts = parts.slice(-2); // e.g. ["HDTV", "LOL"] or ["WEB", "NTb"]
    if (releaseParts.length === 2) {
      return releaseParts.join("."); // Rip + Group => "HDTV.LOL"
    } else if (releaseParts.length === 1) {
      return releaseParts[0]; // Just rip => "WEB"
    } else {
      return "UNKNOWN";
    }
  }
}

extractReleaseFromFilename(
  "Game of Thrones - 1x01 - Winter is Coming.720p HDTV.en.srt"
);
