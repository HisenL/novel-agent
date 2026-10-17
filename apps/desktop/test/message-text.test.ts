import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessageText } from "../src/renderer/MessageText.js";

const render = (text: string) =>
  renderToStaticMarkup(React.createElement(MessageText, { text }));

test("displays headings, emphasis, file references and literal code", () => {
  const html = render(
    "## 章节规划\n\n**已确认**：`story.yaml`\n```md\n**保持原样**\n```\n---",
  );
  expect(html).toContain('role="heading" aria-level="4"');
  expect(html).toContain("<strong>已确认</strong>");
  expect(html).toContain("<code>story.yaml</code>");
  expect(html).toContain("<pre><code>**保持原样**</code></pre>");
  expect(html).toContain("<hr");
});

test("never turns model content into HTML, images or navigation", () => {
  const html = render(
    '<script>alert(1)</script>\n<img src="https://example.com/track">\n[x](javascript:alert(1))\n![image](https://example.com/pixel)',
  );
  expect(html).not.toMatch(/<(script|img|a)(\s|>)/);
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("javascript:alert(1)");
});

test("keeps incomplete streaming markup readable", () => {
  expect(render("**尚未结束")).toContain("**尚未结束");
  expect(render("```\n未完成代码")).toContain(
    "<pre><code>未完成代码</code></pre>",
  );
  expect(render("第一行\r\n第二行")).toContain("第二行");
});
