import type { Attachment } from "@/lib/api";

// Turning what the owner pasted, dropped or picked into attachments a request carries.

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const KINDS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export const MAX_ATTACHMENTS = 10;

export function attachmentFor(path: string): Attachment {
  return { path, name: path.split("/").pop() || path, image: IMAGE.test(path) };
}

// The file kind a pasted image is saved as, or null for anything that isn't one.
export const pastedKind = (mime: string): string | null => KINDS[mime] ?? null;

// A pasted image is saved under a machine name; the owner sees what it is instead.
export const pastedImage = (path: string): Attachment => ({ ...attachmentFor(path), name: "Pasted image" });

// New ones join the end; one already attached isn't added twice, and the list stops at the limit.
export function withAdded(current: Attachment[], added: (string | Attachment)[]): Attachment[] {
  const next = [...current];
  for (const item of added) {
    const attachment = typeof item === "string" ? attachmentFor(item) : item;
    if (!next.some((a) => a.path === attachment.path)) next.push(attachment);
  }
  return next.slice(0, MAX_ATTACHMENTS);
}
