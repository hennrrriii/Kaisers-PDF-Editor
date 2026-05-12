"use client";
import { useEffect, useRef, useState, memo, useCallback } from "react";
import { Stage, Layer, Line, Rect, Circle, Arrow, Text as KText, Image as KImage, Transformer } from "react-konva";
import type Konva from "konva";
import { useEditor } from "@/lib/store";
import type { Annotation, Page } from "@/lib/types";
import { uid } from "@/lib/utils";
import { straightenHighlight } from "@/lib/highlight";

type Props = {
  page: Page;
  index: number;
  pdfDoc: any; // pdfjs document
  logicalSize: { width: number; height: number };
  onVisible?: (visible: boolean) => void;
  onActivate?: () => void;
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

export const PdfPage = memo(function PdfPage({
  page,
  index,
  pdfDoc,
  logicalSize,
  onActivate,
}: Props) {
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const strokeColor = useEditor((s) => s.strokeColor);
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
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const renderTaskRef = useRef<any>(null);
  const lastZoomRef = useRef<number>(0);

  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [editing, setEditing] = useState<{ id: string; x: number; y: number; text: string } | null>(
    null,
  );

  // Intersection observer for lazy rendering
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          setVisible(e.isIntersecting);
          if (e.isIntersecting) onActivate?.();
        }
      },
      { root: null, rootMargin: "400px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onActivate]);

  // Render PDF page to canvas when visible
  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!visible) return;
      if (page.ref.kind !== "pdf" || !pdfDoc) return;
      if (rendered && lastZoomRef.current === zoom) return;
      const pdfPage = await pdfDoc.getPage(page.ref.pdfPageIndex + 1);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: zoom * dpr });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${logicalSize.width * zoom}px`;
      canvas.style.height = `${logicalSize.height * zoom}px`;
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
        if (!cancelled) {
          setRendered(true);
          lastZoomRef.current = zoom;
        }
      } catch {}
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [visible, zoom, pdfDoc, page.ref, logicalSize.width, logicalSize.height, rendered]);

  // Unload off-screen renders to save memory
  useEffect(() => {
    if (!visible && rendered && page.ref.kind === "pdf") {
      const c = canvasRef.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      setRendered(false);
      lastZoomRef.current = 0;
    }
  }, [visible, rendered, page.ref]);

  const stageWidth = logicalSize.width * zoom;
  const stageHeight = logicalSize.height * zoom;

  // Mouse handlers in logical coords
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
      // delete clicked
      if (!isStage) {
        const id = (e.target as any).attrs.annId;
        if (id) deleteAnnotation(page.id, id);
      }
      return;
    }
    if (tool === "text") {
      if (!isStage) return;
      const id = uid();
      const ann: Annotation = {
        id,
        type: "text",
        x: pos.x,
        y: pos.y,
        text: "",
        fill: textColor,
        fontSize,
        width: 200,
      };
      addAnnotation(page.id, ann);
      setEditing({ id, x: pos.x, y: pos.y, text: "" });
      return;
    }
    const id = uid();
    if (tool === "draw") {
      setDrawing({ id, type: "draw", points: [pos.x, pos.y], stroke: strokeColor, strokeWidth });
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
        stroke: strokeColor,
        strokeWidth,
        fill: filled ? strokeColor + "33" : undefined,
      });
    } else if (tool === "circle") {
      setDrawing({
        id,
        type: "circle",
        x: pos.x,
        y: pos.y,
        radius: 0,
        stroke: strokeColor,
        strokeWidth,
        fill: filled ? strokeColor + "33" : undefined,
      });
    } else if (tool === "line") {
      setDrawing({
        id,
        type: "line",
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: strokeColor,
        strokeWidth,
      });
    } else if (tool === "arrow") {
      setDrawing({
        id,
        type: "arrow",
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: strokeColor,
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
          if (Math.hypot(pos.x - lx, pos.y - ly) > 1.5) {
            pts.push(pos.x, pos.y);
          }
          return { ...d, points: pts };
        }
        case "rect":
          return { ...d, width: pos.x - d.x, height: pos.y - d.y };
        case "circle": {
          const r = Math.hypot(pos.x - d.x, pos.y - d.y);
          return { ...d, radius: r };
        }
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
    } else if ((ann.type === "line" || ann.type === "arrow") && Math.hypot(ann.points[2] - ann.points[0], ann.points[3] - ann.points[1]) < 3) {
      setDrawing(null);
      return;
    }
    addAnnotation(page.id, ann);
    setDrawing(null);
  };

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const text = editing.text;
    if (text.trim() === "") {
      deleteAnnotation(page.id, editing.id);
    } else {
      updateAnnotation(page.id, editing.id, { text } as any);
    }
    setEditing(null);
  }, [editing, page.id, deleteAnnotation, updateAnnotation]);

  const renderAnnotation = (ann: Annotation) => {
    const isSelected = selectedId === ann.id && selectedPageId === page.id;
    const draggable = tool === "cursor";
    const handleDragEnd = (e: any) => {
      if (ann.type === "rect" || ann.type === "text" || ann.type === "circle" || ann.type === "image") {
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
    switch (ann.type) {
      case "draw":
        return (
          <Line
            key={ann.id}
            {...(selectProps as any)}
            points={ann.points}
            stroke={ann.stroke}
            strokeWidth={ann.strokeWidth}
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
            fill={ann.stroke}
            pointerLength={10 + ann.strokeWidth * 2}
            pointerWidth={8 + ann.strokeWidth * 2}
            draggable={draggable}
            onDragEnd={handleDragEnd}
          />
        );
      case "text":
        if (editing && editing.id === ann.id) return null;
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
                setEditing({ id: ann.id, x: ann.x, y: ann.y, text: ann.text });
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

  return (
    <div
      ref={containerRef}
      data-page-index={index}
      className="relative mx-auto bg-white shadow-md"
      style={{
        width: stageWidth,
        height: stageHeight,
      }}
    >
      {/* PDF or blank canvas */}
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
        scaleX={1}
        scaleY={1}
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
        }}
      >
        <Layer scaleX={zoom} scaleY={zoom} listening>
          {page.annotations.map(renderAnnotation)}
          {drawing && renderAnnotation(drawing)}
        </Layer>
      </Stage>

      {/* Page number */}
      <div className="pointer-events-none absolute -left-12 top-2 select-none text-xs text-muted-foreground">
        {index + 1}
      </div>

      {editing && (
        <textarea
          autoFocus
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
