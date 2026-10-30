/** The project's site as the workbench opens it: the address, the owner's
 *  link into it (the pass that makes a note build at once), and whether it
 *  is the live site or a preview — the window must say which. */
export type WorkbenchSite = {
  url: string;
  ownerUrl: string | null;
  kind: "live" | "preview";
};
