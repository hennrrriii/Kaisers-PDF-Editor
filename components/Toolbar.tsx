"use client";
import {
  MousePointer2,
  Type,
  Pencil,
  Square,
  Circle as CircleIcon,
  Minus,
  ArrowUpRight,
  Highlighter,
  Eraser,
  Save,
  ZoomIn,
  ZoomOut,
  Home,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HIGHLIGHT_COLORS, STROKE_COLORS, TEXT_COLORS, useEditor } from "@/lib/store";
import type { Tool } from "@/lib/types";

const tools: { id: Tool; icon: React.ComponentType<any>; label: string; key: string }[] = [
  { id: "cursor", icon: MousePointer2, label: "Select", key: "V" },
  { id: "text", icon: Type, label: "Text", key: "T" },
  { id: "highlight", icon: Highlighter, label: "Highlight", key: "H" },
  { id: "draw", icon: Pencil, label: "Draw", key: "D" },
  { id: "rect", icon: Square, label: "Rectangle", key: "R" },
  { id: "circle", icon: CircleIcon, label: "Circle", key: "C" },
  { id: "line", icon: Minus, label: "Line", key: "L" },
  { id: "arrow", icon: ArrowUpRight, label: "Arrow", key: "A" },
  { id: "eraser", icon: Eraser, label: "Eraser", key: "E" },
];

type Props = { onSave: () => void };

export function Toolbar({ onSave }: Props) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const strokeColor = useEditor((s) => s.strokeColor);
  const setStrokeColor = useEditor((s) => s.setStrokeColor);
  const textColor = useEditor((s) => s.textColor);
  const setTextColor = useEditor((s) => s.setTextColor);
  const highlightColor = useEditor((s) => s.highlightColor);
  const setHighlightColor = useEditor((s) => s.setHighlightColor);
  const strokeWidth = useEditor((s) => s.strokeWidth);
  const setStrokeWidth = useEditor((s) => s.setStrokeWidth);
  const fontSize = useEditor((s) => s.fontSize);
  const setFontSize = useEditor((s) => s.setFontSize);
  const filled = useEditor((s) => s.filled);
  const setFilled = useEditor((s) => s.setFilled);
  const fileName = useEditor((s) => s.fileName);

  const showStroke = ["draw", "rect", "circle", "line", "arrow"].includes(tool);
  const showFillToggle = ["rect", "circle"].includes(tool);
  const colors =
    tool === "text" ? TEXT_COLORS : tool === "highlight" ? HIGHLIGHT_COLORS : STROKE_COLORS;
  const activeColor =
    tool === "text" ? textColor : tool === "highlight" ? highlightColor : strokeColor;
  const setColor = (c: string) => {
    if (tool === "text") setTextColor(c);
    else if (tool === "highlight") setHighlightColor(c);
    else setStrokeColor(c);
  };

  return (
    <div className="flex h-14 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur">
      <Link
        href="/"
        className="flex items-center gap-2 pr-2 font-serif text-lg tracking-tight"
        title="Home"
      >
        <Home className="h-4 w-4 text-muted-foreground" />
        <span>Kaiser&apos;s</span>
      </Link>
      <div className="h-6 w-px bg-border" />

      <div className="flex items-center gap-1">
        {tools.map((t) => (
          <Button
            key={t.id}
            variant="toolbar"
            size="iconSm"
            data-active={tool === t.id}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
          >
            <t.icon className="h-4 w-4" />
          </Button>
        ))}
      </div>

      <div className="h-6 w-px bg-border" />

      {(tool === "text" || tool === "highlight" || showStroke) && (
        <div className="flex items-center gap-1">
          {colors.map((c) => (
            <button
              key={c.value}
              onClick={() => setColor(c.value)}
              className={`h-5 w-5 rounded-full border transition ${
                activeColor === c.value ? "ring-2 ring-offset-1 ring-primary" : ""
              }`}
              style={{ backgroundColor: c.value, borderColor: "rgba(0,0,0,0.15)" }}
              title={c.name}
            />
          ))}
        </div>
      )}

      {showStroke && (
        <>
          <div className="h-6 w-px bg-border" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Size
            <input
              type="range"
              min={1}
              max={16}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-24"
            />
            <span className="w-5 text-foreground">{strokeWidth}</span>
          </label>
        </>
      )}

      {showFillToggle && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={filled}
            onChange={(e) => setFilled(e.target.checked)}
          />
          Fill
        </label>
      )}

      {tool === "text" && (
        <>
          <div className="h-6 w-px bg-border" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Font
            <input
              type="range"
              min={8}
              max={48}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-24"
            />
            <span className="w-6 text-foreground">{fontSize}</span>
          </label>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">{fileName}</span>
        <div className="flex items-center gap-1 rounded-md border border-border">
          <Button variant="ghost" size="iconSm" onClick={() => setZoom(zoom - 0.1)} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="iconSm" onClick={() => setZoom(zoom + 0.1)} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={onSave} size="sm" title="Save PDF (Ctrl+S)">
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>
    </div>
  );
}
