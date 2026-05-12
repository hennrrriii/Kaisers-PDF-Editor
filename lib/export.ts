"use client";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import type { Annotation, Page } from "./types";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

// pdf-lib uses bottom-left origin; canvas/Konva use top-left.
// All annotation coords are in PDF point units matching the original page's viewport at scale=1.
export async function exportPdf(
  originalBytes: ArrayBuffer | null,
  pages: Page[],
  fileName: string,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  let src: PDFDocument | null = null;
  if (originalBytes) {
    src = await PDFDocument.load(originalBytes.slice(0));
  }

  for (const page of pages) {
    let outPage;
    let pageW: number;
    let pageH: number;
    if (page.ref.kind === "pdf" && src) {
      const [copied] = await out.copyPages(src, [page.ref.pdfPageIndex]);
      outPage = out.addPage(copied);
      const { width, height } = outPage.getSize();
      pageW = width;
      pageH = height;
    } else {
      const w = page.ref.kind === "blank" ? page.ref.width : 612;
      const h = page.ref.kind === "blank" ? page.ref.height : 792;
      outPage = out.addPage([w, h]);
      pageW = w;
      pageH = h;
    }

    const flipY = (y: number) => pageH - y;

    for (const ann of page.annotations) {
      switch (ann.type) {
        case "draw": {
          const c = hexToRgb(ann.stroke);
          const pts = ann.points;
          for (let i = 0; i < pts.length - 2; i += 2) {
            outPage.drawLine({
              start: { x: pts[i], y: flipY(pts[i + 1]) },
              end: { x: pts[i + 2], y: flipY(pts[i + 3]) },
              thickness: ann.strokeWidth,
              color: rgb(c.r, c.g, c.b),
            });
          }
          break;
        }
        case "highlight": {
          const c = hexToRgb(ann.stroke);
          const pts = ann.points;
          // Drawn as thick semi-transparent strokes
          for (let i = 0; i < pts.length - 2; i += 2) {
            outPage.drawLine({
              start: { x: pts[i], y: flipY(pts[i + 1]) },
              end: { x: pts[i + 2], y: flipY(pts[i + 3]) },
              thickness: ann.strokeWidth,
              color: rgb(c.r, c.g, c.b),
              opacity: 0.4,
            });
          }
          break;
        }
        case "rect": {
          const c = hexToRgb(ann.stroke);
          const fillColor = ann.fill ? hexToRgb(ann.fill) : null;
          outPage.drawRectangle({
            x: ann.x,
            y: flipY(ann.y + ann.height),
            width: ann.width,
            height: ann.height,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: ann.strokeWidth,
            color: fillColor ? rgb(fillColor.r, fillColor.g, fillColor.b) : undefined,
          });
          break;
        }
        case "circle": {
          const c = hexToRgb(ann.stroke);
          const fillColor = ann.fill ? hexToRgb(ann.fill) : null;
          outPage.drawCircle({
            x: ann.x,
            y: flipY(ann.y),
            size: ann.radius,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: ann.strokeWidth,
            color: fillColor ? rgb(fillColor.r, fillColor.g, fillColor.b) : undefined,
          });
          break;
        }
        case "line": {
          const c = hexToRgb(ann.stroke);
          const [x1, y1, x2, y2] = ann.points;
          outPage.drawLine({
            start: { x: x1, y: flipY(y1) },
            end: { x: x2, y: flipY(y2) },
            thickness: ann.strokeWidth,
            color: rgb(c.r, c.g, c.b),
          });
          break;
        }
        case "arrow": {
          const c = hexToRgb(ann.stroke);
          const [x1, y1, x2, y2] = ann.points;
          outPage.drawLine({
            start: { x: x1, y: flipY(y1) },
            end: { x: x2, y: flipY(y2) },
            thickness: ann.strokeWidth,
            color: rgb(c.r, c.g, c.b),
          });
          // arrowhead
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = 10 + ann.strokeWidth * 2;
          const a1 = angle - Math.PI / 7;
          const a2 = angle + Math.PI / 7;
          const hx1 = x2 - headLen * Math.cos(a1);
          const hy1 = y2 - headLen * Math.sin(a1);
          const hx2 = x2 - headLen * Math.cos(a2);
          const hy2 = y2 - headLen * Math.sin(a2);
          outPage.drawLine({
            start: { x: x2, y: flipY(y2) },
            end: { x: hx1, y: flipY(hy1) },
            thickness: ann.strokeWidth,
            color: rgb(c.r, c.g, c.b),
          });
          outPage.drawLine({
            start: { x: x2, y: flipY(y2) },
            end: { x: hx2, y: flipY(hy2) },
            thickness: ann.strokeWidth,
            color: rgb(c.r, c.g, c.b),
          });
          break;
        }
        case "text": {
          const c = hexToRgb(ann.fill);
          const lines = ann.text.split("\n");
          const size = ann.fontSize;
          lines.forEach((line, i) => {
            outPage.drawText(line, {
              x: ann.x,
              y: flipY(ann.y + size + i * size * 1.2),
              size,
              font,
              color: rgb(c.r, c.g, c.b),
            });
          });
          break;
        }
        case "image": {
          try {
            const dataUrl = ann.src;
            const isPng = dataUrl.startsWith("data:image/png");
            const base64 = dataUrl.split(",")[1];
            const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
            const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
            outPage.drawImage(img, {
              x: ann.x,
              y: flipY(ann.y + ann.height),
              width: ann.width,
              height: ann.height,
              rotate: degrees(0),
            });
          } catch (e) {
            console.warn("image embed failed", e);
          }
          break;
        }
      }
    }
  }

  return out.save();
}

export function downloadBlob(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Opens a native "Save as" dialog in Chromium browsers; falls back to anchor download.
// Returns true if a file was written (or download started), false if the user cancelled.
export async function saveAsPdf(bytes: Uint8Array, suggestedName: string): Promise<boolean> {
  const w = window as any;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "PDF document",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      await writable.close();
      return true;
    } catch (e: any) {
      if (e?.name === "AbortError") return false;
      // Permission errors etc. → fall through to anchor download.
    }
  }
  downloadBlob(bytes, suggestedName);
  return true;
}
