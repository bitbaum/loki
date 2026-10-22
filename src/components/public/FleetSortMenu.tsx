"use client";

import { useRouter } from "next/navigation";
import { ChoiceMenu } from "@/components/ui/choice-menu";

/**
 * /fleet's sort, as one "Sort: Name ▾" button (design reset rule 7). Four
 * pills in a row ran off a phone's edge mid-word ("Most gap"). The page keeps
 * the URL as its state: each choice is the address of the same list sorted
 * that way, computed on the server and followed here.
 */
export function FleetSortMenu({
  value,
  options,
}: {
  value: string;
  options: readonly { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <ChoiceMenu
      label="Sort"
      value={value}
      options={options.map(({ value: v, label }) => ({ value: v, label }))}
      onChange={(next) => {
        const href = options.find((o) => o.value === next)?.href;
        if (href) router.push(href, { scroll: false });
      }}
    />
  );
}
