"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeAbbr } from "@/lib/rehype-abbr";

/** A short markdown string (bold, italics, inline code) without a paragraph wrapper. */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeAbbr]}
      components={{ p: ({ children: inner }) => <>{inner}</> }}
    >
      {children}
    </ReactMarkdown>
  );
}
