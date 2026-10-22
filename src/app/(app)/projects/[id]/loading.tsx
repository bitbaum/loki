/** Match the workspace's hierarchy while its authorized dossier is loading:
 *  the way back, the name, the section switcher, the state sentence. */
export default function LoadingProject() {
  return (
    <div
      className="app-page ui-project-workspace"
      data-fc-place="tab"
      role="status"
      aria-label="Loading project"
    >
      <span className="sr-only">Loading project…</span>
      <div className="space-y-6 motion-safe:animate-pulse" aria-hidden="true">
        <div className="space-y-3">
          <div className="h-5 w-20 rounded-lg bg-surface-raised" />
          <div className="h-8 w-40 rounded-lg bg-surface-raised" />
        </div>
        <div className="h-6 w-28 rounded-lg bg-surface-raised" />
        <div className="ui-project-current-work">
          <div className="h-6 w-2/3 rounded-lg bg-surface-raised" />
          <div className="h-5 w-full rounded-lg bg-surface-raised" />
          <div className="h-11 w-32 rounded-full bg-surface-raised" />
        </div>
      </div>
    </div>
  );
}
