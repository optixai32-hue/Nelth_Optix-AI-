"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  Maximize2,
  XIcon,
} from "lucide-react";

import { SpecFenceBlock } from "@/components/spec-fence-block";

import { SyntaxHighlighter } from "./shiki-highlighter";

function extractCode(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractCode).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractCode((children as { props: { children?: unknown } }).props.children);
  }
  return "";
}

const LANG_RE = /language-([\w-]+)/;

/** Languages that support an in-app visual preview. */
const PREVIEWABLE = new Set(["html", "htm", "svg"]);

/**
 * Heuristic: does the raw code look like an HTML/SVG document? Lets us preview
 * blocks the model tagged as `xml` / `markup` / untagged but that are really
 * HTML pages (common for AI-generated output).
 */
function looksLikeMarkup(code: string): boolean {
  const head = code.trimStart().slice(0, 256).toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<svg")
  );
}

/** File extension used when downloading a code block. */
const EXTENSIONS: Record<string, string> = {
  html: "html",
  htm: "html",
  svg: "svg",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  css: "css",
  json: "json",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  markdown: "md",
  md: "md",
  xml: "xml",
  yml: "yml",
  yaml: "yaml"
};

function normalizeLang(lang: string | undefined): string {
  if (!lang) return "text";
  const l = lang.toLowerCase();
  // Map common aliases to a stable key used for extensions/preview.
  if (l === "js") return "javascript";
  if (l === "ts") return "typescript";
  if (l === "py") return "python";
  if (l === "sh" || l === "shell" || l === "zsh") return "bash";
  if (l === "md") return "markdown";
  if (l === "yml") return "yaml";
  return l;
}

function getFileName(
  lang: string,
  meta: string | undefined
): string | undefined {
  if (meta && meta.trim().length > 0) {
    // A filename (with or without extension) was provided after the language.
    const candidate = meta.trim().split(/\s+/)[0];
    if (candidate && !candidate.includes(" ")) return candidate;
  }
  return undefined;
}

/**
 * Modern code-block UI (ChatGPT-style): a compact header with the file/language
 * label plus Copy / Download actions, and a Preview toggle for visualizable
 * formats (html / svg). The syntax highlighting itself is react-shiki — the
 * legacy highlighter is gone. `spec` fences are delegated to their own renderer.
 */
/**
 * Renders the in-app visual preview (html / svg) used both inline and in the
 * expanded fullscreen overlay.
 */

/**
 * Preview iframe sandbox: a real, ISOLATED frontend runtime.
 *
 * Isolation is the priority. We deliberately do NOT set `allow-same-origin`, so
 * the iframe runs on an opaque (null) origin that is fully separate from the
 * chatbot application. The generated code's `document` / `documentElement` /
 * `body` therefore belong to the iframe ONLY, and it cannot reach
 * `window.parent` — so a generated
 * `document.documentElement.classList.toggle("dark")` can never touch the
 * chatbot UI, and a generated `body { background: black }` can never restyle it.
 *
 * `allow-scripts` runs inline scripts + listeners; `allow-forms` lets forms
 * submit; `allow-modals` enables <dialog>.showModal()/alert/confirm;
 * `allow-popups*` lets window.open work.
 *
 * Because the opaque origin also blocks native `localStorage` / `sessionStorage`
 * (they throw a SecurityError that would abort the whole inline script), the
 * preview injects a tiny bootstrap (see PREVIEW_BOOTSTRAP) that shims those APIs
 * with an in-memory store and forwards uncaught errors to the parent via
 * postMessage. This is preview infrastructure only — the GENERATED CODE itself
 * is never rewritten.
 */
const PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox";

// Injected into the iframe document head ONLY (not into the user's code logic).
// Provides a non-throwing storage shim for sandboxed iframes and reports JS
// errors to the parent window. Active only when the native API is unavailable.
const PREVIEW_BOOTSTRAP = `<script>(function(){try{function s(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}try{window.localStorage.getItem("__p")}catch(e){Object.defineProperty(window,"localStorage",{configurable:true,value:s()})}try{window.sessionStorage.getItem("__p")}catch(e){Object.defineProperty(window,"sessionStorage",{configurable:true,value:s()})}}catch(e){}function r(p){try{parent.postMessage(Object.assign({__previewError:true},p),"*")}catch(e){}}window.addEventListener("error",function(ev){var e2=ev.error;r({message:ev.message||"Script error",stack:e2&&e2.stack?e2.stack:""})});window.addEventListener("unhandledrejection",function(ev){var rr=ev.reason;r({message:rr&&rr.message?rr.message:String(rr),stack:rr&&rr.stack?rr.stack:""})})})();<\/script>`;

function buildPreviewSrcDoc(code: string): string {
  if (/<head[^>]*>/i.test(code)) {
    return code.replace(/<head([^>]*)>/i, `<head$1>${PREVIEW_BOOTSTRAP}`);
  }
  if (/<html[^>]*>/i.test(code)) {
    return code.replace(/<html([^>]*)>/i, `<html$1><head>${PREVIEW_BOOTSTRAP}</head>`);
  }
  return `<!doctype html><html><head>${PREVIEW_BOOTSTRAP}</head>${code}`;
}

