import storage from "./storage";
import type { Attachment } from "@/types";

const MAX_DIM = 1920;
const JPEG_QUALITY = 0.85;

let counter = 0;
function mkAttId(): string {
  counter++;
  return "att:a" + Date.now().toString(36) + "_" + counter;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = (r.result as string) || "";
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

// Resize to fit within MAX_DIM on the longer side, re-encode.
// PNG stays PNG (transparency), everything else becomes JPEG at 85%.
export async function resizeImageFile(
  file: File,
): Promise<{ data: string; mediaType: string }> {
  const img = await loadImage(file);
  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);

  const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, outType, JPEG_QUALITY),
  );
  if (!blob) throw new Error("Canvas export failed");
  const data = await blobToBase64(blob);
  return { data, mediaType: outType };
}

// Read a file as-is (for PDFs that we don't resize).
export async function readFileAsBase64(file: File): Promise<string> {
  return blobToBase64(file);
}

// Move the heavy `data` out of a commit attachment into its own storage key.
// Returns a lightweight attachment that only holds { type, mediaType, name, ref }.
// Throws if storage.set fails (quota).
export function externalizeAttachment(a: Attachment): Attachment {
  if (!a.data) return a;
  const ref = a.ref || mkAttId();
  storage.set(ref, a.data);
  return { type: a.type, mediaType: a.mediaType, name: a.name, ref };
}

// Load the data blob for an attachment that has a ref.
export function hydrateAttachment(a: Attachment): Attachment {
  if (a.data) return a;
  if (!a.ref) return a;
  const stored = storage.get(a.ref).value;
  if (stored) return { ...a, data: stored };
  return a;
}

export function hydrateAttachments(
  atts: Attachment[] | undefined,
): Attachment[] | undefined {
  if (!atts) return atts;
  return atts.map(hydrateAttachment);
}

// Get a data URL suitable for <img src>.
export function getAttachmentSrc(a: Attachment): string {
  if (a.data) return "data:" + a.mediaType + ";base64," + a.data;
  if (a.ref) {
    const stored = storage.get(a.ref).value;
    if (stored) return "data:" + a.mediaType + ";base64," + stored;
  }
  return "";
}

// Delete the backing data for an attachment (no-op if stored inline).
export function deleteAttachmentData(a: Attachment): void {
  if (a.ref) storage.del(a.ref);
}

// Collect all refs across a list of commits.
export function collectAttachmentRefs(
  commits: { attachments?: Attachment[] }[] | undefined,
): string[] {
  const out: string[] = [];
  if (!commits) return out;
  for (const c of commits) {
    for (const a of c.attachments || []) {
      if (a.ref) out.push(a.ref);
    }
  }
  return out;
}
