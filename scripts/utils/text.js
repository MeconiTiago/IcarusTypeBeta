export function cleanLyrics(text) {
  const source = String(text || "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  return lines
    .map((line) => {
      let cleaned = line.trim();
      if (!cleaned) return "";

      // Remove one or many LRC timestamps at line start: [mm:ss.xx]
      cleaned = cleaned.replace(/^(?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/g, "");
      // Remove common LRC metadata lines: [ar:...], [ti:...], [by:...], etc.
      cleaned = cleaned.replace(/^\[[a-z]{2,8}\s*:[^\]]*\]\s*$/i, "");

      return cleaned.trim();
    })
    .filter((line) => {
      const l = line.toLowerCase();
      return (
        l &&
        !l.includes("paroles de la chanson") &&
        !l.includes("lyrics powered by") &&
        !l.includes("karaoke")
      );
    })
    .join("\n")
    .trim();
}

export function cleanPunctuation(word) {
  return word.replace(/[.,!?;:"()]/g, "");
}
