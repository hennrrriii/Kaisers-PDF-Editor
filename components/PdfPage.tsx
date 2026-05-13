"use client";
import { useEffect, useRef, useState, memo, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Stage,
  Layer,
  Line,
  Rect,
  Circle,
  Arrow,
  Text as KText,
  Image as KImage,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import * as pdfjs from "pdfjs-dist";
import { useEditor } from "@/lib/store";
import type { Annotation, Page, TextAnnotation } from "@/lib/types";
import { uid } from "@/lib/utils";
import { straightenHighlight } from "@/lib/highlight";

type Props = {
  page: Page;
  index: number;
  pdfDoc: any;
  logicalSize: { width: number; height: number };
};

function getAnnotationBBox(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } {
  switch (ann.type) {
    case "rect":
    case "image":
      return {
        x: Math.min(ann.x, ann.x + ann.width),
        y: Math.min(ann.y, ann.y + ann.height),
        w: Math.abs(ann.width),
        h: Math.abs(ann.height),
      };
    case "circle":
      return {
        x: ann.x - ann.radius,
        y: ann.y - ann.radius,
        w: ann.radius * 2,
        h: ann.radius * 2,
      };
    case "text": {
      const lines = (ann.text || "").split("\n");
      const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
      const w = Math.min(ann.width ?? 240, Math.max(40, longest * ann.fontSize * 0.6));
      const h = ann.fontSize * lines.length * 1.2;
      return { x: ann.x, y: ann.y, w, h };
    }
    case "draw":
    case "highlight":
    case "line":
    case "arrow": {
      const p = ann.points;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i];
        const y = p[i + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const pad = (ann as any).strokeWidth ? (ann as any).strokeWidth / 2 : 0;
      return {
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
      };
    }
  }
}

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

type EditingState = {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  editingId?: string;
};

function URLImageNode({
  ann,
  draggable,
  onPatch,
  onSelect,
}: {
  ann: Extract<Annotation, { type: "image" }>;
  draggable: boolean;
  onPatch: (p: Partial<Annotation>) => void;
  onSelect: (e: any) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = ann.src;
  }, [ann.src]);
  if (!img) return null;
  return (
    <KImage
      name={ann.id}
      annId={ann.id as any}
      image={img}
      x={ann.x}
      y={ann.y}
      width={ann.width}
      height={ann.height}
      draggable={draggable}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(e);
      }}
      onDragEnd={(e) => onPatch({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onPatch({
          x: node.x(),
          y: node.y(),
          width: Math.max(10, node.width() * sx),
          height: Math.max(10, node.height() * sy),
        });
      }}
    />
  );
}

