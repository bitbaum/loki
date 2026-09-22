/** The list-page project shape — entity row + attrs + runtime meta. Lived in
 *  ProjectGridCard.tsx until the card/row split was unified into ProjectRow;
 *  the type outlived both components. */
export type ProjectGridRow = {
  id: string;
  name: string;
  description: string | null;
  gitUrl?: string | null;
  attrs: Record<string, string>;
  /**
   * Per-attribute provenance: when it was last written, by what, and when it
   * stops being true. Optional because not every caller loads it — absent
   * means "not fetched", never "this flag has no age".
   */
  attrMeta?: Record<
    string,
    { updatedAt: string; source: string | null; validUntil: string | null }
  >;
  readonly?: boolean;
  dirPath?: string | null;
  agentPref?: string | null;
  userProjectId?: string | null;
  liveUrl?: string | null;
  /** Latest probe. null = never checked or no site. */
  siteOk?: boolean | null;
  /** Entity creation time; a project created moments ago sorts to the top. */
  createdAt?: Date | string | null;
};
