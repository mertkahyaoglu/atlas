"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import { CodeBlock } from "./CodeBlock";
import { Mermaid } from "./Mermaid";

/** Pull the plain-text content out of a fenced block's React children. */
function textOf(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

const components: Components = {
  /**
   * react-markdown routes both inline and fenced code here. Fenced blocks are
   * the ones carrying a `language-*` class; a `mermaid` fence becomes a
   * diagram, everything else becomes a copyable code block.
   */
  code({ className, children, ...props }) {
    const language = /language-(\w+)/.exec(className ?? "")?.[1];

    if (!language) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    const code = textOf(children).replace(/\n$/, "");
    if (language === "mermaid") return <Mermaid chart={code} />;
    return <CodeBlock code={code} language={language} />;
  },

  // Fenced blocks already render their own container, so drop the extra <pre>.
  pre({ children }) {
    return <>{children}</>;
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
