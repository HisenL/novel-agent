import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const { chromium, expect } = require("@playwright/test");
const executable = process.argv[2];
if (!executable) throw new Error("Pass a portable executable to test.");
const state = mkdtempSync(join(tmpdir(), "novel-agent-portable-state-"));
const token = "portable-smoke-fake-key";
let modelRequests = 0;
const model = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (request.tools?.[0]?.function?.name !== "connection_check") {
    res.writeHead(400).end();
    return;
  }
  modelRequests++;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "portable-check", type: "function", function: { name: "connection_check", arguments: '{"ok":true}' } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
  );
});
model.listen(0, "127.0.0.1");
await once(model, "listening");

async function launchAndCheck(reopen) {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const env = {
    ...process.env,
    NOVEL_AGENT_TEST_DIR: state,
    PATH: join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  // NSIS forwards arguments but not the inspector pipe expected by _electron.launch.
  // Attach only to this explicitly requested loopback test port instead.
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  const exited = once(child, "exit");
  let browser;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    await expect
      .poll(
        async () => {
          try {
            return (
              await fetch(`${endpoint}/json/version`, {
                signal: AbortSignal.timeout(1_000),
              })
            ).ok;
          } catch {
            return false;
          }
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    browser = await chromium.connectOverCDP(endpoint);
    await expect
      .poll(() => browser.contexts()[0]?.pages().length ?? 0)
      .toBeGreaterThan(0);
    const page = browser.contexts()[0].pages()[0];
    expect(page.url()).toContain("app.asar");
    await expect(
      page.getByRole("heading", { name: /把一个念头/ }),
    ).toBeVisible();
    const guide = page.getByRole("dialog", { name: "小说创作首次使用向导" });
    if (!reopen) {
      await expect(guide).toBeVisible();
      await expect(guide).toContainText("免安装运行版");
      await guide.getByRole("button", { name: "下一步" }).click();
      await guide.getByRole("button", { name: "下一步" }).click();
      await guide.getByRole("button", { name: "完成，开始创作" }).click();
    } else await expect(guide).toHaveCount(0);
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    if (!reopen) {
      await page.getByLabel("接口协议").selectOption("chat-completions");
      await page
        .getByLabel("服务地址")
        .fill(`http://127.0.0.1:${model.address().port}/v1`);
      await page.getByLabel("模型名称").fill("portable-smoke");
      await page.getByLabel("API Key").fill(token);
      await page.getByRole("button", { name: "保存并测试连接" }).click();
      await expect(page.getByText(/连接成功，portable-smoke/)).toBeVisible();
      expect(readFileSync(join(state, "settings.json"), "utf8")).not.toContain(
        token,
      );
    } else {
      await expect(page.getByLabel("模型名称")).toHaveValue("portable-smoke");
      await expect(page.getByLabel("API Key")).toHaveValue("");
      expect(modelRequests).toBe(1);
    }
    await page.getByRole("button", { name: "关闭模型设置" }).click();
    await page.close();
    await browser.close().catch(() => {});
    browser = undefined;
    const [exitCode] = await Promise.race([
      exited,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Portable wrapper did not exit")),
          10_000,
        );
        timer.unref();
      }),
    ]);
    expect(exitCode).toBe(0);
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
}
try {
  await launchAndCheck(false);
  await launchAndCheck(true);
  console.log(
    "Portable EXE passed: two independent launches, encrypted settings retained, no automatic model resend.",
  );
} finally {
  await new Promise((resolve) => model.close(resolve));
}
