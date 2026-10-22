import { MessageCircle } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { CHANNEL_CONFIG } from "@/config/channels";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionHeading title={title} />
      <div>{children}</div>
    </section>
  );
}

export function ChannelIcon({ channel }: { channel: string }) {
  const config = CHANNEL_CONFIG[channel];
  if (!config) return <MessageCircle className="h-5 w-5 text-text-tertiary" />;
  const Icon = config.icon;
  return <Icon className={`h-5 w-5 ${config.color}`} />;
}
