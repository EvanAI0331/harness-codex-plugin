export function splitOutputIntoChunks(text: string, targetChunkSize = 1200): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return [];
  }
  if (normalized.length <= targetChunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const hardEnd = Math.min(cursor + targetChunkSize, normalized.length);
    let splitAt = hardEnd;
    if (hardEnd < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf("\n\n", hardEnd);
      const lineBreak = normalized.lastIndexOf("\n", hardEnd);
      const candidate = Math.max(paragraphBreak, lineBreak);
      if (candidate > cursor + Math.floor(targetChunkSize * 0.45)) {
        splitAt = candidate + 1;
      }
    }

    const chunk = normalized.slice(cursor, splitAt).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    cursor = splitAt;
  }

  return chunks;
}