function PreviewBody({ language, code }: { language: string; code: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // The generated code is rendered as-is into an isolated iframe; we never
  // rewrite it. A small bootstrap (injected only inside the iframe) reports
  // runtime errors back to this component.
  //
  // DEBOUNCE: while the model streams, `code` changes on every token. Rebuilding
  // `srcDoc` (and thus reloading the iframe) on every token is catastrophic for
  // large HTML/SVG documents — it reloads the iframe hundreds of times and can
  // freeze the whole tab (observed with the non-thinking model). We only commit
  // a new srcDoc once the code has stopped changing for a short window, so the
  // preview settles to the final artifact instead of thrashing during streaming.
  const [srcDoc, setSrcDoc] = useState(() => buildPreviewSrcDoc(code));

  useEffect(() => {
    const timer = setTimeout(() => {
      setSrcDoc(buildPreviewSrcDoc(code));
      setRuntimeError(null);
    }, 350);
    return () => clearTimeout(timer);
  }, [code]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const data = e.data as
        | { __previewError?: boolean; message?: string; stack?: string }
        | undefined;
      if (data && data.__previewError) {
        setRuntimeError(
          `${data.message ?? "Unknown error"}${data.stack ? `\n${data.stack}` : ""}`
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (language === "svg") {
    return (
      <div
        className="flex min-h-[12rem] items-center justify-center bg-white p-4 text-sm"
        // SVG is static and safe to inline; it cannot execute scripts.
        dangerouslySetInnerHTML={{ __html: code }}
      />
    );
  }

  return (
    <div className="relative h-full min-h-[36rem] w-full bg-white">
      <iframe
        ref={iframeRef}
        title="HTML preview"
        sandbox={PREVIEW_SANDBOX}
        className="h-full min-h-[36rem] w-full border-0 bg-white"
        srcDoc={srcDoc}
      />
      {runtimeError && (
        <div className="absolute inset-0 overflow-auto bg-red-950/95 p-4 font-mono text-xs text-red-100">
          <div className="mb-2 font-semibold text-red-300">
            Preview runtime error
          </div>
          <pre className="whitespace-pre-wrap break-words">{runtimeError}</pre>
        </div>
      )}
    </div>
  );
}

function StandardCodeBlock({
  language,
  code,
  meta,
}: {
  language: string;
  code: string;
  meta?: string;
}) {
  const previewable =
    PREVIEWABLE.has(language) ||
    ((language === "xml" ||
      language === "markup" ||
      language === "text") &&
      looksLikeMarkup(code));
  const [copied, setCopied] = useState(false);
  // Previews open by default once a visualizable block (html/svg) finishes
  // generating, so the rendered result shows first; the user can switch to Code.
  const [showPreview, setShowPreview] = useState(previewable);
  // Fullscreen preview overlay (opened by the expand button in the header).
  const [expanded, setExpanded] = useState(false);

  // Close the fullscreen preview with Escape and lock background scroll while
  // it is open.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  const fileName = useMemo(() => {
    const provided = getFileName(language, meta);
    if (provided) return provided;
    const ext = EXTENSIONS[language];
    if (ext) return `code.${ext}`;
    return undefined;
  }, [language, meta]);

  const downloadExt = fileName?.includes(".")
    ? ""
    : EXTENSIONS[language]
      ? `.${EXTENSIONS[language]}`
      : "";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const onDownload = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName ?? "code"}${downloadExt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const label = fileName ?? (language === "text" ? "code" : language);
  const lineCount = useMemo(() => code.split("\n").length, [code]);

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-border/60 bg-muted/30 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-md bg-background/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {language}
          </span>
          {fileName && fileName !== language && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate font-mono text-xs text-muted-foreground/80">
                {fileName}
              </span>
            </>
          )}
          <span className="hidden text-[11px] text-muted-foreground/50 sm:inline">
            {lineCount} lines
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {previewable && (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              aria-label={showPreview ? "Show code" : "Show preview"}
              title={showPreview ? "Show code" : "Show preview"}
              aria-pressed={showPreview}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {showPreview ? (
                <CodeIcon className="size-3.5" />
              ) : (
                <EyeIcon className="size-3.5" />
              )}
            </button>
          )}
          <span className="mx-0.5 h-4 w-px bg-border/60" />
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy code"
            title="Copy code"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {copied ? (
              <CheckIcon className="size-3.5 text-emerald-400 transition-transform" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onDownload}
            aria-label="Download code"
            title="Download code"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <DownloadIcon className="size-3.5" />
          </button>
          {previewable && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label="Expand preview"
              title="Expand preview"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Maximize2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {showPreview && previewable ? (
        <div className="max-h-[36rem] overflow-auto text-sm">
          <PreviewBody language={language} code={code} />
        </div>
      ) : (
        <SyntaxHighlighter language={language} className="overflow-auto text-sm">
          {code}
        </SyntaxHighlighter>
      )}

      {expanded && previewable && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Preview"
              className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-sm"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="truncate font-medium text-foreground">
                  Preview · {label}
                </span>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close preview"
                  title="Close preview"
                  className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <PreviewBody language={language} code={code} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function CodeBlock({
  children,
  className,
  node,
  ...props
}: {
  children?: unknown;
  className?: string;
  node?: { properties?: { metastring?: string; className?: string[] } };
  [key: string]: unknown;
}) {
  const rawLang =
    typeof className === "string" ? LANG_RE.exec(className)?.[1] : undefined;
  const language = normalizeLang(rawLang);
  const code = extractCode(children);
  const meta = node?.properties?.metastring;

  // `spec` fences drive the Generated UI (Related questions / Images).
  if (language === "spec") {
    return <SpecFenceBlock source={code} />;
  }

  return <StandardCodeBlock language={language} code={code} meta={meta} />;
}
