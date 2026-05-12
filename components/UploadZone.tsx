"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/store";
import { loadPdfDocument } from "@/lib/pdf";
import { uid } from "@/lib/utils";
import type { Page } from "@/lib/types";

export function UploadZone() {
  const router = useRouter();
  const loadPdf = useEditor((s) => s.loadPdf);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("Please upload a PDF file.");
        return;
      }
      setBusy(true);
      try {
        const bytes = await file.arrayBuffer();
        const doc = await loadPdfDocument(bytes);
        const pages: Page[] = [];
        for (let i = 0; i < doc.numPages; i++) {
          pages.push({ id: uid(), ref: { kind: "pdf", pdfPageIndex: i }, annotations: [] });
        }
        loadPdf(file.name, bytes, pages);
        router.push("/editor");
      } catch (e) {
        console.error(e);
        toast.error("Failed to load PDF.");
        setBusy(false);
      }
    },
    [loadPdf, router],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      if (files[0]) handleFile(files[0]);
    },
    [handleFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`group relative w-full max-w-xl cursor-pointer rounded-xl border-2 border-dashed bg-card/40 p-12 text-center transition ${
        isDragActive ? "border-primary bg-accent" : "border-border hover:border-primary/60"
      }`}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-4">
        {busy ? (
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        ) : (
          <Upload className="h-10 w-10 text-muted-foreground transition group-hover:text-primary" />
        )}
        <div className="space-y-1">
          <p className="text-base font-medium">
            {busy ? "Opening PDF…" : isDragActive ? "Drop the PDF here" : "Drop a PDF here, or click to choose"}
          </p>
          <p className="text-xs text-muted-foreground">Everything stays in your browser.</p>
        </div>
      </div>
    </div>
  );
}
