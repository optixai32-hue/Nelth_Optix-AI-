"use client";

import type { ReactNode } from "react";
import ShikiHighlighter, {
  type ShikiHighlighterProps,
} from "react-shiki";

function toCode(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(toCode).join("");
  if (children && typeof children === "object" && "props" in children) {
    return toCode((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export type SyntaxHighlighterProps = {
  code?: string;
  language?: string;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
};

/**
 * Single, unified syntax-highlighting renderer (react-shiki / Shiki).
 * Registered as the `code` component in markdown-text.tsx, so it replaces
 * Streamdown's built-in code block entirely — there is no fallback to the
 * legacy renderer. While a message is still streaming, react-shiki shows the
 * plain code and highlights once the block settles, keeping streaming cheap.
 */
export function SyntaxHighlighter({
  code,
  language,
  className,
  children,
  ...props
}: SyntaxHighlighterProps) {
  const source = code ?? toCode(children);

  return (
    <ShikiHighlighter
      {...(props as Omit<ShikiHighlighterProps, "children" | "theme">)}
      language={language ?? "text"}
      theme={{
        light: "github-light",
        dark: "github-dark",
      }}
      defaultColor="light-dark()"
      className={className}
    >
      {source}
    </ShikiHighlighter>
  );
}
