import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const executablePath = require("electron") as string;
const { unzipSync } = createRequire(import.meta.resolve("@novel-agent/kernel"))(
  "fflate",
) as { unzipSync(data: Uint8Array): Record<string, Uint8Array> };
const appRoot = resolve(import.meta.dirname, "..");
const chapter = "manuscript/main/chapter-1.md";
const candidateSummary = "补充雨夜调查开场。".repeat(40);
const generated =
  "# 第一章\n\n雨声沿着窗框落下。调查员林舟握住旧钥匙，意识到这间屋子的主人正在等他。\n";

test("desktop: open, configure, tool loop, review, undo, reject, export and reopen", async () => {
  const state = mkdtempSync(join(tmpdir(), "novel-desktop-state-"));
  const workspace = mkdtempSync(join(tmpdir(), "novel-desktop-story-"));
  const exported = join(state, "story.zip");
  const token = "local-fixture-credential";
  const requests: Record<string, unknown>[] = [];
  let responseMode: "normal" | "hold" | "fail" = "normal";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const check = request.tools?.[0]?.function?.name === "connection_check";
    if (
      !check &&
      !request.tools.some(
        (tool: { function: { name: string } }) =>
          tool.function.name === "propose_document",
      )
    ) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "只读审稿完成：建议检查人物获知线索的时间。" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
      return;
    }
    if (!check && responseMode === "hold") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": awaiting cancellation\n\n");
      return;
    }
    if (!check && responseMode === "fail") {
      res.writeHead(503);
      res.end("private provider diagnostic must not be shown");
      return;
    }
    const count = (request.messages ?? []).filter(
      (m: { role: string }) => m.role === "tool",
    ).length;
    const batch = request.tools?.some(
      (tool: { function: { name: string } }) =>
        tool.function.name === "pause_for_author",
    );
    const name = batch
      ? count === 0
        ? "read_document"
        : "propose_document"
      : check
        ? "connection_check"
        : count === 0
          ? "update_plan"
          : count === 1
            ? "read_document"
            : "propose_document";
    const args = batch
      ? count === 0
        ? { path: chapter }
        : {
            path: count === 1 ? chapter : "story.yaml",
            content:
              count === 1
                ? generated
                : "schemaVersion: 1\ntitle: 批量候选名称\n",
            summary: "批量测试候选",
          }
      : check
        ? { ok: true }
        : count === 0
          ? { steps: ["读取章节与约定", "续写开场并提交审阅"] }
          : count === 1
            ? { path: chapter }
            : {
                path: chapter,
                content: generated,
                summary: candidateSummary,
              };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] })}\n\n`,
    );
    res.end(
      'data: {"choices":[],"usage":{"prompt_tokens":40,"completion_tokens":25}}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  let application: ElectronApplication | undefined;
  const launch = async (): Promise<ElectronApplication> => {
    const env = { ...process.env, NOVEL_AGENT_TEST_DIR: state };
    delete env.ELECTRON_RUN_AS_NODE;
    const launched = await electron.launch({
      executablePath,
      args: [appRoot],
      env,
    });
    await launched.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [paths.workspace],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: paths.exported,
        });
      },
      { workspace, exported },
    );
    return launched;
  };
  try {
    application = await launch();
    let page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(
      page.getByRole("heading", { name: /把一个念头/ }),
    ).toBeVisible();
    const shotRoot = resolve(appRoot, "../../.tmp/desktop-verification");
    mkdirSync(shotRoot, { recursive: true });
    const guide = page.getByRole("dialog", { name: "小说创作首次使用向导" });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("空文件夹用");
    await expect(guide).toContainText("第 1 / 3 步");
    await guide.getByRole("button", { name: "下一步" }).click();
    await expect(guide).toContainText("第 2 / 3 步");
    await expect(guide).toContainText("测试连接");
    await guide.getByRole("button", { name: "下一步" }).click();
    await expect(guide).toContainText("不是完整备份");
    await page.screenshot({ path: join(shotRoot, "quick-start-guide.png") });
    await guide.getByRole("button", { name: "完成，开始创作" }).click();
    await expect(guide).toHaveCount(0);
    await page.getByRole("button", { name: "使用指南", exact: true }).click();
    await expect(guide).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "使用指南", exact: true }),
    ).toBeFocused();
    expect(requests).toHaveLength(0);
    await page.screenshot({ path: join(shotRoot, "welcome.png") });
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences(),
    );
    expect(preferences.sandbox).toBe(true);
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    const modeControl = page.getByRole("combobox", {
      name: "工作模式",
      exact: true,
    });
    const skillControl = page.getByRole("combobox", {
      name: "创作技能",
      exact: true,
    });
    const modeBox = await modeControl.boundingBox();
    const skillBox = await skillControl.boundingBox();
    expect(modeBox).not.toBeNull();
    expect(skillBox).not.toBeNull();
    expect(skillBox!.y).toBeGreaterThanOrEqual(modeBox!.y + modeBox!.height);
    expect(
      await modeControl.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    ).toBeGreaterThanOrEqual(12);
    expect(
      await page
        .locator(".agent-conversation")
        .evaluate((element) => element.clientHeight),
    ).toBeGreaterThan(80);
    await page
      .locator("main")
      .getByRole("button", { name: "新建 / 导入作品" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "正文编辑器" }),
    ).toBeVisible();
    const editor = page.getByRole("textbox", { name: "正文编辑器" });
    const emptyWorkspace = mkdtempSync(join(tmpdir(), "novel-empty-project-"));
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, emptyWorkspace);
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    const projectDialog = page.getByRole("dialog", {
      name: "作品管理",
      exact: true,
    });
    await expect(projectDialog.getByLabel("当前作品位置")).toHaveValue(
      workspace,
    );
    await projectDialog.getByRole("button", { name: "作品设置表单" }).click();
    const settingsForm = page.getByRole("dialog", {
      name: "作品设置",
      exact: true,
    });
    await settingsForm.getByLabel("作品名称", { exact: true }).fill("雨夜档案");
    await settingsForm
      .getByLabel("叙事视角", { exact: true })
      .fill("第三人称限知");
    await settingsForm.getByRole("button", { name: "保存作品设置" }).click();
    await expect(settingsForm).not.toBeVisible();
    expect(readFileSync(join(workspace, "story.yaml"), "utf8")).toContain(
      "第三人称限知",
    );
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await projectDialog.getByRole("button", { name: "作品设置表单" }).click();
    await expect(
      settingsForm.getByLabel("作品名称", { exact: true }),
    ).toHaveValue("雨夜档案");
    await settingsForm.getByRole("button", { name: "关闭作品设置" }).click();
    await page
      .getByRole("combobox", { name: "创作技能", exact: true })
      .selectOption("continuity-review.v3");
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await projectDialog.getByRole("button", { name: "切换已有作品" }).click();
    await expect(projectDialog.getByRole("alert")).toContainText(
      "此文件夹还不是作品",
    );
    expect(existsSync(join(emptyWorkspace, "story.yaml"))).toBe(false);
    await expect(
      page.getByRole("combobox", { name: "创作技能", exact: true }),
    ).toHaveValue("continuity-review.v3");
    await expect(projectDialog.getByLabel("当前作品位置")).toHaveValue(
      workspace,
    );
    await projectDialog
      .getByRole("button", {
        name: "将所选文件夹初始化为作品",
      })
      .click();
    await expect(projectDialog).not.toBeVisible();
    expect(existsSync(join(emptyWorkspace, "story.yaml"))).toBe(true);
    await expect(
      page.getByRole("combobox", { name: "创作技能", exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("checkbox", { name: "只读讨论与审稿（不生成候选）" }),
    ).not.toBeChecked();
    expect(readFileSync(join(workspace, "story.yaml"), "utf8")).toContain(
      "雨夜档案",
    );
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, workspace);
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await expect(projectDialog.getByLabel("当前作品位置")).toHaveValue(
      emptyWorkspace,
    );
    await projectDialog.getByRole("button", { name: "切换已有作品" }).click();
    await expect(projectDialog).not.toBeVisible();
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await expect(projectDialog.getByLabel("当前作品位置")).toHaveValue(
      workspace,
    );
    await page.getByRole("button", { name: "关闭作品管理" }).click();
    await editor.fill("# 第一章\n\n作者手动写下的开场。");
    await editor.press("Control+s");
    await expect
      .poll(() => readFileSync(join(workspace, chapter), "utf8"))
      .toContain("作者手动写下的开场");
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await projectDialog
      .getByRole("button", { name: "新建 / 导入作品", exact: true })
      .click();
    await expect
      .poll(() => existsSync(join(emptyWorkspace, "story.yaml")))
      .toBe(true);
    await page
      .getByRole("button", {
        name: workspace.split(/[\\/]/u).at(-1)!,
        exact: true,
      })
      .click();
    await expect(editor).toContainText("作者手动写下的开场");
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, workspace);
    await editor.fill("# 第一章\n\n");
    await editor.press("Control+s");
    await expect
      .poll(() => readFileSync(join(workspace, chapter), "utf8"))
      .toBe("# 第一章\n\n");
    for (let attempt = 0; attempt < 5; attempt++) {
      const immediate = `# 第一章\n\n连续输入后立即保存 ${attempt}。`;
      await editor.fill(immediate);
      await editor.press("Control+s");
      await expect
        .poll(() => readFileSync(join(workspace, chapter), "utf8"))
        .toBe(immediate);
      await expect(
        page.getByRole("button", { name: "已保存", exact: true }),
      ).toBeVisible();
    }
    await editor.fill("# 第一章\n\n");
    await editor.press("Control+s");
    await expect
      .poll(() => readFileSync(join(workspace, chapter), "utf8"))
      .toBe("# 第一章\n\n");
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page.getByLabel("接口协议").selectOption("chat-completions");
    await page
      .getByLabel("服务地址")
      .fill(`http://127.0.0.1:${address.port}/v1`);
    await page.getByLabel("模型名称").fill("fixture-writer");
    await page.getByLabel("API Key").fill(token);
    await page.getByLabel("输入单价（美元／百万 Token）").fill("0.5");
    await page.getByLabel("输出单价（美元／百万 Token）").fill("2");
    await page.getByRole("button", { name: "保存并测试连接" }).click();
    await expect(page.getByText(/连接成功，fixture-writer/)).toBeVisible();
    expect(readFileSync(join(state, "settings.json"), "utf8")).not.toContain(
      token,
    );
    await page.getByRole("button", { name: "关闭模型设置" }).click();
    await page.getByText("候选文件范围 · 未限定文件", { exact: true }).click();
    await page.getByLabel("限定可生成候选的文件", { exact: true }).check();
    await expect(
      page.getByLabel(`候选范围 ${chapter}`, { exact: true }),
    ).toBeChecked();
    await page.getByText("候选文件范围 · 1 个文件", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("阅读当前章节，规划雨夜调查开场并生成正文候选。");
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toBeVisible();
    await page.getByText("本轮参考与用量", { exact: true }).click();
    await expect(page.locator(".receipt")).toContainText(
      "按手填单价估算 USD $0.00021000",
    );
    expect(readFileSync(join(workspace, chapter), "utf8")).not.toContain(
      "调查员",
    );
    await page.getByRole("button", { name: /有一份修改等待审阅/ }).click();
    const explanation = page.locator(".proposal-explanation");
    await expect(explanation).not.toHaveAttribute("open", "");
    await page
      .getByRole("button", { name: "调整候选内容", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "调整候选内容", exact: true })
      .fill(generated + "手动调整保留检查");
    await page.getByRole("button", { name: "查看对比", exact: true }).click();
    await expect(page.locator(".diff-content")).toContainText(
      "手动调整保留检查",
    );
    await expect(
      page.getByRole("button", { name: "调整后接受", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "调整候选内容", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "调整候选内容", exact: true })
      .fill(generated);
    await page.getByRole("button", { name: "查看对比", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "审阅文件修改" }),
    ).toBeVisible();
    await explanation.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(explanation).toHaveAttribute("open", "");
    await expect(explanation.locator("div")).toHaveText(candidateSummary);
    expect(
      await explanation.locator("div").evaluate((el) => el.clientHeight),
    ).toBeLessThanOrEqual(140);
    await page.keyboard.press("Enter");
    await expect(explanation).not.toHaveAttribute("open", "");
    await page.getByRole("button", { name: "写作", exact: true }).click();
    await page
      .getByRole("textbox", { name: "正文编辑器" })
      .fill("未保存的作者修改");
    await page.getByRole("button", { name: "修改对比", exact: true }).click();
    await page.getByRole("button", { name: "接受修改", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("正文有未保存的修改");
    expect(readFileSync(join(workspace, chapter), "utf8")).toBe("# 第一章\n\n");
    await page.getByRole("button", { name: "写作", exact: true }).click();
    await page
      .getByRole("textbox", { name: "正文编辑器" })
      .fill("# 第一章\n\n");
    await page.getByRole("button", { name: "修改对比", exact: true }).click();
    await page.screenshot({ path: join(shotRoot, "review.png") });
    await page.getByRole("button", { name: "接受修改", exact: true }).click();
    await expect(
      page.getByText("修改已接受，已保存一个新版本。"),
    ).toBeVisible();
    expect(readFileSync(join(workspace, chapter), "utf8")).toBe(generated);
    await page.getByRole("button", { name: "版本历史", exact: true }).click();
    await page.getByRole("button", { name: "撤销这次修改" }).first().click();
    await page.getByRole("button", { name: "接受修改", exact: true }).click();
    await expect
      .poll(() => readFileSync(join(workspace, chapter), "utf8"))
      .toBe("# 第一章\n\n");
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("重新生成雨夜开场，交给我决定是否接受。");
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /有一份修改等待审阅/ }).click();
    await page.getByRole("button", { name: "拒绝修改", exact: true }).click();
    await expect(page.getByText("已拒绝，正式正文保持不变。")).toBeVisible();
    const beforeRedo = requests.length;
    await page.locator("summary").filter({ hasText: "候选文件范围" }).click();
    await page.getByLabel("限定可生成候选的文件", { exact: true }).check();
    await page.getByLabel(`候选范围 ${chapter}`, { exact: true }).uncheck();
    await page.getByLabel("候选范围 story.yaml", { exact: true }).check();
    await page
      .getByRole("button", { name: "准备重做要求", exact: true })
      .click();
    await expect(
      page.getByLabel("限定可生成候选的文件", { exact: true }),
    ).not.toBeChecked();
    await page.locator("summary").filter({ hasText: "候选文件范围" }).click();
    await expect(page.getByRole("textbox", { name: "创作要求" })).toHaveValue(
      /我的修改意见：$/u,
    );
    await expect(
      page.getByRole("textbox", { name: "正文编辑器" }),
    ).toContainText("第一章");
    await expect(
      page.getByLabel("只读讨论与审稿（不生成候选）"),
    ).not.toBeChecked();
    expect(requests.length).toBe(beforeRedo);
    expect(readFileSync(join(workspace, chapter), "utf8")).toBe("# 第一章\n\n");
    await page.getByRole("button", { name: "导出作品", exact: true }).click();
    await expect.poll(() => existsSync(exported)).toBe(true);
    await expect(
      page.getByText(/作品已导出到.*不含任务历史、待审候选或密钥/u),
    ).toBeVisible();
    const importedRoot = mkdtempSync(join(tmpdir(), "novel-export-roundtrip-"));
    const entries = unzipSync(readFileSync(exported));
    expect(Object.keys(entries)).not.toContain(".novel-agent/events.sqlite3");
    for (const [path, bytes] of Object.entries(entries)) {
      // Only extract known workspace-relative entries from our own test export.
      expect(path).toMatch(
        /^(?:story\.yaml|(?:manuscript|outline|canon)\/[^\\:]+)$/u,
      );
      expect(path.split("/")).not.toContain("..");
      const target = join(importedRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    const beforeImport = requests.length;
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, importedRoot);
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await projectDialog
      .getByRole("button", { name: "新建 / 导入作品", exact: true })
      .click();
    await expect(projectDialog).not.toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "正文编辑器" }),
    ).toContainText("第一章");
    expect(readFileSync(join(importedRoot, "story.yaml"), "utf8")).toContain(
      "雨夜档案",
    );
    const importedEditor = page.getByRole("textbox", { name: "正文编辑器" });
    await importedEditor.fill("# 第一章\n\n导入后继续创作。");
    await importedEditor.press("Control+s");
    await expect
      .poll(() => readFileSync(join(importedRoot, chapter), "utf8"))
      .toContain("导入后继续创作。");
    expect(readFileSync(join(workspace, chapter), "utf8")).toBe("# 第一章\n\n");
    expect(requests.length).toBe(beforeImport);
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, workspace);
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await projectDialog
      .getByRole("button", { name: "切换已有作品", exact: true })
      .click();
    await expect(projectDialog).not.toBeVisible();
    expect(requests.length).toBeGreaterThanOrEqual(7);
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "写作", exact: true }).click();
    const positionEditor = page.getByRole("textbox", { name: "正文编辑器" });
    await positionEditor.press("Control+Home");
    for (let n = 0; n < 3; n++) await positionEditor.press("ArrowRight");
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(
      page.getByRole("dialog", { name: "小说创作首次使用向导" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: workspace.split(/[\\/]/u).at(-1)!,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("textbox", { name: "正文编辑器" }),
    ).toContainText("第一章");
    await page.getByRole("textbox", { name: "正文编辑器" }).focus();
    await page
      .getByRole("textbox", { name: "正文编辑器" })
      .press("Shift+ArrowRight");
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe("一");
    await page.getByRole("textbox", { name: "正文编辑器" }).press("ArrowLeft");
    await expect(
      page.getByText("重新生成雨夜开场，交给我决定是否接受。", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(shotRoot, "reopened.png") });
    responseMode = "hold";
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("继续写作，测试暂停后的恢复。");
    const beforePause = requests.length;
    await page
      .getByRole("textbox", { name: "创作要求" })
      .evaluate((element) => {
        for (let n = 0; n < 3; n++)
          element.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              ctrlKey: true,
              bubbles: true,
            }),
          );
      });
    await expect.poll(() => requests.length).toBeGreaterThan(beforePause);
    await expect(
      page.getByText("继续写作，测试暂停后的恢复。", { exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("运行中不能重复提交");
    await page
      .getByRole("textbox", { name: "创作要求" })
      .press("Control+Enter");
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续任务（将调用模型）" }),
    ).toBeVisible();
    expect(requests.length).toBe(beforePause + 1);
    expect(readFileSync(join(workspace, chapter), "utf8")).toBe("# 第一章\n\n");
    responseMode = "fail";
    await page.getByRole("button", { name: "继续任务（将调用模型）" }).click();
    await expect(page.locator(".task-issue")).toContainText("503");
    await expect(page.locator(".task-issue")).toContainText(
      "软件不会自动重发请求",
    );
    await expect(page.locator(".task-issue")).toContainText(
      "失败或中断的调用也可能已计费",
    );
    const beforeRecoverySettings = requests.length;
    await page.getByRole("button", { name: "检查模型连接设置" }).click();
    await expect(page.getByLabel("模型名称")).toBeVisible();
    expect(requests.length).toBe(beforeRecoverySettings);
    await page.getByRole("button", { name: "关闭模型设置" }).click();
    await expect(page.locator("body")).not.toContainText(
      "private provider diagnostic",
    );
    responseMode = "normal";
    await page.getByRole("button", { name: "继续任务（将调用模型）" }).click();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toBeVisible();
    // A later failed turn must not hide recovery behind an older pending draft.
    responseMode = "fail";
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("保留现有候选，检查下一步；测试连接失败。");
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect(page.locator(".task-issue")).toContainText("503");
    await expect(
      page.getByRole("button", { name: "继续任务（将调用模型）" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toBeVisible();
    const beforeRestart = requests.length;
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page
      .getByRole("button", {
        name: workspace.split(/[\\/]/u).at(-1)!,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toBeVisible();
    expect(requests.length).toBe(beforeRestart);
    await expect(
      page.getByRole("button", { name: "继续任务（将调用模型）" }),
    ).toBeVisible();
    responseMode = "normal";
    await page.getByRole("button", { name: /有一份修改等待审阅/ }).click();
    await page.getByRole("button", { name: "接受修改", exact: true }).click();
    await expect
      .poll(() => readFileSync(join(workspace, chapter), "utf8"))
      .toBe(generated);
    await page.getByRole("button", { name: "写作", exact: true }).click();
    const recoveredEditor = page.getByRole("textbox", { name: "正文编辑器" });
    await recoveredEditor.fill("编辑器里尚未保存的稿件");
    await page.getByRole("button", { name: "导出作品", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("请先保存再导出");
    writeFileSync(join(workspace, chapter), "外部编辑器保存的正文", "utf8");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("正文已在其他地方改变");
    await expect(recoveredEditor).toContainText("编辑器里尚未保存的稿件");
    expect(readFileSync(join(workspace, chapter), "utf8")).toBe(
      "外部编辑器保存的正文",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "重新读取文件", exact: true })
      .click();
    await expect(recoveredEditor).toContainText("外部编辑器保存的正文");
    await recoveredEditor.fill("前文。选中段落。后文。");
    await recoveredEditor.press("Control+s");
    await expect
      .poll(() => readFileSync(join(workspace, chapter), "utf8"))
      .toBe("前文。选中段落。后文。");
    await recoveredEditor.press("Control+Home");
    for (let n = 0; n < 3; n++) await recoveredEditor.press("ArrowRight");
    for (let n = 0; n < 5; n++) await recoveredEditor.press("Shift+ArrowRight");
    await expect(
      page.getByText("仅修改选中段落", { exact: true }),
    ).toBeVisible();
    responseMode = "hold";
    const beforeInterruptedSelection = requests.length;
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("只重写选中的段落，其他文字不变。");
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect
      .poll(() => requests.length)
      .toBeGreaterThan(beforeInterruptedSelection);
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page
      .getByRole("button", {
        name: workspace.split(/[\\/]/u).at(-1)!,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "继续任务（将调用模型）" }),
    ).toBeVisible();
    expect(requests.length).toBe(beforeInterruptedSelection + 1);
    responseMode = "normal";
    await page.getByRole("button", { name: "继续任务（将调用模型）" }).click();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /有一份修改等待审阅/ }).click();
    await page.getByRole("button", { name: "接受修改", exact: true }).click();
    await expect
      .poll(() => readFileSync(join(workspace, chapter), "utf8"))
      .toBe(`前文。${generated}后文。`);
    const beforeReadOnly = readFileSync(join(workspace, chapter), "utf8");
    await page
      .getByRole("combobox", { name: "工作模式", exact: true })
      .selectOption("explore");
    await expect(page.getByLabel("只读讨论与审稿（不生成候选）")).toBeChecked();
    await expect(
      page.getByLabel("只读讨论与审稿（不生成候选）"),
    ).toBeDisabled();
    const conversationPanel = page.locator(".agent-conversation");
    await conversationPanel.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByRole("button", { name: /查看最新进展/ }).click();
    await expect
      .poll(() =>
        conversationPanel.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(2);
    await page
      .getByRole("combobox", { name: "创作技能", exact: true })
      .selectOption("continuity-review.v3");
    await expect(page.getByLabel("只读讨论与审稿（不生成候选）")).toBeChecked();
    await expect(
      page.getByLabel("只读讨论与审稿（不生成候选）"),
    ).toBeDisabled();
    await page.getByText("查看技能规则 · 连续性审稿", { exact: true }).click();
    await expect(
      page.locator(".skill-preview").filter({ hasText: "查看技能规则" }),
    ).toContainText("不得生成修改候选");
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("只读检查时间线，不要修改正文。");
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect(
      page.getByText("只读审稿完成：建议检查人物获知线索的时间。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toHaveCount(0);
    expect(readFileSync(join(workspace, chapter), "utf8")).toBe(beforeReadOnly);
    await page.getByText("本轮参考与用量", { exact: true }).click();
    await expect(
      page.getByText("本轮采用技能：连续性审稿", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "创作技能", exact: true })
      .selectOption("scene-plan.v1");
    await expect(
      page.getByText("本轮采用技能：连续性审稿", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("本轮创作计划", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText("准备修改候选", { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "创作技能", exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("combobox", { name: "工作模式", exact: true }),
    ).toHaveValue("coauthor");
    await expect(
      page.getByLabel("只读讨论与审稿（不生成候选）"),
    ).not.toBeChecked();
    const beforePresets = requests.length;
    await page
      .getByRole("button", { name: "继续当前章节", exact: true })
      .click();
    await expect(
      page.getByLabel("只读讨论与审稿（不生成候选）"),
    ).not.toBeChecked();
    await expect(page.getByRole("textbox", { name: "创作要求" })).toHaveValue(
      "阅读当前章节和创作约定，规划下一场景并生成正文候选。",
    );
    await page
      .getByRole("button", { name: "检查设定与故事连续性", exact: true })
      .click();
    await expect(page.getByLabel("只读讨论与审稿（不生成候选）")).toBeChecked();
    await page
      .getByRole("button", { name: "继续当前章节", exact: true })
      .click();
    await page
      .getByRole("button", { name: "梳理故事，从一个想法开始", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "创作技能", exact: true }),
    ).toHaveValue("scene-plan.v1");
    await expect(page.getByLabel("只读讨论与审稿（不生成候选）")).toBeChecked();
    await expect(page.getByRole("textbox", { name: "创作要求" })).toHaveValue(
      "先和我梳理故事设定，再规划前三章。暂不生成修改候选。",
    );
    expect(requests.length).toBe(beforePresets);
    await page.getByRole("button", { name: "任务历史", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索历史任务" })
      .fill("不存在的验收任务名");
    await expect(
      page.getByText("没有匹配的创作任务，试试清空搜索或切换状态。"),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "搜索历史任务" }).fill("");
    await page
      .getByRole("combobox", { name: "筛选任务状态" })
      .selectOption("completed");
    await expect(page.locator(".task-list button").first()).toBeVisible();
    await page.locator(".task-list button").first().click();
    await expect(
      page.getByRole("textbox", { name: "搜索历史任务" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "工作模式", exact: true }),
    ).toHaveValue("explore");
    await expect(
      page.getByRole("combobox", { name: "创作技能", exact: true }),
    ).toHaveValue("continuity-review.v3");
    await expect(page.getByLabel("只读讨论与审稿（不生成候选）")).toBeChecked();
    await expect(
      page.getByLabel("只读讨论与审稿（不生成候选）"),
    ).toBeDisabled();
    expect(requests.length).toBe(beforePresets);
    await page
      .getByRole("button", { name: "添加大纲或场景计划", exact: true })
      .click();
    await expect(page.getByLabel("作品内路径")).toHaveValue(
      "outline/章节计划.md",
    );
    await page.getByRole("button", { name: "创建文件", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "章节计划", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "正文编辑器" })
      .fill("第一场景：雨夜回到旧办公室。");
    await page.getByRole("textbox", { name: "正文编辑器" }).press("Control+s");
    await expect
      .poll(() => readFileSync(join(workspace, "outline/章节计划.md"), "utf8"))
      .toBe("第一场景：雨夜回到旧办公室。");
    await page.getByRole("button", { name: "新建文件", exact: true }).click();
    await expect(page.getByLabel("作品内路径")).toHaveValue(
      "manuscript/main/新章节.md",
    );
    await page
      .getByLabel("文件类型", { exact: true })
      .selectOption("character");
    await page.getByLabel("作品内路径").fill("canon/characters/验收人物.md");
    const beforeTemplate = requests.length;
    await page.getByRole("button", { name: "创建文件", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "正文编辑器" }),
    ).toContainText("尚不知道的信息");
    expect(
      readFileSync(join(workspace, "canon/characters/验收人物.md"), "utf8"),
    ).toContain("# 验收人物");
    expect(requests.length).toBe(beforeTemplate);
    await page.getByRole("button", { name: "新建文件", exact: true }).click();
    await expect(page.getByLabel("文件类型", { exact: true })).toHaveValue(
      "blank",
    );
    await page.getByLabel("作品内路径").fill("canon/characters/验收人物.md");
    const originalCard = readFileSync(
      join(workspace, "canon/characters/验收人物.md"),
      "utf8",
    );
    await page.getByRole("button", { name: "创建文件", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "新建作品文件" }).getByRole("alert"),
    ).toBeVisible();
    await expect(page.getByLabel("作品内路径")).toHaveValue(
      "canon/characters/验收人物.md",
    );
    expect(
      readFileSync(join(workspace, "canon/characters/验收人物.md"), "utf8"),
    ).toBe(originalCard);
    await page.getByLabel("文件类型", { exact: true }).selectOption("timeline");
    await page.getByLabel("作品内路径").fill("canon/timeline.yaml");
    await page.getByRole("button", { name: "创建文件", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "新建作品文件" }).getByRole("alert"),
    ).toContainText("Markdown");
    expect(existsSync(join(workspace, "canon/timeline.yaml"))).toBe(false);
    await page
      .getByRole("dialog", { name: "新建作品文件" })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await page
      .getByRole("combobox", { name: "创作技能", exact: true })
      .selectOption("");
    await page
      .getByRole("combobox", { name: "工作模式", exact: true })
      .selectOption("coauthor");
    await page.getByLabel("只读讨论与审稿（不生成候选）").uncheck();
    await page
      .getByRole("combobox", { name: "工作模式", exact: true })
      .selectOption("batch");
    if (
      !(await page
        .getByLabel("限定可生成候选的文件", { exact: true })
        .isVisible())
    )
      await page.locator("summary").filter({ hasText: "候选文件范围" }).click();
    const scoped = page.getByRole("checkbox", { name: /^候选范围 /u });
    for (let index = 0; index < (await scoped.count()); index++)
      await scoped.nth(index).uncheck();
    await page.getByLabel(`候选范围 ${chapter}`, { exact: true }).check();
    await page.getByLabel("候选范围 story.yaml", { exact: true }).check();
    await page.locator("summary").filter({ hasText: "候选文件范围" }).click();
    const originals = [chapter, "story.yaml"].map((path) =>
      readFileSync(join(workspace, path), "utf8"),
    );
    const beforeBatch = requests.length;
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("为这两个文件生成批量候选，等待我审阅。");
    page.once("dialog", (dialog) => {
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect(
      page.getByRole("button", { name: "发送创作要求" }),
    ).toBeEnabled();
    expect(requests.length).toBe(beforeBatch);
    await expect(
      page.getByRole("combobox", { name: "工作模式", exact: true }),
    ).toHaveValue("batch");
    let confirmation = "";
    page.once("dialog", (dialog) => {
      confirmation = dialog.message();
      void dialog.accept();
    });
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect
      .poll(async () => ({
        candidates: await page.locator(".proposal-card").count(),
        errors: await page.getByRole("alert").allTextContents(),
        issues: await page.locator(".task-issue").allTextContents(),
        requests: requests.length - beforeBatch,
        confirmation,
      }))
      .toMatchObject({ candidates: 2, errors: [], issues: [], requests: 3 });
    expect(confirmation).toContain("story.yaml");
    expect(confirmation).toContain("费用未知");
    expect(requests.length).toBe(beforeBatch + 3);
    expect(
      [chapter, "story.yaml"].map((path) =>
        readFileSync(join(workspace, path), "utf8"),
      ),
    ).toEqual(originals);
    // Switching away and back restores this batch's exact author-selected scope.
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await expect(page.getByLabel("限定可生成候选的文件")).not.toBeChecked();
    await page.getByRole("button", { name: "任务历史", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索历史任务" })
      .fill("为这两个文件生成批量候选");
    await page
      .getByRole("combobox", { name: "筛选任务状态" })
      .selectOption("all");
    await page.locator(".task-list button").first().click();
    await expect(
      page.getByLabel("候选范围 story.yaml", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel(`候选范围 ${chapter}`, { exact: true }),
    ).toBeChecked();
    expect(requests.length).toBe(beforeBatch + 3);
    const looseRoot = mkdtempSync(join(tmpdir(), "novel-loose-import-"));
    writeFileSync(join(looseRoot, "scene.md"), "# 原稿\n\n根目录里的故事。\n");
    writeFileSync(join(looseRoot, "world.yaml"), "rule: 雨不会停\n");
    mkdirSync(join(looseRoot, "volume", "chapters"), { recursive: true });
    writeFileSync(
      join(looseRoot, "volume", "chapters", "scene-2.md"),
      "# 第二场\n\n继续调查。\n",
    );
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, looseRoot);
    const beforeLooseImport = requests.length;
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await page
      .getByRole("dialog", { name: "作品管理", exact: true })
      .getByRole("button", { name: "新建 / 导入作品", exact: true })
      .click();
    const importDialog = page.getByRole("dialog", {
      name: "导入文件夹稿件",
      exact: true,
    });
    await expect(importDialog).toBeVisible();
    await expect(importDialog.getByRole("checkbox")).toHaveCount(3);
    await expect(importDialog).toContainText(
      "volume/chapters/scene-2.md → manuscript/imported/volume/chapters/scene-2.md",
    );
    expect(
      (await importDialog.getByRole("checkbox").first().boundingBox())!.width,
    ).toBeLessThan(24);
    await page.screenshot({ path: join(shotRoot, "import-preview.png") });
    expect(existsSync(join(looseRoot, "manuscript/imported/scene.md"))).toBe(
      false,
    );
    await importDialog
      .getByRole("button", { name: "复制所选稿件到作品", exact: true })
      .click();
    await expect(importDialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "volume / chapters / scene-2" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "正文编辑器" }),
    ).toContainText("根目录里的故事。");
    expect(
      readFileSync(join(looseRoot, "manuscript/imported/scene.md"), "utf8"),
    ).toBe(readFileSync(join(looseRoot, "scene.md"), "utf8"));
    expect(
      readFileSync(join(looseRoot, "canon/imported/world.yaml"), "utf8"),
    ).toBe(readFileSync(join(looseRoot, "world.yaml"), "utf8"));
    expect(
      readFileSync(
        join(looseRoot, "manuscript/imported/volume/chapters/scene-2.md"),
        "utf8",
      ),
    ).toBe(readFileSync(join(looseRoot, "volume/chapters/scene-2.md"), "utf8"));
    expect(requests.length).toBe(beforeLooseImport);
    await page.getByRole("button", { name: "作品管理", exact: true }).click();
    await page
      .getByRole("dialog", { name: "作品管理", exact: true })
      .getByRole("button", { name: "新建 / 导入作品", exact: true })
      .click();
    await expect(importDialog).toBeVisible();
    for (const checkbox of await importDialog.getByRole("checkbox").all())
      await expect(checkbox).toBeDisabled();
    await expect(
      importDialog.getByRole("button", {
        name: "复制所选稿件到作品",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(importDialog).toContainText("目标已存在，不会覆盖");
    await importDialog
      .getByRole("button", { name: "暂不导入", exact: true })
      .click();
    expect(requests.length).toBe(beforeLooseImport);
    // Accept from the preview, not from the manual-edit textarea: the bytes
    // published must remain the author's adjustments rather than the model draft.
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await page
      .getByRole("combobox", { name: "工作模式", exact: true })
      .selectOption("coauthor");
    await page
      .getByRole("combobox", { name: "创作技能", exact: true })
      .selectOption("");
    await page.getByLabel("只读讨论与审稿（不生成候选）").uncheck();
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("生成独立手动调整验收候选。");
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await page.getByRole("button", { name: /有一份修改等待审阅/ }).click();
    await page
      .getByRole("button", { name: "调整候选内容", exact: true })
      .click();
    const adjusted = generated + "作者保留的最终调整。";
    await page
      .getByRole("textbox", { name: "调整候选内容", exact: true })
      .fill(adjusted);
    await page.getByRole("button", { name: "查看对比", exact: true }).click();
    await page.getByRole("button", { name: "调整后接受", exact: true }).click();
    await expect
      .poll(() => readFileSync(join(looseRoot, chapter), "utf8"))
      .toBe(adjusted);
    responseMode = "hold";
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await page
      .getByRole("textbox", { name: "创作要求" })
      .fill("验证请求途中后台退出，不得自动重发。");
    const requestsBeforeHold = requests.length;
    await page.getByRole("button", { name: "发送创作要求" }).click();
    await expect
      .poll(() => requests.length)
      .toBeGreaterThan(requestsBeforeHold);
    await expect(
      page.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    const requestsBeforeCrash = requests.length;
    await application.evaluate(({ app }) => {
      const kernel = app
        .getAppMetrics()
        .find((metric) => metric.name === "Novel Agent Kernel");
      if (!kernel) throw new Error("Test Kernel process not found");
      process.kill(kernel.pid);
    });
    await expect(page.locator('.task-issue[role="alert"]')).toContainText(
      "执行进程已退出",
      {
        timeout: 10000,
      },
    );
    await expect(page.locator('.task-issue[role="alert"]')).toContainText(
      "不会自动重发",
    );
    expect(readFileSync(join(looseRoot, chapter), "utf8")).toBe(adjusted);
    expect(requests.length).toBe(requestsBeforeCrash);
    await expect(page.locator(".agent-status .pulsing")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "暂停", exact: true }),
    ).toHaveCount(0);
    await application.close();
    responseMode = "normal";
    application = await launch();
    page = await application.firstWindow();
    await page
      .getByRole("button", {
        name: looseRoot.split(/[\\/]/u).at(-1)!,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "继续任务（将调用模型）", exact: true }),
    ).toBeVisible();
    expect(requests.length).toBe(requestsBeforeCrash);
    expect(readFileSync(join(looseRoot, chapter), "utf8")).toBe(adjusted);
    await expect(
      page.getByText("验证请求途中后台退出，不得自动重发。", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "继续任务（将调用模型）", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /有一份修改等待审阅/ }),
    ).toBeVisible();
    expect(requests.length).toBeGreaterThan(requestsBeforeCrash);
    expect(readFileSync(join(looseRoot, chapter), "utf8")).toBe(adjusted);
  } finally {
    await application?.close();
    await new Promise<void>((resolveClose, reject) =>
      server.close((e) => (e ? reject(e) : resolveClose())),
    );
  }
});
