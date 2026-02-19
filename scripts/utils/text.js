export function cleanLyrics(text) {
  const lines = text.split("\n");
  return lines
    .filter((line) => {
      const l = line.trim().toLowerCase();
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
