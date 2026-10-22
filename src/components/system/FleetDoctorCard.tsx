"use client";

import { CheckCircle2, Stethoscope, TriangleAlert, XCircle } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { FetchErrorState } from "@/components/ui/fetch-error-state";
import { useFetch } from "@/hooks/use-fetch";
import { REFRESH_CADENCE } from "@/config/refresh";

type DoctorStatus = "pass" | "warn" | "fail";
type DoctorCheck = {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
};
type DoctorData = {
  runtime: boolean;
  checkedAt?: string;
  summary: { status: DoctorStatus; pass: number; warn: number; fail: number };
  checks: DoctorCheck[];
};

const TONE: Record<DoctorStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  pass: { icon: CheckCircle2, cls: "text-status-positive", label: "healthy" },
  warn: { icon: TriangleAlert, cls: "text-status-warning", label: "needs attention" },
  fail: { icon: XCircle, cls: "text-status-negative", label: "broken" },
};

export function FleetDoctorCard() {
  const { data, loading, error, refetch } = useFetch<DoctorData>("/api/system/doctor", {
    intervalMs: REFRESH_CADENCE.system,
    timeoutMs: 15_000,
  });

  if (loading) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Stethoscope} title="Health check" />
        <p className="text-sm text-text-secondary">Checking local runtime...</p>
      </SystemBlock>
    );
  }

  if (error || !data) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Stethoscope} title="Health check" />
        <FetchErrorState message="Couldn't run Fleet Doctor" detail={error} onRetry={refetch} />
      </SystemBlock>
    );
  }

  // Hosted view: the doctor's checks need the local runtime, so "can't run
  // here" is NOT-APPLICABLE — rendering it as an amber "needs attention"
  // manufactured a permanent false alarm on /system. Say what's true, calmly.
  if (!data.runtime) {
    return (
      <SystemBlock>
        <SystemBlockHeader
          icon={Stethoscope}
          title="Health check"
          right={
            <span className="text-xs font-medium text-text-tertiary">not applicable here</span>
          }
        />
        <p className="text-sm text-text-secondary">
          Full health checks run where the local runtime lives — the desktop app or the box install.
          Nothing is wrong; this hosted view just can&apos;t run them.
        </p>
      </SystemBlock>
    );
  }

  const summaryTone = TONE[data.summary.status];

  return (
    <SystemBlock>
      <SystemBlockHeader
        icon={Stethoscope}
        title="Health check"
        right={
          <span className={`text-xs font-medium ${summaryTone.cls}`}>{summaryTone.label}</span>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2 text-xs text-text-tertiary">
        <span>{data.summary.pass} pass</span>
        <span>{data.summary.warn} warn</span>
        <span>{data.summary.fail} fail</span>
      </div>
      <ul className="space-y-2">
        {data.checks.map((item) => {
          const tone = TONE[item.status];
          const Icon = tone.icon;
          return (
            <li key={item.id} className="flex items-start gap-2 text-sm">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.cls}`} />
              <div className="min-w-0">
                <div className="font-medium text-text-primary">{item.label}</div>
                <div className="truncate text-xs text-text-secondary" title={item.detail}>
                  {item.detail}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </SystemBlock>
  );
}
