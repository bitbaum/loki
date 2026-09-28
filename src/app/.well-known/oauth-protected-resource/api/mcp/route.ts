// RFC 9728 §3.1: the metadata for a resource with a path (/api/mcp) is served
// at the well-known prefix + that path. Some clients derive this url, others
// the bare one; both answer with the same document.
export { GET, OPTIONS } from "../../route";

// Segment config is read statically per file, so it cannot ride the re-export.
export const dynamic = "force-dynamic";
