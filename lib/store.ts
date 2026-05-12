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

const HISTORY_LIMIT = 100;

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
  highlightWidth: number;
  fontSize: number;
  filled: boolean;
  selectedIds: string[];
  selectedPageId: string | null;
  currentPageIndex: number;
  dirty: boolean;
  lastSavedAt: number;
  past: Page[][];
  future: Page[][];
};

type EditorActions = {
  loadPdf: (fileName: string, bytes: ArrayBuffer, pages: Page[]) => void;
  setTool: (t: Tool) => void;
  setZoom: (z: number) => void;
  setStrokeColor: (tool: StrokeTool, c: string) => void;
  setTextColor: (c: string) => void;
  setHighlightColor: (c: string) => void;
  setStrokeWidth: (n: number) => void;
  setHighlightWidth: (n: number) => void;
  setFontSize: (n: number) => void;
  setFilled: (f: boolean) => void;
  addAnnotation: (pageId: string, ann: Annotation) => void;
  updateAnnotation: (pageId: string, id: string, patch: Partial<Annotation>) => void;
  deleteAnnotation: (pageId: string, id: string) => void;
  deleteAnnotations: (pageId: string, ids: string[]) => void;
  setSelected: (pageId: string | null, id: string | null) => void;
  setSelectedIds: (pageId: string | null, ids: string[]) => void;
  toggleSelected: (pageId: string, id: string) => void;
  setCurrentPageIndex: (i: number) => void;
  insertBlankPageAfter: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
};

const pushPast = (past: Page[][], pages: Page[]) =>
  [...past, pages].slice(-HISTORY_LIMIT);

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
  highlightWidth: 16,
  fontSize: 16,
  filled: false,
  selectedIds: [],
  selectedPageId: null,
  currentPageIndex: 0,
  dirty: false,
  lastSavedAt: Date.now(),
  past: [],
  future: [],

  loadPdf: (fileName, bytes, pages) =>
    set({
      fileName,
      pdfBytes: bytes,
      pages,
      currentPageIndex: 0,
      dirty: false,
      lastSavedAt: Date.now(),
      past: [],
      future: [],
      selectedIds: [],
      selectedPageId: null,
    }),

  setTool: (t) => set({ tool: t, selectedIds: [] }),
  setZoom: (z) => set({ zoom: Math.max(0.4, Math.min(4, z)) }),
  setStrokeColor: (tool, c) =>
    set((s) => ({ strokeColors: { ...s.strokeColors, [tool]: c } })),
  setTextColor: (c) => set({ textColor: c }),
  setHighlightColor: (c) => set({ highlightColor: c }),
  setStrokeWidth: (n) => set({ strokeWidth: n }),
  setHighlightWidth: (n) => set({ highlightWidth: n }),
  setFontSize: (n) => set({ fontSize: n }),
  setFilled: (f) => set({ filled: f }),

  addAnnotation: (pageId, ann) =>
    set((s) => ({
      past: pushPast(s.past, s.pages),
      future: [],
      pages: s.pages.map((p) =>
        p.id === pageId ? { ...p, annotations: [...p.annotations, ann] } : p,
      ),
      dirty: true,
    })),

  updateAnnotation: (pageId, id, patch) =>
    set((s) => ({
      past: pushPast(s.past, s.pages),
      future: [],
      pages: s.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              annotations: p.annotations.map((a) =>
                a.id === id ? ({ ...a, ...patch } as any) : a,
              ),
            }
          : p,
      ),
      dirty: true,
    })),

  deleteAnnotation: (pageId, id) =>
    set((s) => ({
      past: pushPast(s.past, s.pages),
      future: [],
      pages: s.pages.map((p) =>
        p.id === pageId ? { ...p, annotations: p.annotations.filter((a) => a.id !== id) } : p,
      ),
      selectedIds: s.selectedIds.filter((x) => x !== id),
      dirty: true,
    })),

  deleteAnnotations: (pageId, ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const idSet = new Set(ids);
      return {
        past: pushPast(s.past, s.pages),
        future: [],
        pages: s.pages.map((p) =>
          p.id === pageId
            ? { ...p, annotations: p.annotations.filter((a) => !idSet.has(a.id)) }
            : p,
        ),
        selectedIds: s.selectedIds.filter((x) => !idSet.has(x)),
        dirty: true,
      };
    }),

  setSelected: (pageId, id) =>
    set({ selectedPageId: pageId, selectedIds: id ? [id] : [] }),
  setSelectedIds: (pageId, ids) =>
    set({ selectedPageId: pageId, selectedIds: ids }),
  toggleSelected: (pageId, id) =>
    set((s) => {
      if (s.selectedPageId && s.selectedPageId !== pageId) {
        return { selectedPageId: pageId, selectedIds: [id] };
      }
      const has = s.selectedIds.includes(id);
      const next = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
      return { selectedPageId: pageId, selectedIds: next };
    }),
  setCurrentPageIndex: (i) => set({ currentPageIndex: i }),

  insertBlankPageAfter: (pageId) =>
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === pageId);
      if (idx < 0) return s;
      const prev = s.pages[idx];
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
      return {
        past: pushPast(s.past, s.pages),
        future: [],
        pages,
        dirty: true,
      };
    }),

  deletePage: (pageId) =>
    set((s) => ({
      past: pushPast(s.past, s.pages),
      future: [],
      pages: s.pages.filter((p) => p.id !== pageId),
      dirty: true,
    })),

  markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [s.pages, ...s.future].slice(0, HISTORY_LIMIT),
        pages: prev,
        selectedIds: [],
        dirty: true,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return {
        past: pushPast(s.past, s.pages),
        future: s.future.slice(1),
        pages: next,
        selectedIds: [],
        dirty: true,
      };
    }),

  reset: () =>
    set({
      fileName: null,
      pdfBytes: null,
      pages: [],
      tool: "cursor",
      selectedIds: [],
      selectedPageId: null,
      currentPageIndex: 0,
      dirty: false,
      past: [],
      future: [],
    }),
}));
