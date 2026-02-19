export function splitIntoChunks(text, maxLength) {
  const stanzas = text.split("\n\n");
  const chunks = [];
  let currentChunk = "";

  for (const stanza of stanzas) {
    if ((currentChunk + "\n\n" + stanza).length <= maxLength) {
      currentChunk += (currentChunk ? "\n\n" : "") + stanza;
      continue;
    }

    if (currentChunk) chunks.push(currentChunk);
    if (stanza.length <= maxLength) {
      currentChunk = stanza;
      continue;
    }

    const lines = stanza.split("\n");
    currentChunk = "";
    for (const line of lines) {
      if ((currentChunk + "\n" + line).length > maxLength && currentChunk) {
        chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk += (currentChunk ? "\n" : "") + line;
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}
