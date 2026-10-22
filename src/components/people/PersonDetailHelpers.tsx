import { MessageCircle } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { CHANNEL_CONFIG, withChannelPrefix } from "@/config/channels";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionHeading title={title} />
      <div>{children}</div>
    </section>
  );
}

/** "whatsapp" or "channel:whatsapp" → "WhatsApp": the name a person says. */
export function channelLabel(channel: string): string {
  return CHANNEL_CONFIG[withChannelPrefix(channel)]?.label ?? channel;
}

export function ChannelIcon({ channel }: { channel: string }) {
  // Attributes store "channel:whatsapp", conversations store "whatsapp".
  const config = CHANNEL_CONFIG[withChannelPrefix(channel)];
  if (!config) return <MessageCircle className="h-5 w-5 text-text-tertiary" />;
  const Icon = config.icon;
  return <Icon className={`h-5 w-5 ${config.color}`} />;
}
