import type { FileAction } from "./types.js";

const startMarker = "<!-- hermes-action-bridge:start -->";
const endMarker = "<!-- hermes-action-bridge:end -->";

export interface MarkerResult {
  content: string;
  action: FileAction;
  reason?: string | undefined;
}

function block(innerText: string): string {
  return `${startMarker}\n${innerText}\n${endMarker}`;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Reject ambiguous marker states rather than guessing block boundaries (data-loss guard). */
function markersMalformed(content: string): boolean {
  const starts = countOccurrences(content, startMarker);
  const ends = countOccurrences(content, endMarker);
  if (starts !== ends || starts > 1) return true;
  return starts === 1 && content.indexOf(startMarker) > content.indexOf(endMarker);
}

/** Insert or update the single managed block, preserving all content outside it. */
export function upsertBlock(existing: string | null, innerText: string): MarkerResult {
  const desired = block(innerText);
  if (existing === null) return { content: `${desired}\n`, action: "created" };
  if (markersMalformed(existing)) {
    return { content: existing, action: "refused", reason: "existing hermes-action-bridge markers are malformed" };
  }
  if (existing.includes(startMarker)) {
    const before = existing.slice(0, existing.indexOf(startMarker));
    const after = existing.slice(existing.indexOf(endMarker) + endMarker.length);
    const content = before + desired + after;
    return { content, action: content === existing ? "unchanged" : "updated" };
  }
  if (existing.trim() === "") return { content: `${desired}\n`, action: "updated" };
  // Append after the existing content, preserving its bytes, with exactly one blank line before the block.
  const blankLineGap = "\n".repeat(Math.max(0, 2 - trailingNewlines(existing)));
  return { content: `${existing}${blankLineGap}${desired}\n`, action: "updated" };
}

/** Remove the managed block, tidying only the seam and leaving all other content byte-for-byte. */
export function removeBlock(existing: string): MarkerResult {
  if (markersMalformed(existing)) {
    return { content: existing, action: "refused", reason: "existing hermes-action-bridge markers are malformed" };
  }
  if (!existing.includes(startMarker)) return { content: existing, action: "unchanged" };
  const before = existing.slice(0, existing.indexOf(startMarker)).replace(/(\r?\n)+$/, "");
  const after = existing.slice(existing.indexOf(endMarker) + endMarker.length).replace(/^(\r?\n)+/, "");
  return { content: joinSeam(before, after), action: "removed" };
}

/** Re-join content around a removed block: one blank line if it sat between sections, else a clean edge. */
function joinSeam(before: string, after: string): string {
  if (before === "") return after;
  if (after === "") return `${before}\n`;
  return `${before}\n\n${after}`;
}

/** Count trailing line breaks, tolerating both LF and CRLF endings. */
function trailingNewlines(text: string): number {
  const tail = text.slice(text.replace(/(\r?\n)+$/, "").length);
  return tail === "" ? 0 : tail.split(/\r?\n/).length - 1;
}
