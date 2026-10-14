import { PackageCheck } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import type { UpdateCard } from "@/lib/packages/view";
import { PackageUpdateCard } from "./PackageUpdateCard";

/**
 * Package updates waiting for a person, on Approvals. Rendered only when
 * there are some: the rest of the time updates arrive on their own and there
 * is nothing to show.
 */
export function PackageUpdateQueue({ updates }: { updates: UpdateCard[] }) {
  if (updates.length === 0) return null;
  return (
    <div id="package-updates">
      <Card>
        <CardHeader
          icon={PackageCheck}
          title="Package updates"
          right={
            <span className="text-xs font-medium text-status-warning">
              {updates.length} waiting
            </span>
          }
        />
        <p className="mb-3 text-sm text-text-secondary">
          Held for you by each project&apos;s update setting. Nothing here merges until you say so.
        </p>
        <div className="space-y-3">
          {updates.map((u) => (
            <PackageUpdateCard key={u.id} update={u} />
          ))}
        </div>
      </Card>
    </div>
  );
}
