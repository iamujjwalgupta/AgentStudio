"use client";

import React from "react";

/**
 * Renders a skill's markdown as the reader should see it: headings, nested
 * lists, code, quotes, tables, bold and italic. Built from React elements, never
 * from HTML strings, so nothing in a skill can inject markup into the page.
 */

type Item = { text: string; children: ListNode[] };
type ListNode = { ordered: boolean; start: number; items: Item[] };

function inline(text: string, key = "i"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // code, bold, italic, links — in that order of precedence
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      const safe = /^https?:\/\//i.test(lm[2]);
      out.push(safe ? <a key={k} href={lm[2]} target="_blank" rel="noreferrer">{lm[1]}</a> : <span key={k}>{lm[1]}</span>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function buildList(lines: string[]): ListNode {
  const root: ListNode = { ordered: false, start: 1, items: [] };
  const stack: { indent: number; node: ListNode }[] = [];
  for (const line of lines) {
    const m = LIST.exec(line);
    if (!m) {
      // A continuation of the previous item.
      const top = stack[stack.length - 1];
      const item = top?.node.items[top.node.items.length - 1];
      if (item) item.text += " " + line.trim();
      continue;
    }
    const indent = m[1].replace(/\t/g, "  ").length;
    const ordered = /\d/.test(m[2]);
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    let top = stack[stack.length - 1];
    if (!top) {
      root.ordered = ordered;
      root.start = ordered ? parseInt(m[2], 10) || 1 : 1;
      stack.push((top = { indent, node: root }));
    } else if (indent > top.indent) {
      const parent = top.node.items[top.node.items.length - 1];
      const child: ListNode = { ordered, start: ordered ? parseInt(m[2], 10) || 1 : 1, items: [] };
      if (parent) parent.children.push(child);
      else top.node.items.push({ text: "", children: [child] });
      stack.push((top = { indent, node: child }));
    }
    top.node.items.push({ text: m[3], children: [] });
  }
  return root;
}

function renderList(node: ListNode, key: string): React.ReactNode {
  const Tag = node.ordered ? "ol" : "ul";
  return (
    <Tag key={key} start={node.ordered && node.start !== 1 ? node.start : undefined}>
      {node.items.map((it, i) => (
        <li key={i}>
          {inline(it.text, `${key}-${i}`)}
          {it.children.map((c, j) => renderList(c, `${key}-${i}-${j}`))}
        </li>
      ))}
    </Tag>
  );
}

export default function SkillMarkdown({ source, className = "" }: { source: string; className?: string }) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      flush();
      i++;
      continue;
    }
    if (t.startsWith("```")) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={`c${blocks.length}`}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      const level = Math.min(4, h[1].length + 1);
      const H = `h${level}` as "h2" | "h3" | "h4";
      blocks.push(<H key={`h${blocks.length}`}>{inline(h[2], `h${blocks.length}`)}</H>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      blocks.push(<hr key={`r${blocks.length}`} />);
      i++;
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) body.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push(<blockquote key={`q${blocks.length}`}>{inline(body.join(" "), `q${blocks.length}`)}</blockquote>);
      continue;
    }
    if (t.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const row = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(t);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) body.push(row(lines[i++]));
      const k = `t${blocks.length}`;
      blocks.push(
        <div key={k} className="md-table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && (LIST.test(lines[i]) || /^\s+\S/.test(lines[i]))) body.push(lines[i++]);
      blocks.push(renderList(buildList(body), `l${blocks.length}`));
      continue;
    }
    para.push(t);
    i++;
  }
  flush();
  return <div className={`md ${className}`}>{blocks}</div>;
}
