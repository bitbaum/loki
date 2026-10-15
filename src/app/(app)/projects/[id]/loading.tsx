/** Match the workspace's hierarchy while its authorized dossier is loading. */
export default function LoadingProject() {
  return (
    <div
      className="app-page ui-project-workspace"
      data-fc-place="hidden"
      role="status"
      aria-label="Loading project"
    >
      <span className="sr-only">Loading project…</span>
      <div className="space-y-5 motion-safe:animate-pulse" aria-hidden="true">
        <div className="h-11 w-24 rounded-lg bg-surface-raised" />
        <div className="h-10 w-40 rounded-lg bg-surface-raised" />
        <div className="h-5 w-3/4 rounded-lg bg-surface-raised" />
        <div className="flex gap-2">
          <div className="h-11 w-28 rounded-lg bg-surface-raised" />
          <div className="h-11 w-28 rounded-lg bg-surface-raised" />
        </div>
        <div className="h-14 rounded-lg bg-surface-raised" />
        <div className="ui-project-current-work">
          <div className="h-5 w-24 rounded-lg bg-surface-raised" />
          <div className="h-7 w-2/3 rounded-lg bg-surface-raised" />
          <div className="h-5 w-full rounded-lg bg-surface-raised" />
          <div className="h-11 w-32 rounded-lg bg-surface-raised" />
        </div>
      </div>
    </div>
  );
}
