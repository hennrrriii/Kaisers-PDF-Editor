export type Tool =
  | "cursor"
  | "text"
  | "draw"
  | "rect"
  | "circle"
  | "line"
  | "arrow"
  | "highlight"
  | "eraser";

export type AnnotationBase = {
  id: string;
  type: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
};

export type DrawAnnotation = AnnotationBase & {
  type: "draw";
  points: number[];
  stroke: string;
  strokeWidth: number;
};

export type RectAnnotation = AnnotationBase & {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  strokeWidth: number;
  fill?: string;
};

export type CircleAnnotation = AnnotationBase & {
  type: "circle";
  x: number;
  y: number;
  radius: number;
  stroke: string;
  strokeWidth: number;
  fill?: string;
};

export type LineAnnotation = AnnotationBase & {
  type: "line";
  points: [number, number, number, number];
  stroke: string;
  strokeWidth: number;
};

export type ArrowAnnotation = AnnotationBase & {
  type: "arrow";
  points: [number, number, number, number];
  stroke: string;
  strokeWidth: number;
};

export type TextAnnotation = AnnotationBase & {
  type: "text";
  x: number;
  y: number;
  text: string;
  fill: string;
  fontSize: number;
  width?: number;
};

export type HighlightAnnotation = AnnotationBase & {
  type: "highlight";
  points: number[];
  stroke: string;
  strokeWidth: number;
};

export type ImageAnnotation = AnnotationBase & {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
};

export type Annotation =
  | DrawAnnotation
  | RectAnnotation
  | CircleAnnotation
  | LineAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | HighlightAnnotation
  | ImageAnnotation;

export type PageRef =
  | { kind: "pdf"; pdfPageIndex: number }
  | { kind: "blank"; width: number; height: number };

export type Page = {
  id: string;
  ref: PageRef;
  annotations: Annotation[];
};

export type ColorOption = { name: string; value: string };
