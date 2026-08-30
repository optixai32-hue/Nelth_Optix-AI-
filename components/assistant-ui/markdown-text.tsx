"use client";

import { createContext, useContext } from "react";

import type { Components } from "streamdown";

import { CodeBlock } from "./code-block";

/**
 * Fenced code blocks are wrapped in a `pre` element by the Markdown renderer,
 * while inline code (a single backtick fragment inside a sentence) is not. We
 * use this context to tell the two apart: anything rendered inside a `pre` is a
 * real code block, everything else is inline code.
 */
const InPreContext = createContext(false);

/**
 * Visual treatment for short code fragments that live inside a sentence. They
 * stay on the same line as the surrounding text with a distinct background,
 * monospace typography and rounded corners — but without the code-block chrome
 * (header, Copy / Download / Preview actions).
 */
function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

/**
 * Unified code renderer for Markdown. A `code` element is treated as a real
 * code block (with the modern CodeBlock UI) only when it sits inside a `pre`
 * (i.e. a fenced block) or carries an explicit `language-*` class. Otherwise it
 * is a short inline fragment and is rendered as inline code, never as a big
 * Code Block. This keeps small technical bits like `<svg>`, `fill` or
 * `npm install` flowing naturally inside the text.
 */
export const defaultComponents: Components = {
  pre: ({ children }) => (
    <InPreContext.Provider value={true}>{children}</InPreContext.Provider>
  ),
  code: (({ node, className, children, ...props }) => {
    const inPre = useContext(InPreContext);
    const hasLanguage =
      typeof className === "string" && /language-/.test(className);
    const isBlock = inPre || hasLanguage;

    if (isBlock) {
      return (
        <CodeBlock node={node} className={className} {...props}>
          {children}
        </CodeBlock>
      );
    }

    return <InlineCode>{children}</InlineCode>;
  }) as Components["code"],
  // Modern Markdown table: rounded glassy surface, sticky-tinted header,
  // hover/zebra rows, horizontal scroll on small screens.
  table: ({ children }) => (
    <div className="not-prose my-4 overflow-x-auto rounded-xl border border-border/60 bg-muted/20">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border/60">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="transition-colors even:bg-muted/30 hover:bg-muted/50">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="border-b border-border/60 px-4 py-2.5 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2.5 align-top text-muted-foreground">{children}</td>
  ),
};
