"use client";
import { useEffect, useRef, useState, memo, useCallback } from "react";
import { Stage, Layer, Line, Rect, Circle, Arrow, Text as KText, Image as KImage, Transformer } from "react-konva";
import type Konva from "konva";
import * as pdfjs from "pdfjs-dist";
import { useEditor } from "@/lib/store";
import type { Annotation, Page } from "@/lib/types";
import { uid } from "@/lib/utils";
import { straightenHighlight } from "@/lib/highlight";

type Props = {
  page: Page;
  index: number;
  pdfDoc: any;
  logicalSize: { width: number; height: number };
};

function URLImage({ ann, onChange, isSelected, onSelect, draggable }: any) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = ann.src;
  }, [ann.src]);
  const shapeRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, img]);
  if (!img) return null;
  return (
    <>
      <KImage
        ref={shapeRef}
        image={img}
        x={ann.x}
        y={ann.y}
        width={ann.width}
        height={ann.height}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
        onTransformEnd={() => {
          const node = shapeRef.current;
          const sx = node.scaleX();
          const sy = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            x: node.x(),
            y: node.y(),
            width: Math.max(10, node.width() * sx),
            height: Math.max(10, node.height() * sy),
          });
        }}
      />
      {isSelected && <Transformer ref={trRef} rotateEnabled={false} />}
    </>
  );
}

