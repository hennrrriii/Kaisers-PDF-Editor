# Kaiser's — Fast PDF Notes for Students

Kaiser's is a fast, minimal, web-based PDF annotation tool built for university students. Open a lecture PDF, highlight, draw, add text and shapes, paste screenshots, insert blank pages, and export — all in your browser.

- Everything runs **client-side**. Your PDFs never leave your machine.
- Designed for **large lecture PDFs (200+ pages)** with lazy page rendering and per-page memory unloading.
- Keyboard-first. Quiet UI. No distractions.

---

## Stack

- Next.js 15 (App Router) + React 18 + TypeScript
- TailwindCSS + minimal shadcn/ui primitives
- Zustand (state)
- PDF.js (rendering)
- React-Konva (annotation layer)
- pdf-lib (PDF export)
- react-dropzone, react-hotkeys-hook, lucide-react, sonner

---

## Quick start

Requirements: **Node.js 18.18+** (Node 20 LTS recommended) and **npm 9+**.

```bash
# 1. Install
npm install
# if npm complains about peer dependencies on a fresh machine:
#   npm install --legacy-peer-deps

# 2. Run dev server
npm run dev
# open http://localhost:3000

# 3. Build for production
npm run build
npm run start
```

That's it. The app is a single Next.js application; no database, no backend, no environment variables required.

---

## Using Kaiser's

1. Drop a PDF onto the upload area (or click to choose).
2. The editor opens. Pages stream in as you scroll.
3. Pick a tool from the toolbar — or use the keyboard.
4. `Ctrl+S` exports an annotated copy.

### Tools

| Tool        | Key | Notes                                                                 |
|-------------|-----|-----------------------------------------------------------------------|
| Select      | V   | Click to select, drag to move, `Delete` removes.                      |
| Text        | T   | Click to place. Inline edit. Default color is **blue**.               |
| Highlight   | H   | Drag like a marker. Near-straight strokes auto-straighten.            |
| Draw        | D   | Free pen.                                                             |
| Rectangle   | R   | Outline by default. Toggle **Fill** in toolbar.                       |
| Circle      | C   |                                                                       |
| Line        | L   |                                                                       |
| Arrow       | A   |                                                                       |
| Eraser      | E   | Click an annotation to delete it.                                     |

`V` only switches tool when you are **not** typing in a text annotation.

### Other shortcuts

- **Ctrl/Cmd + S** — Save (export annotated PDF).
- **Ctrl/Cmd + wheel** — Smooth zoom.
- **Ctrl/Cmd + V** — Paste a screenshot/image from the clipboard onto the current page. Move and resize it freely.
- **Delete / Backspace** — Remove the selected annotation.
- **Esc** — Commit text being edited.

### Add a blank page

Hover the gap between two pages and click **+ Add page**. A blank, full-resolution page is inserted directly after the current page. It supports every tool and is included in the export.

### Save & autosave reminder

`Ctrl+S` immediately exports a PDF containing your annotations, inserted pages, highlights, shapes, and pasted images. Every ~15 minutes, if you have unsaved changes, Kaiser's nudges you with a quiet toast — no popups.

---

## Project structure

```
app/
  layout.tsx          Root layout, Toaster
  page.tsx            Landing + upload
  editor/page.tsx     Editor route (client-only)
  globals.css         Tailwind + theme tokens
components/
  Editor.tsx          Editor shell, shortcuts, paste, autosave
  Toolbar.tsx         Tool/color/size controls
  PdfPage.tsx         PDF canvas + Konva annotation layer
  UploadZone.tsx      Drag & drop landing widget
  ui/button.tsx       shadcn-style primitive
lib/
  store.ts            Zustand store
  types.ts            Annotation/Page types
  pdf.ts              pdfjs loader (worker via CDN)
  export.ts           pdf-lib export pipeline
  highlight.ts        Stroke-straightening logic
  utils.ts            cn(), uid()
```

---

## Performance notes

