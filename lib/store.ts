"use client";
import { create } from "zustand";
import type { Annotation, Page, Tool } from "./types";
import { uid } from "./utils";

export const TEXT_COLORS = [
  { name: "Blue", value: "#1d4ed8" },
  { name: "Black", value: "#111111" },
  { name: "Red", value: "#dc2626" },
  { name: "Green", value: "#16a34a" },
  { name: "Orange", value: "#ea580c" },
  { name: "Purple", value: "#7c3aed" },
];

export const STROKE_COLORS = [
  { name: "Black", value: "#111111" },
  { name: "Red", value: "#dc2626" },
  { name: "Blue", value: "#1d4ed8" },
  { name: "Green", value: "#16a34a" },
  { name: "Orange", value: "#ea580c" },
  { name: "Purple", value: "#7c3aed" },
];

export const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#fde047" },
  { name: "Green", value: "#86efac" },
  { name: "Pink", value: "#f9a8d4" },
  { name: "Blue", value: "#93c5fd" },
  { name: "Orange", value: "#fdba74" },
];

export type StrokeTool = "draw" | "rect" | "circle" | "line" | "arrow";

type EditorState = {
  fileName: string | null;
  pdfBytes: ArrayBuffer | null;
  pages: Page[];
  tool: Tool;
  zoom: number;
  strokeColors: Record<StrokeTool, string>;
  textColor: string;
  highlightColor: string;
  strokeWidth: number;
  fontSize: number;
  filled: boolean;
  selectedId: string | null;
  selectedPageId: string | null;
  currentPageIndex: number;
  dirty: boolean;
  lastSavedAt: number;
};

type EditorActions = {
  loadPdf: (fileName: string, bytes: ArrayBuffer, pages: Page[]) => void;
  setTool: (t: Tool) => void;
  setZoom: (z: number) => void;
  setStrokeColor: (tool: StrokeTool, c: string) => void;
  setTextColor: (c: string) => void;
  setHighlightColor: (c: string) => void;
  setStrokeWidth: (n: number) => void;
  setFontSize: (n: number) => void;
  setFilled: (f: boolean) => void;
  addAnnotation: (pageId: string, ann: Annotation) => void;
  updateAnnotation: (pageId: string, id: string, patch: Partial<Annotation>) => void;
  deleteAnnotation: (pageId: string, id: string) => void;
  setSelected: (pageId: string | null, id: string | null) => void;
  setCurrentPageIndex: (i: number) => void;
  insertBlankPageAfter: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  markSaved: () => void;
  reset: () => void;
};

export const useEditor = create<EditorState & EditorActions>((set, get) => ({
  fileName: null,
  pdfBytes: null,
  pages: [],
  tool: "cursor",
  zoom: 1.2,
  strokeColors: {
    draw: "#111111",
    rect: "#dc2626",
    circle: "#111111",
    line: "#111111",
    arrow: "#111111",
  },
  textColor: "#1d4ed8",
  highlightColor: "#fde047",
  strokeWidth: 2,
  fontSize: 16,
  filled: false,
  selectedId: null,
  selectedPageId: null,
  currentPageIndex: 0,
  dirty: false,
  lastSavedAt: Date.now(),

  loadPdf: (fileName, bytes, pages) =>
    set({ fileName, pdfBytes: bytes, pages, currentPageIndex: 0, dirty: false, lastSavedAt: Date.now() }),

  setTool: (t) => set({ tool: t, selectedId: null }),
  setZoom: (z) => set({ zoom: Math.max(0.4, Math.min(4, z)) }),
  setStrokeColor: (tool, c) =>
    set((s) => ({ strokeColors: { ...s.strokeColors, [tool]: c } })),
  setTextColor: (c) => set({ textColor: c }),
  setHighlightColor: (c) => set({ highlightColor: c }),
  setStrokeWidth: (n) => set({ strokeWidth: n }),
  setFontSize: (n) => set({ fontSize: n }),
  setFilled: (f) => set({ filled: f }),

  addAnnotation: (pageId, ann) =>
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, annotations: [...p.annotations, ann] } : p)),
      dirty: true,
    })),

  updateAnnotation: (pageId, id, patch) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              annotations: p.annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as any) : a)),
            }
          : p,
      ),
      dirty: true,
    })),

  deleteAnnotation: (pageId, id) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === pageId ? { ...p, annotations: p.annotations.filter((a) => a.id !== id) } : p,
      ),
      selectedId: s.selectedId === id ? null : s.selectedId,
      dirty: true,
    })),

  setSelected: (pageId, id) => set({ selectedPageId: pageId, selectedId: id }),
  setCurrentPageIndex: (i) => set({ currentPageIndex: i }),

  insertBlankPageAfter: (pageId) =>
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === pageId);
      if (idx < 0) return s;
      const prev = s.pages[idx];
      // Use prev page dimensions if available, else default A4-ish at 72dpi*zoom logical
      let w = 612,
        h = 792;
      if (prev.ref.kind === "blank") {
        w = prev.ref.width;
        h = prev.ref.height;
      }
      const newPage: Page = {
        id: uid(),
        ref: { kind: "blank", width: w, height: h },
        annotations: [],
      };
      const pages = [...s.pages.slice(0, idx + 1), newPage, ...s.pages.slice(idx + 1)];
      return { pages, dirty: true };
    }),

  deletePage: (pageId) =>
    set((s) => ({ pages: s.pages.filter((p) => p.id !== pageId), dirty: true })),

  markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),
  reset: () =>
    set({
      fileName: null,
      pdfBytes: null,
      pages: [],
      tool: "cursor",
      selectedId: null,
      selectedPageId: null,
      currentPageIndex: 0,
      dirty: false,
    }),
}));
