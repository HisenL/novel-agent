import type { DocumentContent } from "@novel-agent/kernel";

// Identity matters: reopening even the same path creates a newer editor snapshot.
export function applySavedDocument(
  current: DocumentContent | null,
  submitted: DocumentContent,
  saved: DocumentContent,
): DocumentContent | null {
  return current === submitted ? saved : current;
}
