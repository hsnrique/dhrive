import { useEffect, useState, type ClipboardEvent } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileText, Image, X } from "lucide-react";

import { pickFiles, revealFile, saveAttachment, type Attachment } from "@/lib/api";
import { MAX_ATTACHMENTS, pastedImage, pastedKind, withAdded } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

// Files going with the next request: pasted screenshots, files dropped on the window, and files
// picked with the paperclip. Pasted images keep a preview while they wait in the composer.

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const report = useApp((s) => s.reportError);
  const add = (added: (string | Attachment)[]) => setItems((current) => withAdded(current, added));

  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    try {
      getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          setDragging(payload.type === "enter" || payload.type === "over");
          if (payload.type === "drop") setItems((current) => withAdded(current, payload.paths));
        })
        .then((unlisten) => (gone ? unlisten() : (stop = unlisten)))
        .catch(() => undefined);
    } catch {
      // Outside Tauri (the browser preview) there is no window to drop files on.
    }
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  const pasteImage = async (file: File, kind: string) => {
    try {
      const path = await saveAttachment(new Uint8Array(await file.arrayBuffer()), kind);
      const preview = await readAsDataUrl(file);
      setPreviews((current) => ({ ...current, [path]: preview }));
      add([pastedImage(path)]);
    } catch (error) {
      report(error);
    }
  };

  // Only a pasted image is taken over; pasted text goes into the box as usual.
  const onPaste = (e: ClipboardEvent) => {
    const images = [...e.clipboardData.files].map((file) => [file, pastedKind(file.type)] as const).filter((pair): pair is readonly [File, string] => pair[1] !== null);
    if (images.length === 0) return;
    e.preventDefault();
    for (const [file, kind] of images) void pasteImage(file, kind);
  };

  const pick = async () => {
    try {
      add(await pickFiles());
    } catch (error) {
      report(error);
    }
  };

  return {
    items,
    previews,
    dragging,
    full: items.length >= MAX_ATTACHMENTS,
    onPaste,
    pick,
    remove: (path: string) => setItems((current) => current.filter((a) => a.path !== path)),
    clear: () => {
      setItems([]);
      setPreviews({});
    },
  };
}

function Chip({ attachment, preview, onRemove }: { attachment: Attachment; preview?: string; onRemove?: () => void }) {
  const report = useApp((s) => s.reportError);
  const Icon = attachment.image ? Image : FileText;
  return (
    <span className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-border bg-white/[0.04] py-1 pl-1.5 pr-1.5 text-[12px]">
      {preview ? <img src={preview} alt="" className="h-6 w-6 flex-none rounded object-cover" /> : <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" />}
      <button type="button" title={`${attachment.path}\nShow in Finder`} className="min-w-0 truncate hover:underline" onClick={() => void revealFile(attachment.path).catch(report)}>
        {attachment.name}
      </button>
      {onRemove && (
        <button type="button" aria-label={`Remove ${attachment.name}`} className="flex-none rounded text-muted-foreground hover:text-foreground" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

export function AttachmentChips({ items, previews, onRemove, className }: { items: Attachment[]; previews?: Record<string, string>; onRemove?: (path: string) => void; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((attachment) => (
        <Chip key={attachment.path} attachment={attachment} preview={previews?.[attachment.path]} onRemove={onRemove && (() => onRemove(attachment.path))} />
      ))}
    </div>
  );
}
