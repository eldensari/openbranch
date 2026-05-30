import { useState, useEffect, useRef } from "react";
import { codeToHtml } from "shiki";
import katex from "katex";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function MathInline({ tex }: { tex: string }) {
  const html = katex.renderToString(tex, {
    displayMode: false,
    throwOnError: false,
    errorColor: "var(--destructive)",
  });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function MathBlock({ tex }: { tex: string }) {
  const html = katex.renderToString(tex, {
    displayMode: true,
    throwOnError: false,
    errorColor: "var(--destructive)",
  });
  return <div className="my-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}

type CitationLike = { url: string; title: string; snippet?: string };

export function getHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function Favicon({ host, className }: { host: string; className?: string }) {
  const [hide, setHide] = useState(false);
  if (!host || hide) return null;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
      alt=""
      loading="lazy"
      onError={() => setHide(true)}
      className={cn("size-3.5 shrink-0 rounded-sm", className)}
    />
  );
}

type KeyRef = { k: number };

// Private-use Unicode chars for citation tokens — guaranteed not to appear in
// model output, so we can safely splice them into the markdown source and
// recognize them during inline parsing to render chips at the exact position.
const CITE_TOKEN_RE = /(\d+)/;

function renderInline(text: string, keyRef: KeyRef, chips?: CitationLike[]) {
  const parts: React.ReactNode[] = [];
  // Inline math `$...$` requires non-whitespace next to the delimiters so
  // that "$10 each $20" or "Total: $5" isn't accidentally parsed as math.
  const regex = /(\$([^\s$](?:[^$\n]*?[^\s$])?)\$|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|(\d+)|https?:\/\/[^\s)]+)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  const linkClass = "text-[color:var(--branch-1)] underline underline-offset-2 hover:opacity-80";
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx, match.index)}</span>);
    if (match[2] !== undefined)
      parts.push(<MathInline key={keyRef.k++} tex={match[2]} />);
    else if (match[3] && match[4])
      parts.push(<a key={keyRef.k++} href={match[4]} target="_blank" rel="noopener noreferrer" className={linkClass}>{match[3]}</a>);
    else if (match[5]) parts.push(<strong key={keyRef.k++} className="font-semibold">{match[5]}</strong>);
    else if (match[6]) parts.push(<em key={keyRef.k++}>{match[6]}</em>);
    else if (match[7])
      parts.push(
        <code key={keyRef.k++} className="rounded-sm bg-inline-code px-1.5 py-0.5 font-mono text-[0.9em]">
          {match[7]}
        </code>,
      );
    else if (match[8]) parts.push(<span key={keyRef.k++} className="line-through opacity-70">{match[8]}</span>);
    else if (match[9] !== undefined) {
      const c = chips?.[parseInt(match[9], 10)];
      if (c) parts.push(<CitationChip key={keyRef.k++} c={c} />);
    } else if (match[0].startsWith("http"))
      parts.push(<a key={keyRef.k++} href={match[0]} target="_blank" rel="noopener noreferrer" className={linkClass}>{match[0]}</a>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx)}</span>);
  return parts;
}

const CITE_OPEN = String.fromCharCode(0xe000);
const CITE_CLOSE = String.fromCharCode(0xe001);
function makeCiteToken(idx: number): string {
  return CITE_OPEN + idx + CITE_CLOSE;
}

