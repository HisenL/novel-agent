import React from "react";

/** A deliberately small display subset, never HTML or active links from model output. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function MessageText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const key = index;
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) {
        code.push(lines[index++]!);
      }
      if (index < lines.length) index++;
      blocks.push(
        <pre key={key}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <div
          key={key}
          role="heading"
          aria-level={Math.min(6, heading[1]!.length + 2)}
          className="reply-heading"
        >
          {inline(heading[2]!)}
        </div>,
      );
    } else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
    } else if (line.trim()) {
      blocks.push(
        <div key={key} className="reply-line">
          {inline(line)}
        </div>,
      );
    } else {
      blocks.push(<div key={key} className="reply-gap" aria-hidden="true" />);
    }
    index++;
  }
  return <div className="message-text formatted-reply">{blocks}</div>;
}
