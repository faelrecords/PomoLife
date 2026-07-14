import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownResult({ children }: { children: string }) {
  return (
    <div className="markdown-result">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: linkChildren }) => <span>{linkChildren}</span>,
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
