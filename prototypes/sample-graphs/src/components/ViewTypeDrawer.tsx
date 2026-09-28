import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X } from "lucide-react";
import type { ViewTypeDoc } from "../views/viewTypes";

// The View Type's own definition (docs/view-types/<id>.md), shown over the
// View so a reader can see the instructions it follows.
export function ViewTypeDrawer({ doc, onClose }: { doc: ViewTypeDoc; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-stone-900/20" onClick={onClose}>
      <aside
        className="flex h-full w-[560px] max-w-full flex-col border-l border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-stone-200 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">View Type · {doc.status}</div>
            <h2 className="text-lg font-semibold">{doc.name}</h2>
            <p className="text-sm italic text-stone-500">{doc.answers}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-100">
            <X className="size-4" />
          </button>
        </div>
        <div className="prose prose-sm prose-stone max-w-none flex-1 overflow-y-auto p-5 prose-h1:hidden">
          <Markdown remarkPlugins={[remarkGfm]}>{doc.body}</Markdown>
        </div>
      </aside>
    </div>
  );
}
