"use client";

import { isValidElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import { CodeBlock } from "./CodeBlock";
import { Mermaid } from "./Mermaid";
import { ErdDiagram } from "./diagram/ErdDiagram";
import { FlowDiagram } from "./diagram/FlowDiagram";
import { isFlowchart } from "@/lib/diagram/parse";
import { ApiBlock } from "./ApiBlock";

/** Pull the plain-text content out of a fenced block's React children. */
function textOf(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

const components: Components = {
  // Inline code only: fenced blocks are handled by `pre` below.
  code({ className, children, ...props }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },

  /**
   * Every fenced block is a <pre> wrapping a <code>, with or without a
   * language, so blocks are routed here. Deciding in `code` by language
   * alone sent un-labelled fences down the inline path and collapsed their
   * line breaks.
   */
  pre({ children }) {
    const codeProps = isValidElement<{ className?: string; children?: React.ReactNode }>(children)
      ? children.props
      : {};
    const language = /language-([\w-]+)/.exec(codeProps.className ?? "")?.[1];
    const code = textOf(codeProps.children).replace(/\n$/, "");

    if (language === "mermaid") return isFlowchart(code) ? <FlowDiagram chart={code} /> : <Mermaid chart={code} />;
    if (language === "api") return <ApiBlock source={code} />;
    if (language === "erd") return <ErdDiagram source={code} />;
    return <CodeBlock code={code} language={language} />;
  },

  table({ children }) {
    return (
      <div className="my-6 overflow-x-auto rounded border border-rule">
        <table>{children}</table>
      </div>
    );
  },

  a({ href, children }) {
    const external = href?.startsWith("http");
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  },
};

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSlug]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}
