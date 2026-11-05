/**
 * A picture the owner shows the consult (pasted, dropped or chosen): made small enough to send
 * (the long side at most `max` pixels, JPEG) and a thumbnail for the conversation log.
 */
export interface AttachedImage {
  /** What goes to Claude. */
  full: string;
  /** What the log keeps and shows. */
  thumb: string;
}

async function drawn(file: Blob, max: number, quality: number): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    const ok = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!ok || !img.width || !img.height) return null;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * k));
    canvas.height = Math.max(1, Math.round(img.height * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // A transparent screenshot on black reads badly: a mid grey under it.
    ctx.fillStyle = "#7c7c7c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function attachImage(file: Blob): Promise<AttachedImage | null> {
  if (!file.type.startsWith("image/")) return null;
  const full = await drawn(file, 1280, 0.86);
  const thumb = await drawn(file, 200, 0.8);
  return full && thumb ? { full, thumb } : null;
}
