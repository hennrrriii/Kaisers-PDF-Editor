"use client";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const Editor = dynamic(() => import("@/components/Editor").then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default function EditorPage() {
  return <Editor />;
}
