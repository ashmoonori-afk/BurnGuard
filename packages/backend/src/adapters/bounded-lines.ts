/** Newline-delimited reader shared by every provider runner; a line over 2 MiB fails the turn with `provider_stream_limit`. */
export async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        if (index > 2 * 1024 * 1024) throw new Error("provider_stream_limit");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.length > 0) await onLine(line);
        index = buffer.indexOf("\n");
      }
      // Bound the unterminated line only: a lagging consumer receives large coalesced chunks of short lines.
      if (buffer.length > 2 * 1024 * 1024) throw new Error("provider_stream_limit");
    }
    if (buffer.length > 0) await onLine(buffer);
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
