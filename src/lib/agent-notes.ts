/**
 * What a repository's agent files say about it, for profile enrichment.
 *
 * Fleet repos keep their agent notes in AGENTS.md; CLAUDE.md there is a
 * one-line pointer to it, which tells the model nothing. A repo outside the
 * fleet may still keep real notes in CLAUDE.md, so those are kept.
 */
const POINTER = /^\s*(?:@AGENTS\.md|Read \[AGENTS\.md\])/;

export function agentNotes(claudeMd: string | null): string | null {
  if (!claudeMd) return null;
  return POINTER.test(claudeMd) && claudeMd.length < 400 ? null : claudeMd;
}
