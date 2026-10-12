import type { MessageImage } from "@/lib/loki/message-images";

/**
 * The pictures someone sent with a message, above their words — the
 * screenshot is usually the point of the message, so it leads. Each opens
 * full size in a new tab; a stored one is served only to its owner.
 */
export function MessageImages({ images }: { images: MessageImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className="ui-loki-msg-images">
      {images.map((img) => (
        <a
          key={img.src}
          href={img.src}
          target="_blank"
          rel="noreferrer"
          className="ui-loki-msg-image"
          title={img.caption}
        >
          {/* An owner-only API image (or the sender's own picked file while
              sending), not a static asset — next/image would proxy it
              through the optimizer without the session. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.src} alt={img.caption} loading="lazy" />
        </a>
      ))}
    </div>
  );
}