export const PdfPage = memo(function PdfPage({ page, index, pdfDoc, logicalSize }: Props) {
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const strokeColors = useEditor((s) => s.strokeColors);
  const textColor = useEditor((s) => s.textColor);
  const highlightColor = useEditor((s) => s.highlightColor);
  const strokeWidth = useEditor((s) => s.strokeWidth);
  const fontSize = useEditor((s) => s.fontSize);
  const filled = useEditor((s) => s.filled);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedPageId = useEditor((s) => s.selectedPageId);
  const setSelected = useEditor((s) => s.setSelected);
  const addAnnotation = useEditor((s) => s.addAnnotation);
  const updateAnnotation = useEditor((s) => s.updateAnnotation);
  const deleteAnnotation = useEditor((s) => s.deleteAnnotation);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [visible, setVisible] = useState(false);
  const renderTaskRef = useRef<any>(null);
  const renderedZoomRef = useRef<number>(0);
  const textLayerBuiltRef = useRef<boolean>(false);

  // Debounced "stable" zoom that drives expensive rasterization.
  const [stableZoom, setStableZoom] = useState(zoom);
  useEffect(() => {
    const t = setTimeout(() => setStableZoom(zoom), 150);
    return () => clearTimeout(t);
  }, [zoom]);

  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [editing, setEditing] = useState<{ x: number; y: number; text: string } | null>(null);

  // Intersection observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Render PDF canvas at stableZoom only
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
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d", { alpha: false })!;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
      const task = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
        if (!cancelled) renderedZoomRef.current = stableZoom;
      } catch {}
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [visible, stableZoom, pdfDoc, page.ref]);

  // Free GPU memory when page scrolls off
  useEffect(() => {
    if (!visible && page.ref.kind === "pdf") {
      const c = canvasRef.current;
      if (c && c.width !== 0) {
        c.width = 0;
        c.height = 0;
        renderedZoomRef.current = 0;
      }
    }
  }, [visible, page.ref]);

  // Build text layer once per visibility cycle, at scale=1.
  // CSS scales it via transform for cheap zoom updates.
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
      } catch (e) {
        // ignore — text layer is best-effort
      }
    }
    build();
    return () => {
      cancelled = true;
    };
  }, [visible, pdfDoc, page.ref]);

  // Reset text layer cache when page identity changes
  useEffect(() => {
    textLayerBuiltRef.current = false;
  }, [page.id]);

  const stageWidth = logicalSize.width * zoom;
  const stageHeight = logicalSize.height * zoom;

  // Text selection → highlight conversion
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
    const created: string[] = [];
    for (const r of rects) {
      if (r.width < 2 || r.height < 2) continue;
      const x = (r.left - pageRect.left) / zoom;
      const y = (r.top - pageRect.top) / zoom;
      const w = r.width / zoom;
      const h = r.height / zoom;
      const id = uid();
      addAnnotation(page.id, {
        id,
        type: "highlight",
        points: [x, y + h / 2, x + w, y + h / 2],
        stroke: highlightColor,
        strokeWidth: h,
      });
      created.push(id);
    }
    if (created.length) sel.removeAllRanges();
  }, [tool, zoom, highlightColor, addAnnotation, page.id]);

  const getLogicalPos = (stage: Konva.Stage) => {
    const p = stage.getPointerPosition();
    if (!p) return null;
    return { x: p.x / zoom, y: p.y / zoom };
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = getLogicalPos(stage);
    if (!pos) return;
    const isStage = e.target === stage;

    if (tool === "cursor") {
      if (isStage) setSelected(null, null);
      return;
    }
    if (tool === "eraser") {
      if (!isStage) {
        const id = (e.target as any).attrs.annId;
        if (id) deleteAnnotation(page.id, id);
      }
      return;
    }
    if (tool === "text") {
      if (!isStage) return;
      setEditing({ x: pos.x, y: pos.y, text: "" });
      return;
    }
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
        strokeWidth: Math.max(10, strokeWidth * 5),
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
    if (!drawing) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = getLogicalPos(stage);
    if (!pos) return;
    setDrawing((d) => {
      if (!d) return d;
      switch (d.type) {
        case "draw":
        case "highlight": {
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
        case "arrow":
          return { ...d, points: [d.points[0], d.points[1], pos.x, pos.y] };
      }
      return d;
    });
  };

  const handleMouseUp = () => {
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

  // Text editing focus
  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      requestAnimationFrame(() => ta.focus());
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const text = editing.text;
    if (text.trim() !== "") {
      addAnnotation(page.id, {
        id: uid(),
        type: "text",
        x: editing.x,
        y: editing.y,
        text,
        fill: textColor,
        fontSize,
        width: 240,
      });
    }
    setEditing(null);
  }, [editing, page.id, addAnnotation, textColor, fontSize]);

  const renderAnnotation = (ann: Annotation) => {
    const isSelected = selectedId === ann.id && selectedPageId === page.id;
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
    const selectProps = {
      annId: ann.id,
      onMouseDown: (e: any) => {
        if (tool === "cursor") {
          e.cancelBubble = true;
          setSelected(page.id, ann.id);
        }
      },
    };
    const hitWide = (sw: number) => Math.max(20, sw + 8);
    switch (ann.type) {
      case "draw":
        return (
          <Line
            key={ann.id}
            {...(selectProps as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={hitWide(ann.strokeWidth)}
            tension={0.4}
            lineCap="round"
            lineJoin="round"
            draggable={draggable}
            onDragEnd={handleDragEnd}
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "highlight":
        return (
          <Line
            key={ann.id}
            {...(selectProps as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={Math.max(ann.strokeWidth, 16)}
            lineCap="butt"
            lineJoin="round"
            opacity={0.4}
            draggable={draggable}
            onDragEnd={handleDragEnd}
          />
        );
      case "rect":
        return (
          <Rect
            key={ann.id}
            {...(selectProps as any)}
            x={ann.x}
            y={ann.y}
            width={ann.width}
            height={ann.height}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            fill={ann.fill}
            draggable={draggable}
            onDragEnd={handleDragEnd}
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "circle":
        return (
          <Circle
            key={ann.id}
            {...(selectProps as any)}
            x={ann.x}
            y={ann.y}
            radius={ann.radius}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            fill={ann.fill}
            draggable={draggable}
            onDragEnd={handleDragEnd}
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "line":
        return (
          <Line
            key={ann.id}
            {...(selectProps as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={hitWide(ann.strokeWidth)}
            lineCap="round"
            draggable={draggable}
            onDragEnd={handleDragEnd}
          />
        );
      case "arrow":
        return (
          <Arrow
            key={ann.id}
            {...(selectProps as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
            hitStrokeWidth={hitWide(ann.strokeWidth)}
            fill={ann.stroke}
            pointerLength={10 + ann.strokeWidth * 2}
            pointerWidth={8 + ann.strokeWidth * 2}
            draggable={draggable}
            onDragEnd={handleDragEnd}
          />
        );
      case "text":
        return (
          <KText
            key={ann.id}
            {...(selectProps as any)}
            x={ann.x}
            y={ann.y}
            text={ann.text}
            fill={ann.fill}
            fontSize={ann.fontSize}
            draggable={draggable}
            onDragEnd={handleDragEnd}
            onDblClick={() => {
              if (tool === "cursor") {
                setEditing({ x: ann.x, y: ann.y, text: ann.text });
                deleteAnnotation(page.id, ann.id);
              }
            }}
            shadowEnabled={isSelected}
            shadowColor="#1d4ed8"
            shadowBlur={4}
          />
        );
      case "image":
        return (
          <URLImage
            key={ann.id}
            ann={ann}
            isSelected={isSelected}
            draggable={draggable}
            onSelect={() => tool === "cursor" && setSelected(page.id, ann.id)}
            onChange={(patch: any) => updateAnnotation(page.id, ann.id, patch)}
          />
        );
    }
    return null;
  };

  // Pointer event policy for the text layer
  // - highlight tool: text spans selectable (so user gets browser selection)
  // - cursor tool: text spans selectable too
  // - drawing/eraser tools: text layer transparent to events
  const textLayerInteractive = tool === "cursor" || tool === "highlight";

  return (
    <div
      ref={containerRef}
      data-page-index={index}
      className="relative mx-auto bg-white shadow-md"
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
        onMouseLeave={handleMouseUp}
        className="absolute inset-0"
        style={{
          cursor:
            tool === "cursor"
              ? "default"
              : tool === "text"
                ? "text"
                : tool === "eraser"
                  ? "crosshair"
                  : "crosshair",
          // For cursor/highlight the text layer needs to receive events from text spans.
          // Stage stays on top to handle annotation movement on whitespace.
          pointerEvents: tool === "cursor" ? "auto" : "auto",
        }}
      >
        <Layer scaleX={zoom} scaleY={zoom} listening>
          {page.annotations.map(renderAnnotation)}
          {drawing && renderAnnotation(drawing)}
        </Layer>
      </Stage>

      {/* PDF.js text layer on top of Stage so text spans can capture clicks.
          Container is pointer-events: none so whitespace falls through to Stage. */}
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

      {editing && (
        <textarea
          ref={textareaRef}
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={commitEdit}
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
            color: textColor,
            fontSize: `${fontSize * zoom}px`,
            minWidth: 100,
            minHeight: fontSize * zoom + 8,
          }}
        />
      )}
    </div>
  );
});