- **Lazy rendering.** Pages render only when within ~400px of the viewport (IntersectionObserver). When a page scrolls off, its canvas is unloaded to free memory.
- **DPR-capped rasterization.** Render scale is `zoom * min(devicePixelRatio, 2)` to stay crisp without blowing up memory on 4K screens.
- **Per-page Konva stage.** Each page has its own Stage, so events and redraws stay local — a stroke on page 73 does not invalidate the rest.
- **Smoothed draw.** Points are decimated (≥1.5 logical px between samples) before being committed.
- **Throttle-friendly zoom.** Ctrl+wheel multiplies zoom incrementally; canvases re-render with `cancelable` pdfjs tasks so rapid zooming never piles up work.

---

## Deploying to Vercel

Kaiser's deploys cleanly to Vercel with zero configuration.

### A) From the Vercel dashboard (recommended)

1. **Create a GitHub repository.**
   - Go to <https://github.com/new>, name it (e.g. `kaisers`), choose visibility, click **Create**.
2. **Push this code.**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/kaisers.git
   git push -u origin main
   ```
3. **Import into Vercel.**
   - Go to <https://vercel.com/new>.
   - Sign in with GitHub, authorize the repo if asked.
   - Click **Import** next to your `kaisers` repo.
4. **Configure.**
   - Framework preset: **Next.js** (auto-detected).
   - Build command: `next build` (default).
   - Output: handled by Vercel (default).
   - Install command: `npm install` (default).
   - Environment variables: **none required**.
5. **Deploy.**
   - Click **Deploy**. First build takes ~1 minute.
   - You get a `https://<project>.vercel.app` URL.
6. **Automatic deployments.**
   - Every push to `main` → **Production**.
   - Every push to another branch or PR → a **Preview** deployment with its own URL.

### B) From the Vercel CLI

```bash
npm i -g vercel
vercel        # follow prompts, link or create project
vercel --prod # deploy to production
```

### Build & runtime commands (reference)

| Action            | Command          |
|-------------------|------------------|
| Install deps      | `npm install`    |
| Local dev server  | `npm run dev`    |
| Production build  | `npm run build`  |
| Run production    | `npm run start`  |
| Lint              | `npm run lint`   |

---

## Environment variables

**None required.** Kaiser's runs entirely client-side. The PDF.js worker is loaded from the jsDelivr CDN, which works out of the box on Vercel.

If you prefer to host the worker yourself, replace the worker URL in [`lib/pdf.ts`](lib/pdf.ts) with a local path under `public/`.

---

## Troubleshooting

**The editor is blank after upload.**
Open the browser console. The most common cause is a broken PDF.js worker URL — verify your network can reach `cdn.jsdelivr.net`, or self-host the worker (see above).

**`Failed to compile` on first run.**
Make sure you ran `npm install` and your Node version is ≥ 18.18. Run `node -v` to check.

**Exported PDF text looks slightly off.**
pdf-lib embeds **Helvetica** for text annotations. If you need a custom font (e.g. Inter), use `PDFDocument.embedFont` with a `.ttf` you ship in `public/`.

**Highlighter doesn't snap to text.**
The highlighter currently auto-straightens any nearly straight stroke; full text-bounding-box snapping requires reading pdfjs `getTextContent()` per page, which adds latency. The visual result is identical for marker-style notes.

**`canvas` module errors during build.**
Already handled — `next.config.mjs` aliases `canvas` to `false`, which is the standard pdf.js-in-browser workaround.

**Performance feels sluggish on huge PDFs.**
Try reducing zoom (`Ctrl + scroll down`). Render cost is `O(zoom²)` per page.

---

## Recommended browsers

| Browser                  | Status |
|--------------------------|--------|
| Chrome / Edge (latest)   | ✅ Recommended |
| Firefox (latest)         | ✅ |
| Safari 16+               | ✅ |
| Mobile Safari / Chrome   | ⚠️ Works, but Kaiser's is built for keyboard + mouse |

Hardware-accelerated canvas + WebAssembly support are required — every modern browser since 2022 qualifies.

---

## License

MIT. Use it, fork it, ship it.
