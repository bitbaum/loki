/** The project's site as the workbench offers it: the address people read,
 *  the address that is opened (the owner's link carries the pass that makes
 *  a note build at once, lib/feedback/owner-pass.ts), and whether it is the
 *  live site or a preview — the window must say which. */
export type WorkbenchSite = {
  url: string;
  href: string;
  kind: "live" | "preview";
};
