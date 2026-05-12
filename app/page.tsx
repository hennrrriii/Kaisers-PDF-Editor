import { UploadZone } from "@/components/UploadZone";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="mb-3 font-serif text-5xl tracking-tight">Kaiser&apos;s</div>
        <p className="max-w-md text-sm text-muted-foreground">
          A fast, minimal PDF workspace for university students. Open a lecture, annotate, save.
        </p>
      </div>
      <UploadZone />
      <div className="mt-10 grid max-w-xl grid-cols-3 gap-6 text-center text-xs text-muted-foreground">
        <div>
          <div className="mb-1 font-medium text-foreground">Local-first</div>
          Nothing is uploaded. Your PDFs stay on your device.
        </div>
        <div>
          <div className="mb-1 font-medium text-foreground">Fast</div>
          Designed for 200+ page lectures without lag.
        </div>
        <div>
          <div className="mb-1 font-medium text-foreground">Keyboard</div>
          V, T, D, H, R, C, L, A, Ctrl+S, Ctrl+V.
        </div>
      </div>
    </main>
  );
}
