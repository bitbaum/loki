import Link from "next/link";
import { Compass } from "lucide-react";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A signed-in address that leads nowhere. One line and the way back (design
 * reset rule 10: no box, no second paragraph). The button names where it goes:
 * it said "Back to Today" for ten days after the home screen became Loki.
 */
export default function NotFound() {
  return (
    <div className="ui-empty-page">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={Compass}
        title="This page doesn’t exist."
        size="lg"
        action={
          <Link href={ROUTES.APP_HOME} className="ui-btn-secondary min-h-11">
            Back to {APP_NAME}
          </Link>
        }
      />
    </div>
  );
}
