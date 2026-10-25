import { Fragment, type ReactNode } from "react";
import { CodeBlock } from "./code-block";
import "./markdown.css";

// Small markdown renderer for AI chat replies. It builds React elements, never HTML strings,
// so model output can't inject markup. Covers what the chat AI writes: paragraphs, headings,
// lists, fenced code, inline code, bold, italics and http(s) links.

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|((?<![\w*])\*(?![\s*])[^*\n]+?\*(?![\w*]))|((?<!\w)_(?!\s)[^_\n]+?_(?!\w))/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token] = match;
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${at}`;
    if (match[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key}>{inline(token.slice(2, -2))}</strong>);
    else if (match[3]) {
      const split = token.indexOf("](");
      out.push(
        <a key={key} href={token.slice(split + 2, -1)} target="_blank" rel="noopener noreferrer">
          {inline(token.slice(1, split))}
        </a>,
      );
    } else out.push(<em key={key}>{inline(token.slice(1, -1))}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[]): ReactNode[] {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

// No emojis in AI replies. The server strips new ones; this covers messages saved before that.
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\uFE0F\u200D\u20E3]|[\u{E0020}-\u{E007F}])+[ \t]?/gu;

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(EMOJI, "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;
    if (!line.trim()) {
      i++;
    } else if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim().split(/\s/)[0] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<CodeBlock key={key} code={code.join("\n")} lang={lang} />);
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<p key={key} className="md-heading">{inline(line.replace(/^#+\s+/, ""))}</p>);
      i++;
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key}>{items.map((item, n) => <li key={n}>{inline(item)}</li>)}</List>);
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(\s*```|#{1,6}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])
      )
        para.push(lines[i++]);
      blocks.push(<p key={key}>{withBreaks(para)}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}
