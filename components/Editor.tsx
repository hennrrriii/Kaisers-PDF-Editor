"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { useEditor } from "@/lib/store";
import { loadPdfDocument } from "@/lib/pdf";
import { exportPdf, saveAsPdf } from "@/lib/export";
import { Toolbar } from "./Toolbar";
import { PdfPage } from "./PdfPage";
import { uid } from "@/lib/utils";
import type { Annotation } from "@/lib/types";

export function Editor() {
  const router = useRouter();
  const pdfBytes = useEditor((s) => s.pdfBytes);
  const pages = useEditor((s) => s.pages);
  const fileName = useEditor((s) => s.fileName);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const setTool = useEditor((s) => s.setTool);
  const deleteAnnotations = useEditor((s) => s.deleteAnnotations);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedPageId = useEditor((s) => s.selectedPageId);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const setCurrentPageIndex = useEditor((s) => s.setCurrentPageIndex);
  const currentPageIndex = useEditor((s) => s.currentPageIndex);
  const dirty = useEditor((s) => s.dirty);
  const markSaved = useEditor((s) => s.markSaved);
  const addAnnotation = useEditor((s) => s.addAnnotation);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveLockRef = useRef(false);

  // Redirect to home if no file
  useEffect(() => {
    if (!pdfBytes) router.replace("/");
  }, [pdfBytes, router]);

  // Load pdfjs doc
  useEffect(() => {
    if (!pdfBytes) return;
    let cancelled = false;
    (async () => {
      const doc = await loadPdfDocument(pdfBytes);
      if (cancelled) return;
      setPdfDoc(doc);
      const sizes: Record<number, { width: number; height: number }> = {};
      for (let i = 0; i < doc.numPages; i++) {
        const p = await doc.getPage(i + 1);
        const vp = p.getViewport({ scale: 1 });
        sizes[i] = { width: vp.width, height: vp.height };
        if (cancelled) return;
      }
      if (!cancelled) setPageSizes(sizes);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes]);

  const getLogicalSize = useCallback(
    (page: (typeof pages)[number]) => {
      if (page.ref.kind === "pdf") {
        return pageSizes[page.ref.pdfPageIndex] ?? { width: 612, height: 792 };
      }
      return { width: page.ref.width, height: page.ref.height };
    },
    [pageSizes],
  );

  const handleSave = useCallback(async () => {
    if (saveLockRef.current) return;
    saveLockRef.current = true;
    const t = toast.loading("Preparing PDF…");
    try {
      const bytes = await exportPdf(pdfBytes, pages, fileName ?? "kaisers.pdf");
      const baseName = (fileName ?? "kaisers.pdf").replace(/\.pdf$/i, "");
      const suggested = `${baseName}_Kaisers_PDF_Editor.pdf`;
      const ok = await saveAsPdf(bytes, suggested);
      if (ok) {
        markSaved();
        toast.success("PDF saved.", { id: t });
      } else {
        toast.dismiss(t);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to export PDF.", { id: t });
    } finally {
      saveLockRef.current = false;
    }
  }, [pdfBytes, pages, fileName, markSaved]);

  // Ctrl+S — register at window level in capture phase so the browser's
  // default "save page as HTML" never wins the race.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [handleSave]);

  // Tool shortcuts (only when not editing text)
  const isTyping = () => {
    const ae = document.activeElement;
    if (!ae) return false;
    const tag = ae.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || (ae as HTMLElement).isContentEditable;
  };
  useHotkeys("v", () => !isTyping() && setTool("cursor"));
  useHotkeys("t", () => !isTyping() && setTool("text"));
  useHotkeys("d", () => !isTyping() && setTool("draw"));
  useHotkeys("h", () => !isTyping() && setTool("highlight"));
  useHotkeys("r", () => !isTyping() && setTool("rect"));
  useHotkeys("c", () => !isTyping() && setTool("circle"));
  useHotkeys("l", () => !isTyping() && setTool("line"));
  useHotkeys("a", () => !isTyping() && setTool("arrow"));
  useHotkeys("e", () => !isTyping() && setTool("eraser"));

  // Delete key removes selection
  useHotkeys(
    "delete, backspace",
    () => {
      if (isTyping()) return;
      if (selectedPageId && selectedIds.length > 0) {
        deleteAnnotations(selectedPageId, selectedIds);
      }
    },
    [selectedIds, selectedPageId],
  );

  // Undo / Redo
  useHotkeys(
    "ctrl+z, meta+z",
    (e) => {
      if (isTyping()) return;
      e.preventDefault();
      undo();
    },
    { enableOnFormTags: false },
  );
  useHotkeys(
    "ctrl+y, meta+y, ctrl+shift+z, meta+shift+z",
    (e) => {
      if (isTyping()) return;
      e.preventDefault();
      redo();
    },
    { enableOnFormTags: false },
  );

  // Ctrl + wheel zoom — accumulated in a ref, flushed once per animation frame.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pendingDelta = 0;
    let rafId = 0;
    const flush = () => {
      rafId = 0;
      if (pendingDelta === 0) return;
      const current = useEditor.getState().zoom;
      const next = Math.max(0.4, Math.min(4, current * (1 + pendingDelta)));
      pendingDelta = 0;
      useEditor.setState({ zoom: next });
    };
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      pendingDelta += -e.deltaY * 0.0015;
      if (!rafId) rafId = requestAnimationFrame(flush);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Clipboard paste of images
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping()) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onload = () => {
              const targetPage = pages[currentPageIndex];
              if (!targetPage) return;
              const size = getLogicalSize(targetPage);
              const maxW = size.width * 0.6;
              let w = img.naturalWidth;
              let h = img.naturalHeight;
              if (w > maxW) {
                h = (h * maxW) / w;
                w = maxW;
              }
              const ann: Annotation = {
                id: uid(),
                type: "image",
                x: (size.width - w) / 2,
                y: (size.height - h) / 2,
                width: w,
                height: h,
                src: dataUrl,
              };
              addAnnotation(targetPage.id, ann);
              toast.success("Image pasted.");
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [pages, currentPageIndex, addAnnotation, getLogicalSize]);

  // Autosave reminder every 15 min if dirty
  useEffect(() => {
    const interval = setInterval(() => {
      if (useEditor.getState().dirty) {
        toast("Remember to save your PDF.", {
          action: { label: "Save", onClick: () => handleSave() },
        });
      }
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [handleSave]);

  // Warn on unload if dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Track current page on scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const containers = el.querySelectorAll<HTMLElement>("[data-page-index]");
      const mid = el.scrollTop + el.clientHeight / 3;
      for (const c of containers) {
        const top = c.offsetTop;
        const bottom = top + c.offsetHeight;
        if (mid >= top && mid <= bottom) {
          const idx = Number(c.dataset.pageIndex);
          if (!Number.isNaN(idx) && idx !== currentPageIndex) setCurrentPageIndex(idx);
          break;
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [currentPageIndex, setCurrentPageIndex]);

  const goToPage = useCallback((oneBased: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const total = pages.length;
    if (total === 0) return;
    const target = Math.max(1, Math.min(total, Math.floor(oneBased))) - 1;
    const node = el.querySelector<HTMLElement>(`[data-page-index="${target}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pages.length]);

  const pageList = useMemo(() => pages, [pages]);
  const sizesByPage = useMemo(() => {
    return pageList.map((p) => getLogicalSize(p));
  }, [pageList, getLogicalSize]);

  const rows = useMemo(() => {
    const out: { index: number; page: (typeof pages)[number] }[][] = [];
    for (let i = 0; i < pageList.length; i++) {
      const p = pageList[i];
      if (!p.sideOf || out.length === 0) {
        out.push([{ index: i, page: p }]);
      } else {
        out[out.length - 1].push({ index: i, page: p });
      }
    }
    return out;
  }, [pageList]);

  if (!pdfBytes) return null;

  return (
    <div className="flex h-screen flex-col bg-muted/40">
      <Toolbar onSave={handleSave} onGoToPage={goToPage} />

      <div className="flex flex-1 overflow-hidden">
        {/* Thumbnails */}
        <aside className="hidden w-32 shrink-0 overflow-y-auto border-r border-border bg-background/80 p-2 md:block editor-scroll">
          {pageList.map((p, i) => {
            const s = sizesByPage[i] ?? { width: 612, height: 792 };
            return (
              <button
                key={p.id}
                onClick={() => {
                  const el = scrollRef.current?.querySelector<HTMLElement>(
                    `[data-page-index="${i}"]`,
                  );
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={`relative mb-2 flex w-full items-center justify-center overflow-hidden rounded border bg-white text-xs text-muted-foreground transition ${
                  i === currentPageIndex ? "ring-2 ring-primary" : "border-border"
                }`}
                style={{ aspectRatio: `${s.width} / ${s.height}` }}
                title={`Page ${i + 1}`}
              >
                {i + 1}
              </button>
            );
          })}
        </aside>

        {/* Pages scroll area */}
        <div
          ref={scrollRef}
          className="editor-scroll relative flex-1 overflow-auto px-16 py-12"
        >
          <div className="mx-auto flex flex-col items-center gap-6">
            {rows.map((row) => (
              <div
                key={row[0].page.id}
                className="flex flex-row items-start justify-center gap-6"
              >
                {row.map(({ page, index: i }) => (
                  <PdfPage
                    key={page.id}
                    page={page}
                    index={i}
                    pdfDoc={pdfDoc}
                    logicalSize={sizesByPage[i]}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {dirty && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-full bg-foreground/80 px-3 py-1 text-xs text-background">
          Unsaved changes
        </div>
      )}
    </div>
  );
}
