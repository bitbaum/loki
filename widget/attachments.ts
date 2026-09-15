/**
 * Screenshot attachments: the file picker + paste path, client-side downscale,
 * and the thumbnail strip. Owns the shot list; the panel reads it at submit.
 */
import { CAMERA_SVG, downscaleImage, h } from "./dom";

export type Attachments = {
  shots(): string[];
  render(): void;
  attach(file: Blob | null | undefined): Promise<void>;
  attachMany(files: FileList | null): Promise<void>;
  reset(): void;
};

export function createAttachments(opts: {
  attachBtn: HTMLButtonElement;
  container: HTMLElement;
  max: number;
  onError(message: string): void;
}): Attachments {
  const { attachBtn, container, max } = opts;
  let shots: string[] = [];

  function render() {
    container.textContent = "";
    for (let i = 0; i < shots.length; i++) {
      const shotWrap = h("span", "shot");
      const shotImg = h("img");
      shotImg.alt = `Screenshot ${i + 1}`;
      shotImg.src = shots[i];
      const shotRm = h("button", "rm", "✕");
      shotRm.setAttribute("aria-label", `Remove screenshot ${i + 1}`);
      const idx = i;
      shotRm.addEventListener("click", () => {
        shots.splice(idx, 1);
        render();
      });
      shotWrap.append(shotImg, shotRm);
      container.appendChild(shotWrap);
    }
    attachBtn.style.display = shots.length >= max ? "none" : "";
    // Icon + label every time: the old branch replaced the whole button
    // with bare text once a shot was attached, so the camera vanished.
    attachBtn.textContent = "";
    const icon = h("span");
    icon.innerHTML = CAMERA_SVG;
    attachBtn.append(
      icon,
      h("span", undefined, shots.length > 0 ? `Add more (${shots.length}/${max})` : "Screenshots"),
    );
  }

  async function attach(file: Blob | null | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    if (shots.length >= max) {
      opts.onError(`Maximum ${max} screenshots`);
      return;
    }
    const dataUrl = await downscaleImage(file);
    if (dataUrl) {
      shots.push(dataUrl);
      render();
    } else {
      opts.onError("Could not attach that image — try a smaller one");
    }
  }

  async function attachMany(files: FileList | null) {
    if (!files) return;
    for (let i = 0; i < files.length && shots.length < max; i++) {
      await attach(files[i]);
    }
  }

  return {
    shots: () => shots,
    render,
    attach,
    attachMany,
    reset: () => {
      shots = [];
    },
  };
}
