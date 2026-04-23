import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

type KeyRef = { k: number };

function renderInline(text: string, keyRef: KeyRef) {
  const parts: React.ReactNode[] = [];
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|https?:\/\/[^\s)]+)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  const linkClass = "text-[color:var(--branch-1)] underline underline-offset-2 hover:opacity-80";
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx, match.index)}</span>);
    if (match[2] && match[3])
      parts.push(<a key={keyRef.k++} href={match[3]} target="_blank" rel="noopener noreferrer" className={linkClass}>{match[2]}</a>);
    else if (match[4]) parts.push(<strong key={keyRef.k++} className="font-semibold">{match[4]}</strong>);
    else if (match[5]) parts.push(<em key={keyRef.k++}>{match[5]}</em>);
    else if (match[6])
      parts.push(
        <code key={keyRef.k++} className="rounded-sm bg-inline-code px-1.5 py-0.5 font-mono text-[0.9em]">
          {match[6]}
        </code>,
      );
    else if (match[7]) parts.push(<span key={keyRef.k++} className="line-through opacity-70">{match[7]}</span>);
    else if (match[0].startsWith("http"))
      parts.push(<a key={keyRef.k++} href={match[0]} target="_blank" rel="noopener noreferrer" className={linkClass}>{match[0]}</a>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx)}</span>);
  return parts;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <div className="relative my-3">
      {lang && (
        <div className="absolute top-2 left-3 font-mono text-[10px] lowercase text-muted-foreground/80">
          {lang}
        </div>
      )}
      <button
        onClick={doCopy}
        title={copied ? "Copied" : "Copy"}
        className={cn(
          "absolute top-1.5 right-1.5 rounded-md border px-2 py-1 font-mono text-[10px] transition-colors",
          "border-white/15 bg-black/20 text-white/70 hover:bg-black/40 hover:text-white",
          copied && "text-[color:var(--branch-0)]",
        )}
      >
        {copied ? "✓" : "copy"}
      </button>
      <pre
        className={cn(
          "overflow-x-auto rounded-lg bg-code-bg text-code-foreground font-mono text-[13px] leading-relaxed m-0",
          lang ? "pt-6 pb-3 px-3" : "py-3 px-3",
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function renderMd(text: string): React.ReactNode[] | null {
  if (!text) return null;
  const kr: KeyRef = { k: 0 };
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(<CodeBlock key={kr.k++} lang={lang} code={codeLines.join("\n")} />);
      continue;
    }
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<div key={kr.k++} className="my-3 h-px bg-border" />);
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote
          key={kr.k++}
          className="my-2 border-l-2 border-border pl-4 italic text-muted-foreground"
        >
          {quoteLines.map((q, idx) => (
            <div key={idx} className="text-[15px] leading-relaxed">
              {renderInline(q, kr)}
            </div>
          ))}
        </blockquote>,
      );
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\|\s*[-:| ]+\s*\|?\s*$/.test(lines[i + 1])) {
      const parseRow = (s: string) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      elements.push(
        <div key={kr.k++} className="my-2 overflow-x-auto">
          <table className="w-auto border-collapse text-[13px]">
            <thead>
              <tr>
                {header.map((h, idx) => (
                  <th key={idx} className="border border-border bg-muted px-3 py-1.5 text-left font-semibold">
                    {renderInline(h, kr)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-border px-3 py-1.5">
                      {renderInline(c, kr)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={kr.k++} className="mt-4 mb-1 text-[15px] font-semibold">
          {renderInline(line.slice(4), kr)}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={kr.k++} className="mt-4 mb-1 text-[17px] font-semibold">
          {renderInline(line.slice(3), kr)}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={kr.k++} className="mt-4 mb-1 text-[19px] font-semibold">
          {renderInline(line.slice(2), kr)}
        </h1>,
      );
      i++;
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={kr.k++} className="my-1 list-disc pl-6">
          {items.map((it) => (
            <li key={kr.k++} className="text-[15px] leading-relaxed">
              {renderInline(it, kr)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={kr.k++} className="my-1 list-decimal pl-6">
          {items.map((it) => (
            <li key={kr.k++} className="text-[15px] leading-relaxed">
              {renderInline(it, kr)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }
    if (line.trim() === "") {
      elements.push(<div key={kr.k++} className="h-2" />);
      i++;
      continue;
    }
    elements.push(
      <p key={kr.k++} className="text-[15px] leading-relaxed">
        {renderInline(line, kr)}
      </p>,
    );
    i++;
  }
  return elements;
}

export function renderCitations(
  citations: { url: string; title: string; snippet?: string }[],
): React.ReactNode {
  if (!citations?.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t border-border/60 pt-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Sources
      </div>
      <div className="flex flex-col gap-1">
        {citations.map((c, i) => {
          let host = "";
          try { host = new URL(c.url).hostname.replace(/^www\./, ""); } catch { host = ""; }
          return (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-baseline gap-2 rounded-md px-2 py-1 text-[13px] leading-snug hover:bg-muted/60"
            >
              <span className="text-muted-foreground/60 font-mono text-[10px]">
                {i + 1}
              </span>
              <span className="truncate font-medium text-[color:var(--branch-1)] hover:underline">
                {c.title || host || c.url}
              </span>
              {host && (
                <span className="shrink-0 truncate text-[11px] text-muted-foreground">
                  {host}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function ThinkingDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const interval = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(interval);
  }, []);
  return (
    <span>
      Thinking{dots}
      <span className="invisible">{"...".slice(dots.length)}</span>
    </span>
  );
}