const shikiCache = new Map<string, string>();

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const cacheKey = (lang || "text") + ":::" + code;
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState<string | null>(() => shikiCache.get(cacheKey) ?? null);

  useEffect(() => {
    const cached = shikiCache.get(cacheKey);
    if (cached) {
      setHtml(cached);
      return;
    }
    let cancelled = false;
    codeToHtml(code, {
      lang: lang || "text",
      themes: { light: "github-light", dark: "github-dark" },
    })
      .then((out) => {
        shikiCache.set(cacheKey, out);
        if (!cancelled) setHtml(out);
      })
      .catch(() => { if (!cancelled) setHtml(null); });
    return () => { cancelled = true; };
  }, [cacheKey, code, lang]);

  const doCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <div className="group/copy relative my-3">
      {lang && (
        <div className="absolute top-2 left-3 z-10 font-mono text-[10px] lowercase text-muted-foreground/80">
          {lang}
        </div>
      )}
      <button
        onClick={doCopy}
        title={copied ? "Copied" : "Copy"}
        aria-label={copied ? "Copied" : "Copy code"}
        className={cn(
          "absolute top-2 right-2 z-10 inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs transition-all",
          "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
          "opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100",
          copied && "opacity-100 text-foreground hover:bg-transparent",
        )}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
      {html ? (
        <div
          className={cn(
            "rounded-lg overflow-hidden font-mono text-[13px] leading-relaxed",
            "[&>pre]:m-0 [&>pre]:overflow-x-auto",
            lang ? "[&>pre]:pt-6 [&>pre]:pb-3 [&>pre]:px-3" : "[&>pre]:py-3 [&>pre]:px-3",
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className={cn(
            "overflow-x-auto rounded-lg font-mono text-[13px] leading-relaxed m-0",
            "bg-[#ffffff] text-[#24292e] dark:bg-[#24292e] dark:text-[#e1e4e8]",
            lang ? "pt-6 pb-3 px-3" : "py-3 px-3",
          )}
        >
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

export function renderMd(text: string, chips?: CitationLike[]): React.ReactNode[] | null {
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
    if (line.startsWith("$$")) {
      const buf: string[] = [];
      const rest = line.slice(2);
      const closeIdx = rest.indexOf("$$");
      if (closeIdx >= 0) {
        buf.push(rest.slice(0, closeIdx));
        elements.push(<MathBlock key={kr.k++} tex={buf.join("\n")} />);
        i++;
        continue;
      }
      if (rest) buf.push(rest);
      i++;
      while (i < lines.length) {
        const idx = lines[i].indexOf("$$");
        if (idx >= 0) {
          if (idx > 0) buf.push(lines[i].slice(0, idx));
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      elements.push(<MathBlock key={kr.k++} tex={buf.join("\n")} />);
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
            <div key={idx} className="text-[16px] leading-relaxed">
              {renderInline(q, kr, chips)}
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
                    {renderInline(h, kr, chips)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-border px-3 py-1.5">
                      {renderInline(c, kr, chips)}
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
        <h3 key={kr.k++} className="mt-4 mb-1 text-[16px] font-semibold">
          {renderInline(line.slice(4), kr, chips)}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={kr.k++} className="mt-4 mb-1 text-[18px] font-semibold">
          {renderInline(line.slice(3), kr, chips)}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={kr.k++} className="mt-4 mb-1 text-[20px] font-semibold">
          {renderInline(line.slice(2), kr, chips)}
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
            <li key={kr.k++} className="text-[16px] leading-relaxed">
              {renderInline(it, kr, chips)}
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
            <li key={kr.k++} className="text-[16px] leading-relaxed">
              {renderInline(it, kr, chips)}
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
      <p key={kr.k++} className="text-[16px] leading-relaxed">
        {renderInline(line, kr, chips)}
      </p>,
    );
    i++;
  }
  return elements;
}

function CitationChip({ c }: { c: CitationLike }) {
  const [open, setOpen] = useState(false);
  const enterT = useRef<number | null>(null);
  const leaveT = useRef<number | null>(null);
  const host = getHost(c.url);
  const label = c.title || host || c.url;

  const onEnter = () => {
    if (leaveT.current) { window.clearTimeout(leaveT.current); leaveT.current = null; }
    enterT.current = window.setTimeout(() => setOpen(true), 180);
  };
  const onLeave = () => {
    if (enterT.current) { window.clearTimeout(enterT.current); enterT.current = null; }
    leaveT.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          className="inline-flex max-w-[180px] items-center whitespace-nowrap rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <span className="truncate">{label}</span>
        </a>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 p-3"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Favicon host={host} />
          <span className="truncate">{host}</span>
        </div>
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 block text-base font-medium leading-snug hover:underline"
        >
          {c.title || c.url}
        </a>
        {c.snippet && (
          <p className="mt-1.5 text-xs leading-snug text-muted-foreground line-clamp-3">
            {c.snippet}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function renderCitationChips(citations: CitationLike[]): React.ReactNode {
  if (!citations?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {citations.map((c, i) => <CitationChip key={i} c={c} />)}
    </div>
  );
}

// Anthropic web search often splits a single markdown line across multiple
// content blocks (e.g. "- " in one block, its content in the next). Each
// cited block should become its own chunk (so chips stay positional), but
// any un-cited block is prefix text — it gets folded into the NEXT cited
// block. Any trailing un-cited text after the last citation is emitted as
// a final chip-less chunk.
export function renderResponseBlocks(
  blocks: { text: string; citations?: CitationLike[] }[],
): React.ReactNode[] {
  // Concatenate all block text into one markdown document. Citations don't
  // get their token where the cited block ends — Anthropic frequently splits
  // a single Korean sentence across citation boundaries ("유명" + cite, then
  // "하고, ... 평가" + cite, then "됩니다."), which would put the chip mid-
  // clause. Instead, hold citations as pending and flush them at the next
  // newline (end of the line/bullet they belong to), matching the design
  // mock where chips trail the sentence / bullet as a whole.
  const chips: CitationLike[] = [];
  let combined = "";
  let pending: CitationLike[] = [];

  const flush = () => {
    for (const c of pending) {
      combined += makeCiteToken(chips.length);
      chips.push(c);
    }
    pending = [];
  };

  for (const b of blocks) {
    const text = b.text;
    let lastIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        combined += text.slice(lastIdx, i);
        flush();
        combined += "\n";
        lastIdx = i + 1;
      }
    }
    combined += text.slice(lastIdx);
    if (b.citations?.length) pending.push(...b.citations);
  }
  flush();

  const rendered = renderMd(combined, chips);
  return rendered || [];
}

export function SourceCard({ c }: { c: CitationLike }) {
  const host = getHost(c.url);
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-transparent p-3 transition hover:border-border hover:bg-accent"
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Favicon host={host} />
        <span className="truncate">{host}</span>
      </div>
      <div className="mt-1 text-base font-medium leading-snug">
        {c.title || c.url}
      </div>
      {c.snippet && (
        <div className="mt-1 text-xs leading-snug text-muted-foreground line-clamp-2">
          {c.snippet}
        </div>
      )}
    </a>
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
