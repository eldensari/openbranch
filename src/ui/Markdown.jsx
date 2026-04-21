import { useState, useEffect } from "react";

function renderInline(text, keyRef, t) {
  const parts = [];
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|https?:\/\/[^\s)]+)/g;
  let lastIdx = 0, match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx, match.index)}</span>);
    if (match[2] && match[3]) parts.push(<a key={keyRef.k++} href={match[3]} target="_blank" rel="noopener noreferrer" style={{ color: "#378ADD", textDecoration: "underline" }}>{match[2]}</a>);
    else if (match[4]) parts.push(<strong key={keyRef.k++}>{match[4]}</strong>);
    else if (match[5]) parts.push(<em key={keyRef.k++}>{match[5]}</em>);
    else if (match[6]) parts.push(<code key={keyRef.k++} style={{ background: t.inlineCode, padding: "1px 4px", borderRadius: 3, fontSize: "0.9em", fontFamily: "monospace" }}>{match[6]}</code>);
    else if (match[7]) parts.push(<span key={keyRef.k++} style={{ textDecoration: "line-through", opacity: 0.7 }}>{match[7]}</span>);
    else if (match[0].startsWith("http")) parts.push(<a key={keyRef.k++} href={match[0]} target="_blank" rel="noopener noreferrer" style={{ color: "#378ADD", textDecoration: "underline" }}>{match[0]}</a>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx)}</span>);
  return parts;
}

function CodeBlock({ lang, code, t }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => { try { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} };
  return (
    <div style={{ position: "relative", margin: "6px 0" }}>
      {lang && <div style={{ position: "absolute", top: 6, left: 10, fontSize: 9, color: t.textMuted, fontFamily: "monospace", textTransform: "lowercase" }}>{lang}</div>}
      <button onClick={doCopy} title={copied ? "Copied" : "Copy"}
        style={{ position: "absolute", top: 4, right: 4, padding: "3px 7px", fontSize: 9, borderRadius: 4, background: "transparent", border: "0.5px solid " + t.border, color: copied ? "#1D9E75" : t.textMuted, cursor: "pointer" }}>
        {copied ? "✓" : "copy"}
      </button>
      <pre style={{ background: t.codeBg, color: t.codeText, padding: lang ? "22px 12px 10px" : "10px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5, overflowX: "auto", fontFamily: "monospace", margin: 0 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function renderMd(text, t) {
  if (!text) return null;
  const kr = { k: 0 };
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++;
      elements.push(<CodeBlock key={kr.k++} lang={lang} code={codeLines.join("\n")} t={t} />);
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<div key={kr.k++} style={{ height: 1, background: t.border, margin: "12px 0" }} />);
      i++; continue;
    }
    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) { quoteLines.push(lines[i].slice(2)); i++; }
      elements.push(
        <div key={kr.k++} style={{ borderLeft: "3px solid " + t.border, paddingLeft: 10, margin: "6px 0", color: t.textSub, fontStyle: "italic" }}>
          {quoteLines.map((q, idx) => <div key={idx} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(q, kr, t)}</div>)}
        </div>
      );
      continue;
    }
    // Markdown table: header row of | cells |, separator of | --- |, then rows
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\|\s*[-:| ]+\s*\|?\s*$/.test(lines[i + 1])) {
      const parseRow = s => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(parseRow(lines[i])); i++; }
      elements.push(
        <div key={kr.k++} style={{ overflowX: "auto", margin: "6px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "auto" }}>
            <thead><tr>{header.map((h, idx) => <th key={idx} style={{ border: "0.5px solid " + t.border, padding: "6px 10px", background: t.hoverSidebar, textAlign: "left", fontWeight: 600 }}>{renderInline(h, kr, t)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ border: "0.5px solid " + t.border, padding: "5px 10px" }}>{renderInline(c, kr, t)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (line.startsWith("### ")) { elements.push(<div key={kr.k++} style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 4px" }}>{renderInline(line.slice(4), kr, t)}</div>); i++; continue; }
    if (line.startsWith("## ")) { elements.push(<div key={kr.k++} style={{ fontSize: 14, fontWeight: 700, margin: "12px 0 4px" }}>{renderInline(line.slice(3), kr, t)}</div>); i++; continue; }
    if (line.startsWith("# ")) { elements.push(<div key={kr.k++} style={{ fontSize: 16, fontWeight: 700, margin: "14px 0 4px" }}>{renderInline(line.slice(2), kr, t)}</div>); i++; continue; }
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(lines[i].slice(2)); i++; }
      elements.push(<ul key={kr.k++} style={{ margin: "4px 0", paddingLeft: 20 }}>{items.map(it => <li key={kr.k++} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(it, kr, t)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\. /, "")); i++; }
      elements.push(<ol key={kr.k++} style={{ margin: "4px 0", paddingLeft: 20 }}>{items.map(it => <li key={kr.k++} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(it, kr, t)}</li>)}</ol>);
      continue;
    }
    if (line.trim() === "") { elements.push(<div key={kr.k++} style={{ height: 6 }} />); i++; continue; }
    elements.push(<div key={kr.k++} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(line, kr, t)}</div>);
    i++;
  }
  return elements;
}

export function ThinkingDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const interval = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    return () => clearInterval(interval);
  }, []);
  return <span>Thinking{dots}<span style={{ visibility: "hidden" }}>{"...".slice(dots.length)}</span></span>;
}
