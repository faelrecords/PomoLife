import ReactMarkdown from "react-markdown";

export function MarkdownResult({ children }: { children: string }) {
  return (
    <div className="markdown-result">
      <ReactMarkdown
        skipHtml
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
