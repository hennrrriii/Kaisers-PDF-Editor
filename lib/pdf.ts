"use client";
// pdf.js loader. We set the workerSrc to the bundled worker via a CDN-free approach using a local worker URL.
import * as pdfjs from "pdfjs-dist";

let initialized = false;
export function initPdfJs() {
  if (initialized) return;
  // Use a worker URL relative to /node_modules served by Next via static import.
  // pdfjs-dist ships a worker that we copy to /public/pdf.worker.min.mjs OR set workerSrc to CDN.
  // Use unpkg/jsdelivr as a reliable fallback that works in Vercel.
  (pdfjs as any).GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjs as any).version}/build/pdf.worker.min.mjs`;
  initialized = true;
}

export async function loadPdfDocument(bytes: ArrayBuffer) {
  initPdfJs();
  const copy = bytes.slice(0);
  const loadingTask = (pdfjs as any).getDocument({ data: copy });
  const doc = await loadingTask.promise;
  return doc;
}

export type LoadedPdf = Awaited<ReturnType<typeof loadPdfDocument>>;
