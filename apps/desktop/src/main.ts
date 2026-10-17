import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PROVIDER,
  validateProvider,
  type ProviderConfig,
} from "@novel-agent/kernel";
import { validateContract } from "@novel-agent/protocol";
import type { HostState } from "./bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const localState =
  process.env.NOVEL_AGENT_TEST_DIR ??
  resolve(desktopRoot, "../../.novel-agent/desktop");
mkdirSync(localState, { recursive: true });
app.setPath("userData", localState);
interface Settings {
  recent: string[];
  provider: ProviderConfig;
  encryptedKey?: string;
}
const settingsPath = join(localState, "settings.json");
let settings: Settings = existsSync(settingsPath)
  ? (JSON.parse(readFileSync(settingsPath, "utf8")) as Settings)
  : { recent: [], provider: DEFAULT_PROVIDER };
let window: BrowserWindow | undefined;
let worker: UtilityProcess | undefined;
let activeRequests = 0;
const pending = new Map<
  string,
  {
    resolve: (response: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const allowedRoots = new Set(settings.recent);
const entry = pathToFileURL(join(here, "renderer/index.html")).href;

function saveSettings(): void {
  const temp = `${settingsPath}.tmp`;
  writeFileSync(temp, JSON.stringify(settings, null, 2), "utf8");
  renameSync(temp, settingsPath);
}
function publicState(): HostState {
  return {
    kernelAvailable: worker !== undefined,
    recent: settings.recent,
    provider: settings.provider,
    hasKey: Boolean(settings.encryptedKey),
  };
}
function verifySender(event: IpcMainInvokeEvent): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== entry
  )
    throw new Error("请求来源无效。");
}
function sendWorker(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!worker) return Promise.reject(new Error("执行进程尚未就绪。"));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error("操作超时，请重试。"));
      },
      method === "provider.test"
        ? (settings.provider.timeoutSeconds + 15) * 1000
        : 30_000,
    );
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ jsonrpc: "2.0", id, method, params });
  });
}
function spawnKernel(): void {
  const nativeBinding = join(
    desktopRoot,
    ".native/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  );
  if (!existsSync(nativeBinding))
    throw new Error("桌面原生依赖尚未准备，请运行开发准备脚本。");
  worker = utilityProcess.fork(join(here, "worker.js"), [], {
    serviceName: "Novel Agent Kernel",
    env: {
      SystemRoot: process.env.SystemRoot ?? "",
      WINDIR: process.env.WINDIR ?? "",
      TEMP: process.env.TEMP ?? localState,
      TMP: process.env.TMP ?? localState,
      PATH: process.env.PATH ?? "",
      NOVEL_AGENT_SQLITE_BINDING: nativeBinding,
    },
    stdio: "pipe",
  });
  worker.on("message", (message: Record<string, unknown>) => {
    if (message.kind === "secret-request") {
      void (async () => {
        try {
          if (
            message.baseUrl !== settings.provider.baseUrl ||
            !settings.encryptedKey ||
            !(await safeStorage.isAsyncEncryptionAvailable())
          )
            throw new Error("Secret unavailable");
          const decrypted = await safeStorage.decryptStringAsync(
            Buffer.from(settings.encryptedKey, "base64"),
          );
          if (decrypted.shouldReEncrypt) {
            settings.encryptedKey = (
              await safeStorage.encryptStringAsync(decrypted.result)
            ).toString("base64");
            saveSettings();
          }
          worker?.postMessage({
            kind: "secret-result",
            id: message.id,
            value: decrypted.result,
          });
        } catch {
          worker?.postMessage({
            kind: "secret-result",
            id: message.id,
            error: "无法读取密钥，请重新保存。",
          });
        }
      })();
      return;
    }
    if (message.method === "event") {
      if (validateContract("json-rpc-message", message).valid)
        window?.webContents.send("novel:event", message);
      return;
    }
    const item = pending.get(String(message.id));
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(String(message.id));
    item.resolve(message);
  });
  worker.on("exit", () => {
    worker = undefined;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("执行进程已退出，请重新打开客户端。"));
    }
    pending.clear();
  });
}
async function initialize(): Promise<void> {
  spawnKernel();
  if (settings.encryptedKey && settings.provider.model)
    await sendWorker("provider.configure", { config: settings.provider });
  ipcMain.handle("novel:host-state", (event) => {
    verifySender(event);
    return publicState();
  });
  ipcMain.handle("novel:choose-workspace", async (event, create: unknown) => {
    verifySender(event);
    const result = await dialog.showOpenDialog(window!, {
      title: create === true ? "选择新建或导入作品的文件夹" : "打开作品文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    const root = result.filePaths[0];
    if (result.canceled || !root) return null;
    allowedRoots.add(resolve(root));
    return resolve(root);
  });
  ipcMain.handle("novel:export", async (event, bytes: unknown) => {
    verifySender(event);
    if (
      !Array.isArray(bytes) ||
      bytes.length > 32 * 1024 * 1024 ||
      bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
    )
      throw new Error("导出数据无效。");
    const target = await dialog.showSaveDialog(window!, {
      title: "导出作品",
      defaultPath: "小说作品.zip",
      filters: [{ name: "ZIP 作品文件", extensions: ["zip"] }],
    });
    if (target.canceled || !target.filePath) return null;
    writeFileSync(target.filePath, Buffer.from(bytes));
    return target.filePath;
  });
  ipcMain.handle("novel:request", async (event, message: unknown) => {
    verifySender(event);
    const request = message as {
      id?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (
      JSON.stringify(message).length > 2 * 1024 * 1024 ||
      !validateContract("json-rpc-message", message).valid ||
      typeof request.method !== "string" ||
      activeRequests >= 24
    )
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32600, message: "请求无效或过于频繁。" },
      };
    activeRequests++;
    try {
      const p = request.params ?? {};
      if (request.method === "provider.status")
        return { jsonrpc: "2.0", id: request.id, result: publicState() };
      if (request.method === "provider.configure") {
        const config = validateProvider(p.config);
        const credential =
          typeof p.credential === "string" ? p.credential.trim() : "";
        if (
          !credential &&
          (!settings.encryptedKey ||
            settings.provider.baseUrl !== config.baseUrl)
        )
          throw new Error("请为该服务填写密钥；切换地址时需要重新输入。");
        if (credential.length > 4096) throw new Error("密钥长度不符合要求。");
        let encryptedKey = settings.encryptedKey;
        if (credential) {
          if (!(await safeStorage.isAsyncEncryptionAvailable()))
            throw new Error("系统安全存储暂时不可用，未保存密钥。");
          encryptedKey = (
            await safeStorage.encryptStringAsync(credential)
          ).toString("base64");
        }
        const response = (await sendWorker("provider.configure", {
          config,
        })) as Record<string, unknown>;
        if (response.error) return { ...response, id: request.id };
        settings = {
          ...settings,
          provider: config,
          ...(encryptedKey ? { encryptedKey } : {}),
        };
        saveSettings();
        return { ...response, id: request.id, result: publicState() };
      }
      if (["workspace.open", "workspace.create"].includes(request.method)) {
        if (typeof p.root !== "string" || !allowedRoots.has(resolve(p.root)))
          throw new Error("请通过文件选择器打开作品目录。");
      }
      const response = (await sendWorker(request.method, p)) as Record<
        string,
        unknown
      >;
      if (
        !response.error &&
        ["workspace.open", "workspace.create"].includes(request.method)
      ) {
        settings.recent = [
          String(p.root),
          ...settings.recent.filter((r) => r !== p.root),
        ].slice(0, 8);
        saveSettings();
      }
      return { ...response, id: request.id };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "操作未完成。",
        },
      };
    } finally {
      activeRequests--;
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const rendererPrefix = pathToFileURL(join(here, "renderer")).href + "/";
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel:
        !details.url.startsWith(rendererPrefix) &&
        !details.url.startsWith("devtools:"),
    }),
  );
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: "Novel Agent · 小说创作工作台",
    backgroundColor: "#f7f7f5",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window!, {
      type: "warning",
      buttons: ["返回保存", "放弃未保存内容并关闭"],
      defaultId: 0,
      cancelId: 0,
      title: "有尚未保存的修改",
      message: "关闭会丢失未保存的正文或尚未提交的候选手动调整。",
      detail: "已经保存的正文、候选和任务历史不会丢失。",
    });
    if (choice === 1) event.preventDefault();
  });
  await window.loadFile(join(here, "renderer/index.html"));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(initialize)
    .catch((error) => {
      dialog.showErrorBox(
        "Novel Agent 启动失败",
        error instanceof Error ? error.message : "启动失败，请检查开发环境。",
      );
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    worker?.kill();
  });
}