export const PdfPage = memo(function PdfPage({ page, index, pdfDoc, logicalSize }: Props) {
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const strokeColors = useEditor((s) => s.strokeColors);
  const textColor = useEditor((s) => s.textColor);
  const highlightColor = useEditor((s) => s.highlightColor);
  const strokeWidth = useEditor((s) => s.strokeWidth);
  const highlightWidth = useEditor((s) => s.highlightWidth);
  const fontSize = useEditor((s) => s.fontSize);
  const filled = useEditor((s) => s.filled);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedPageId = useEditor((s) => s.selectedPageId);
  const setSelected = useEditor((s) => s.setSelected);
  const setSelectedIds = useEditor((s) => s.setSelectedIds);
  const toggleSelected = useEditor((s) => s.toggleSelected);
  const addAnnotation = useEditor((s) => s.addAnnotation);
  const updateAnnotation = useEditor((s) => s.updateAnnotation);
  const deleteAnnotation = useEditor((s) => s.deleteAnnotation);
  const insertBlankPageBefore = useEditor((s) => s.insertBlankPageBefore);
  const insertBlankPageAfter = useEditor((s) => s.insertBlankPageAfter);
  const deletePage = useEditor((s) => s.deletePage);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const [visible, setVisible] = useState(false);
  const renderTaskRef = useRef<any>(null);
  const renderedZoomRef = useRef<number>(0);
  const textLayerBuiltRef = useRef<boolean>(false);

  // Debounced "stable" zoom: drives the expensive pdfjs raster.
  const [stableZoom, setStableZoom] = useState(zoom);
  useEffect(() => {
    const t = setTimeout(() => setStableZoom(zoom), 200);
    return () => clearTimeout(t);
  }, [zoom]);

  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [erasing, setErasing] = useState(false);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    additive: boolean;
    baseIds: string[];
  } | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const editingRef = useRef<EditingState | null>(null);
  editingRef.current = editing;

  // Intersection observer for lazy raster
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { root: null, rootMargin: "1200px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Render PDF page via an OFFSCREEN canvas, then blit. This avoids the
  // visible canvas ever appearing blank between resize and render finish.
  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!visible) return;
      if (page.ref.kind !== "pdf" || !pdfDoc) return;
      if (renderedZoomRef.current === stableZoom) return;
      const pdfPage = await pdfDoc.getPage(page.ref.pdfPageIndex + 1);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: stableZoom * dpr });
      const visibleCanvas = canvasRef.current;
      if (!visibleCanvas) return;

      const off = document.createElement("canvas");
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      const offCtx = off.getContext("2d", { alpha: false });
      if (!offCtx) return;

      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
      const task = pdfPage.render({ canvasContext: offCtx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
        if (cancelled) return;
        // Synchronous resize + blit in a single frame.
        visibleCanvas.width = off.width;
        visibleCanvas.height = off.height;
        const ctx = visibleCanvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        ctx.drawImage(off, 0, 0);
        renderedZoomRef.current = stableZoom;
      } catch {}
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [visible, stableZoom, pdfDoc, page.ref]);

  // Build text layer at scale=1 once; CSS scales it via transform.
  useEffect(() => {
    let cancelled = false;
    async function build() {
      if (!visible || page.ref.kind !== "pdf" || !pdfDoc) return;
      const container = textLayerRef.current;
      if (!container || textLayerBuiltRef.current) return;
      try {
        const pdfPage = await pdfDoc.getPage(page.ref.pdfPageIndex + 1);
        if (cancelled) return;
        const textContent = await pdfPage.getTextContent();
        if (cancelled) return;
        container.innerHTML = "";
        const viewport = pdfPage.getViewport({ scale: 1 });
        const tl = new (pdfjs as any).TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        });
        await tl.render();
        if (!cancelled) textLayerBuiltRef.current = true;
      } catch {
        // ignore
      }
    }
    build();
    return () => {
      cancelled = true;
    };
  }, [visible, pdfDoc, page.ref]);

  useEffect(() => {
    textLayerBuiltRef.current = false;
  }, [page.id]);

  const stageWidth = logicalSize.width * zoom;
  const stageHeight = logicalSize.height * zoom;

  // Hook the Transformer to the current selection on this page
  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    const eligible =
      tool === "cursor" &&
      selectedPageId === page.id &&
      selectedIds.length > 0 &&
      !editing;
    if (!eligible) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodes: Konva.Node[] = [];
    for (const id of selectedIds) {
      const node = layer.findOne(`.${id}`);
      if (node) nodes.push(node);
    }
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [tool, selectedIds, selectedPageId, page.id, page.annotations, editing]);

  // Text-selection → highlight rectangles when releasing the mouse with H tool
  const onContainerMouseUp = useCallback(() => {
    if (tool !== "highlight") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const container = containerRef.current;
    const tl = textLayerRef.current;
    if (!container || !tl) return;
    const range = sel.getRangeAt(0);
    if (!tl.contains(range.startContainer) && !tl.contains(range.endContainer)) return;
    const pageRect = container.getBoundingClientRect();
    const rects = Array.from(range.getClientRects());
    let added = 0;
    for (const r of rects) {
      if (r.width < 2 || r.height < 2) continue;
      const x = (r.left - pageRect.left) / zoom;
      const y = (r.top - pageRect.top) / zoom;
      const w = r.width / zoom;
      const h = r.height / zoom;
      addAnnotation(page.id, {
        id: uid(),
        type: "highlight",
        points: [x, y + h / 2, x + w, y + h / 2],
        stroke: highlightColor,
        strokeWidth: h,
      });
      added++;
    }
    if (added) sel.removeAllRanges();
  }, [tool, zoom, highlightColor, addAnnotation, page.id]);

  const getLogicalPos = (stage: Konva.Stage) => {
    const p = stage.getPointerPosition();
    if (!p) return null;
    return { x: p.x / zoom, y: p.y / zoom };
  };

  const commitEdit = useCallback(
    (override?: EditingState) => {
      const e = override ?? editingRef.current;
      if (!e) return;
      const text = e.text;
      if (text.trim() !== "") {
        addAnnotation(page.id, {
          id: uid(),
          type: "text",
          x: e.x,
          y: e.y,
          text,
          fill: e.fill,
          fontSize: e.fontSize,
          width: 240,
        });
      }
      setEditing(null);
    },
    [addAnnotation, page.id],
  );

  const beginTextEditExisting = useCallback(
    (ann: TextAnnotation) => {
      // commit any in-progress edit first
      if (editingRef.current) commitEdit();
      setEditing({
        x: ann.x,
        y: ann.y,
        text: ann.text,
        fontSize: ann.fontSize,
        fill: ann.fill,
        editingId: ann.id,
      });
      // hide the live KText while editing
      deleteAnnotation(page.id, ann.id);
    },
    [commitEdit, deleteAnnotation, page.id],
  );

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = getLogicalPos(stage);
    if (!pos) return;
    const isStage = e.target === stage;

    if (tool === "cursor") {
      if (isStage) {
        // Start marquee selection
        const additive = !!(e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
        setMarquee({
          x1: pos.x,
          y1: pos.y,
          x2: pos.x,
          y2: pos.y,
          additive,
          baseIds:
            additive && selectedPageId === page.id ? [...selectedIds] : [],
        });
        if (!additive) setSelected(null, null);
      }
      return;
    }
    if (tool === "eraser") {
      setErasing(true);
      if (!isStage) {
        const id = (e.target as any).attrs.annId || (e.target as any).attrs.name;
        if (id) deleteAnnotation(page.id, id);
      }
      return;
    }
    if (tool === "text") {
      // Clicking on an existing text annotation → edit it
      if (!isStage) {
        const id = (e.target as any).attrs.annId || (e.target as any).attrs.name;
        const existing = id
          ? (page.annotations.find((a) => a.id === id) as Annotation | undefined)
          : undefined;
        if (existing && existing.type === "text") {
          beginTextEditExisting(existing);
          return;
        }
        return;
      }
      // Empty area: commit any prior edit, then start a new one
      if (editingRef.current) commitEdit();
      setEditing({ x: pos.x, y: pos.y, text: "", fontSize, fill: textColor });
      return;
    }

    // commit any in-progress text edit when starting another tool action
    if (editingRef.current) commitEdit();

    const id = uid();
    if (tool === "draw") {
      setDrawing({
        id,
        type: "draw",
        points: [pos.x, pos.y],
        stroke: strokeColors.draw,
        strokeWidth,
      });
    } else if (tool === "highlight") {
      setDrawing({
        id,
        type: "highlight",
        points: [pos.x, pos.y],
        stroke: highlightColor,
        strokeWidth: highlightWidth,
      });
    } else if (tool === "rect") {
      setDrawing({
        id,
        type: "rect",
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        stroke: strokeColors.rect,
        strokeWidth,
        fill: filled ? strokeColors.rect + "33" : undefined,
      });
    } else if (tool === "circle") {
      setDrawing({
        id,
        type: "circle",
        x: pos.x,
        y: pos.y,
        radius: 0,
        stroke: strokeColors.circle,
        strokeWidth,
        fill: filled ? strokeColors.circle + "33" : undefined,
      });
    } else if (tool === "line") {
      setDrawing({
        id,
        type: "line",
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: strokeColors.line,
        strokeWidth,
      });
    } else if (tool === "arrow") {
      setDrawing({
        id,
        type: "arrow",
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: strokeColors.arrow,
        strokeWidth,
      });
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = getLogicalPos(stage);
    if (!pos) return;

    // Track cursor for the highlight "marker tip" preview rectangle.
    if (tool === "highlight") setHoverPos(pos);

    // Eraser: while held, delete anything we drag over.
    if (erasing) {
      const rawPos = stage.getPointerPosition();
      if (!rawPos) return;
      const node = stage.getIntersection(rawPos);
      if (node) {
        const id = (node as any).attrs.annId || (node as any).attrs.name;
        if (id) deleteAnnotation(page.id, id);
      }
      return;
    }

    if (marquee) {
      setMarquee((m) => (m ? { ...m, x2: pos.x, y2: pos.y } : m));
      return;
    }
    if (!drawing) return;
    const shift = !!e.evt.shiftKey;
    setDrawing((d) => {
      if (!d) return d;
      switch (d.type) {
        case "draw": {
          const pts = d.points.slice();
          const lx = pts[pts.length - 2];
          const ly = pts[pts.length - 1];
          if (Math.hypot(pos.x - lx, pos.y - ly) > 1.5) pts.push(pos.x, pos.y);
          return { ...d, points: pts };
        }
        case "highlight": {
          if (shift) {
            const sx = d.points[0];
            const sy = d.points[1];
            let ex = pos.x;
            let ey = pos.y;
            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
              const step = Math.PI / 4;
              const angle = Math.round(Math.atan2(dy, dx) / step) * step;
              ex = sx + Math.cos(angle) * len;
              ey = sy + Math.sin(angle) * len;
            }
            return { ...d, points: [sx, sy, ex, ey] };
          }
          const pts = d.points.slice();
          const lx = pts[pts.length - 2];
          const ly = pts[pts.length - 1];
          if (Math.hypot(pos.x - lx, pos.y - ly) > 1.5) pts.push(pos.x, pos.y);
          return { ...d, points: pts };
        }
        case "rect":
          return { ...d, width: pos.x - d.x, height: pos.y - d.y };
        case "circle":
          return { ...d, radius: Math.hypot(pos.x - d.x, pos.y - d.y) };
        case "line":
        case "arrow": {
          let ex = pos.x;
          let ey = pos.y;
          if (shift) {
            const sx = d.points[0];
            const sy = d.points[1];
            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
              // Snap to the nearest 45° from start
              const step = Math.PI / 4;
              const angle = Math.round(Math.atan2(dy, dx) / step) * step;
              ex = sx + Math.cos(angle) * len;
              ey = sy + Math.sin(angle) * len;
            }
          }
          return { ...d, points: [d.points[0], d.points[1], ex, ey] };
        }
      }
      return d;
    });
  };

  const handleMouseUp = () => {
    if (erasing) {
      setErasing(false);
      return;
    }
    if (marquee) {
      const m = marquee;
      const rect = {
        x: Math.min(m.x1, m.x2),
        y: Math.min(m.y1, m.y2),
        w: Math.abs(m.x2 - m.x1),
        h: Math.abs(m.y2 - m.y1),
      };
      setMarquee(null);
      // Tiny click → don't change selection beyond what mousedown did
      if (rect.w < 3 && rect.h < 3) return;
      const hit: string[] = [];
      for (const a of page.annotations) {
        const bb = getAnnotationBBox(a);
        if (rectsIntersect(rect, bb)) hit.push(a.id);
      }
      const base = m.additive ? m.baseIds : [];
      const merged = Array.from(new Set([...base, ...hit]));
      setSelectedIds(merged.length > 0 ? page.id : null, merged);
      return;
    }
    if (!drawing) return;
    let ann: Annotation = drawing;
    if (ann.type === "rect") {
      let { x, y, width, height } = ann;
      if (width < 0) {
        x += width;
        width = -width;
      }
      if (height < 0) {
        y += height;
        height = -height;
      }
      if (width < 3 || height < 3) {
        setDrawing(null);
        return;
      }
      ann = { ...ann, x, y, width, height };
    } else if (ann.type === "circle" && ann.radius < 3) {
      setDrawing(null);
      return;
    } else if (ann.type === "highlight") {
      ann = { ...ann, points: straightenHighlight(ann.points) };
    } else if (
      (ann.type === "line" || ann.type === "arrow") &&
      Math.hypot(ann.points[2] - ann.points[0], ann.points[3] - ann.points[1]) < 3
    ) {
      setDrawing(null);
      return;
    }
    addAnnotation(page.id, ann);
    setDrawing(null);
  };

  // Auto-focus textarea on open
  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      requestAnimationFrame(() => {
        ta.focus();
        ta.select();
      });
    }
  }, [editing?.editingId, editing === null ? "none" : `${editing.x}-${editing.y}`]);

  // ---------- transform-end handlers (V tool resize) ----------
  const bakeTransformAndUpdate = useCallback(
    (annId: string, ann: Annotation, node: Konva.Node) => {
      const sx = node.scaleX();
      const sy = node.scaleY();
      const x = node.x();
      const y = node.y();
      node.scaleX(1);
      node.scaleY(1);
      switch (ann.type) {
        case "rect":
          updateAnnotation(page.id, annId, {
            x,
            y,
            width: Math.max(4, (node as Konva.Rect).width() * sx),
            height: Math.max(4, (node as Konva.Rect).height() * sy),
          } as any);
          break;
        case "circle":
          updateAnnotation(page.id, annId, {
            x,
            y,
            radius: Math.max(4, (node as Konva.Circle).radius() * Math.max(sx, sy)),
          } as any);
          break;
        case "text":
          updateAnnotation(page.id, annId, {
            x,
            y,
            fontSize: Math.max(6, (node as Konva.Text).fontSize() * sy),
          } as any);
          break;
        case "line":
        case "arrow":
        case "draw":
        case "highlight": {
          const pts = (node as Konva.Line).points();
          const next: number[] = [];
          for (let i = 0; i < pts.length; i += 2) {
            next.push(x + pts[i] * sx, y + pts[i + 1] * sy);
          }
          node.x(0);
          node.y(0);
          updateAnnotation(page.id, annId, { points: next } as any);
          break;
        }
      }
    },
    [page.id, updateAnnotation],
  );

  const renderAnnotation = (ann: Annotation) => {
    const isSelected =
      selectedPageId === page.id && selectedIds.includes(ann.id);
    const draggable = tool === "cursor";
    const handleDragEnd = (e: any) => {
      if (
        ann.type === "rect" ||
        ann.type === "text" ||
        ann.type === "circle" ||
        ann.type === "image"
      ) {
        updateAnnotation(page.id, ann.id, { x: e.target.x(), y: e.target.y() } as any);
      } else if ("points" in ann) {
        const dx = e.target.x();
        const dy = e.target.y();
        const pts = (ann.points as number[]).map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        e.target.position({ x: 0, y: 0 });
        updateAnnotation(page.id, ann.id, { points: pts } as any);
      }
    };
    const onTransformEnd = (e: any) => bakeTransformAndUpdate(ann.id, ann, e.target);
    const common = {
      name: ann.id,
      annId: ann.id as any,
      onMouseDown: (e: any) => {
        if (tool === "cursor") {
          e.cancelBubble = true;
          const evt = e.evt as MouseEvent;
          if (evt && (evt.shiftKey || evt.ctrlKey || evt.metaKey)) {
            toggleSelected(page.id, ann.id);
          } else if (!(selectedPageId === page.id && selectedIds.includes(ann.id))) {
            setSelected(page.id, ann.id);
          }
        }
      },
      draggable,
      onDragEnd: handleDragEnd,
      onTransformEnd,
    };
    const hitWide = (sw: number) => Math.max(20, sw + 8);
    switch (ann.type) {
      case "draw":
        return (
          <Line
            key={ann.id}
            {...(common as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={hitWide(ann.strokeWidth)}
            tension={0.4}
            lineCap="round"
            lineJoin="round"
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "highlight":
        return (
          <Line
            key={ann.id}
            {...(common as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={Math.max(ann.strokeWidth, 16)}
            lineCap="butt"
            lineJoin="round"
            opacity={0.4}
          />
        );
      case "rect":
        return (
          <Rect
            key={ann.id}
            {...(common as any)}
            x={ann.x}
            y={ann.y}
            width={ann.width}
            height={ann.height}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            fill={ann.fill}
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "circle":
        return (
          <Circle
            key={ann.id}
            {...(common as any)}
            x={ann.x}
            y={ann.y}
            radius={ann.radius}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            fill={ann.fill}
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "line":
        return (
          <Line
            key={ann.id}
            {...(common as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={hitWide(ann.strokeWidth)}
            lineCap="round"
          />
        );
      case "arrow":
        return (
          <Arrow
            key={ann.id}
            {...(common as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={hitWide(ann.strokeWidth)}
            fill={ann.stroke}
            pointerLength={10 + ann.strokeWidth * 2}
            pointerWidth={8 + ann.strokeWidth * 2}
          />
        );
      case "text":
        return (
          <KText
            key={ann.id}
            {...(common as any)}
            x={ann.x}
            y={ann.y}
            text={ann.text}
            fill={ann.fill}
            fontSize={ann.fontSize}
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "image":
        return (
          <URLImageNode
            key={ann.id}
            ann={ann}
            draggable={draggable}
            onPatch={(p) => updateAnnotation(page.id, ann.id, p)}
            onSelect={(e) => {
              if (tool !== "cursor") return;
              const evt = e?.evt as MouseEvent | undefined;
              if (evt && (evt.shiftKey || evt.ctrlKey || evt.metaKey)) {
                toggleSelected(page.id, ann.id);
              } else if (!(selectedPageId === page.id && selectedIds.includes(ann.id))) {
                setSelected(page.id, ann.id);
              }
            }}
          />
        );
    }
    return null;
  };

  const textLayerInteractive = tool === "cursor" || tool === "highlight";

  return (
    <div
      ref={containerRef}
      data-page-index={index}
      className="page-container relative mx-auto bg-white shadow-md"
      onMouseUp={onContainerMouseUp}
      style={{ width: stageWidth, height: stageHeight }}
    >
      {page.ref.kind === "pdf" ? (
        <canvas
          ref={canvasRef}
          className="pdf-page-canvas absolute inset-0"
          style={{ width: stageWidth, height: stageHeight }}
        />
      ) : (
        <div className="absolute inset-0 bg-white" />
      )}

      <Stage
        width={stageWidth}
        height={stageHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp();
          setHoverPos(null);
        }}
        className="absolute inset-0"
        style={{
          cursor:
            tool === "cursor"
              ? "default"
              : tool === "text"
                ? "text"
                : tool === "highlight"
                  ? "none"
                  : "crosshair",
        }}
      >
        <Layer ref={layerRef} scaleX={zoom} scaleY={zoom} listening>
          {page.annotations.map(renderAnnotation)}
          {tool === "text" &&
            page.annotations
              .filter((a): a is Extract<Annotation, { type: "text" }> => a.type === "text")
              .map((a) => {
                const bb = getAnnotationBBox(a);
                const pad = 4;
                return (
                  <Rect
                    key={`textdrag-${a.id}`}
                    x={bb.x - pad}
                    y={bb.y - pad}
                    width={bb.w + pad * 2}
                    height={bb.h + pad * 2}
                    stroke="#1d4ed8"
                    strokeWidth={1}
                    dash={[4, 4]}
                    fillEnabled={false}
                    listening
                    hitStrokeWidth={12}
                    draggable
                    onDragEnd={(e) => {
                      const dx = e.target.x() - (bb.x - pad);
                      const dy = e.target.y() - (bb.y - pad);
                      updateAnnotation(page.id, a.id, {
                        x: a.x + dx,
                        y: a.y + dy,
                      } as any);
                      e.target.position({ x: bb.x - pad, y: bb.y - pad });
                    }}
                  />
                );
              })}
          {drawing && renderAnnotation(drawing)}
          {marquee && (
            <Rect
              listening={false}
              x={Math.min(marquee.x1, marquee.x2)}
              y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)}
              height={Math.abs(marquee.y2 - marquee.y1)}
              fill="#1d4ed822"
              stroke="#1d4ed8"
              strokeWidth={1 / zoom}
              dash={[6 / zoom, 4 / zoom]}
            />
          )}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            flipEnabled={false}
            borderStroke="#1d4ed8"
            anchorFill="#ffffff"
            anchorStroke="#1d4ed8"
            anchorSize={8}
            ignoreStroke
          />
        </Layer>
      </Stage>

      <div
        ref={textLayerRef}
        className={`text-layer absolute left-0 top-0 ${
          textLayerInteractive ? "text-layer-active" : "text-layer-disabled"
        }`}
        style={{
          width: logicalSize.width,
          height: logicalSize.height,
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      />

      <div className="pointer-events-none absolute -left-12 top-2 select-none text-xs text-muted-foreground">
        {index + 1}
      </div>

      {tool === "highlight" && hoverPos && !drawing && (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            left: hoverPos.x * zoom,
            top: hoverPos.y * zoom,
            width: highlightWidth * zoom * 3,
            height: highlightWidth * zoom,
            transform: "translate(-50%, -50%)",
            background: highlightColor,
            opacity: 0.4,
            borderRadius: 1,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
          }}
        />
      )}

      {index === 0 && (
        <button
          type="button"
          onClick={() =>
            insertBlankPageBefore(page.id, {
              w: logicalSize.width,
              h: logicalSize.height,
            })
          }
          title="Insert blank page above"
          className="page-insert-btn absolute left-1/2 z-30 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border-2 border-black bg-white text-black shadow-md transition hover:bg-neutral-100"
          style={{ top: -44 }}
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      )}
      <button
        type="button"
        onClick={() =>
          insertBlankPageAfter(page.id, {
            w: logicalSize.width,
            h: logicalSize.height,
          })
        }
        title="Insert blank page below"
        className="page-insert-btn absolute left-1/2 z-30 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border-2 border-black bg-white text-black shadow-md transition hover:bg-neutral-100"
        style={{ bottom: -44 }}
      >
        <Plus className="h-5 w-5" strokeWidth={2.5} />
      </button>
      {page.ref.kind === "blank" && (
        <button
          type="button"
          onClick={() => deletePage(page.id)}
          title="Delete this blank page"
          className="page-insert-btn absolute z-30 flex h-8 w-8 items-center justify-center rounded-full border-2 border-red-600 bg-white text-red-600 shadow-md transition hover:bg-red-50"
          style={{ top: -16, right: -16 }}
        >
          <Trash2 className="h-4 w-4" strokeWidth={2.2} />
        </button>
      )}

      {editing && (
        <textarea
          ref={textareaRef}
          value={editing.text}
          onChange={(e) => {
            const next = e.target.value;
            setEditing({ ...editing, text: next });
            const ta = e.target;
            ta.style.height = "auto";
            ta.style.height = `${ta.scrollHeight}px`;
            const lines = next.split("\n");
            const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
            const charW = editing.fontSize * zoom * 0.6;
            ta.style.width = `${Math.max(120, longest * charW + 16)}px`;
          }}
          onMouseDown={(e) => {
            const ta = e.currentTarget;
            const rect = ta.getBoundingClientRect();
            const dx = e.clientX - rect.left;
            const dy = e.clientY - rect.top;
            const edge = 5;
            const nearEdge =
              dx < edge ||
              dx > rect.width - edge ||
              dy < edge ||
              dy > rect.height - edge;
            if (!nearEdge) return;
            // Drag the textarea via its dashed border. preventDefault keeps
            // focus where it is — calling blur() would fire onBlur and
            // commit/close the edit before the drag begins.
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const origX = editing.x;
            const origY = editing.y;
            const onMove = (ev: MouseEvent) => {
              setEditing((cur) =>
                cur
                  ? {
                      ...cur,
                      x: origX + (ev.clientX - startX) / zoom,
                      y: origY + (ev.clientY - startY) / zoom,
                    }
                  : cur,
              );
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          onBlur={() => commitEdit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              commitEdit();
            }
          }}
          className="text-annotation-input absolute z-30"
          style={{
            left: editing.x * zoom,
            top: editing.y * zoom,
            color: editing.fill,
            fontSize: `${editing.fontSize * zoom}px`,
            minWidth: 120,
            minHeight: editing.fontSize * zoom + 8,
            whiteSpace: "pre",
            overflow: "hidden",
          }}
        />
      )}
    </div>
  );
});
