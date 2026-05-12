"use client";
import * as pdfjs from "pdfjs-dist";

// Pinned to the version installed in package.json. Using `pdfjs.version` directly
// can resolve to undefined under aggressive bundling, which 404s the worker.
const PDFJS_VERSION = "4.4.168";

let initialized = false;
export function initPdfJs() {
  if (initialized) return;
  // Local worker shipped from public/. Falls back to jsdelivr if the local one is missing.
  (pdfjs as any).GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  initialized = true;
  void PDFJS_VERSION;
}

export async function loadPdfDocument(bytes: ArrayBuffer) {
  initPdfJs();
  const copy = bytes.slice(0);
  const loadingTask = (pdfjs as any).getDocument({ data: copy });
  const doc = await loadingTask.promise;
  return doc;
}

export type LoadedPdf = Awaited<ReturnType<typeof loadPdfDocument>>;
