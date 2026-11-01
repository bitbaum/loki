import { Server } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { EmptyState } from "@/components/ui/empty-state";
import { listUsersWithPlans } from "@/db/queries/users";
import { PrivateBuilderForm } from "./PrivateBuilderForm";

/**
 * Who has a private builder on Loki's cloud — their own Linux user, home,
 * runner token and unit on the box — and the switch that gives or takes one.
 * Founder-only. The flag is the whole switch: the box reconciles it within
 * a minute (scripts/hetzner/reconcile-tenants.sh), so nobody opens a shell.
 * docs/architecture/private-builders.md.
 */
export async function PrivateBuildersCard() {
  const rows = await listUsersWithPlans().catch(() => null);
  if (!rows) return null;
  const tenants = rows.filter((r) => !r.isDefault);
  const on = tenants.filter((r) => r.privateBuilder);
  const label = (r: (typeof rows)[number]) => r.username ?? r.name ?? r.email ?? r.id.slice(0, 8);

  return (
    <SystemBlock>
      <SystemBlockHeader
        icon={Server}
        title="Private runners"
        right={
          <span className="text-xs text-text-tertiary">
            {on.length} on the cloud · {tenants.length - on.length} without
          </span>
        }
      />
      <div className="space-y-4">
        {on.length === 0 ? (
          <EmptyState>
            Nobody but you builds on the cloud yet. Switch an account on below: within a minute it
            has its own runner on the box, and its Sessions page shows it.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {on.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm"
              >
                <span className="font-medium text-text-primary">{label(r)}</span>
                <span className="ml-auto font-mono text-xs text-text-tertiary">
                  lk-{r.id.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-micro-label mb-2">Switch</p>
          <PrivateBuilderForm
            users={tenants.map((r) => ({ id: r.id, label: label(r), on: r.privateBuilder }))}
          />
        </div>
      </div>
    </SystemBlock>
  );
}
