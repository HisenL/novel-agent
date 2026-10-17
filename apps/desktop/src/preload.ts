import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "./bridge.js";

const bridge: DesktopBridge = {
  request: (message) => ipcRenderer.invoke("novel:request", message),
  chooseWorkspace: (create) =>
    ipcRenderer.invoke("novel:choose-workspace", create),
  exportFile: (bytes) => ipcRenderer.invoke("novel:export", bytes),
  hostState: () => ipcRenderer.invoke("novel:host-state"),
  events: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      notification: { method: string; params: Parameters<typeof listener>[0] },
    ): void => {
      if (notification.method === "event") listener(notification.params);
    };
    ipcRenderer.on("novel:event", handler);
    return () => ipcRenderer.removeListener("novel:event", handler);
  },
};
contextBridge.exposeInMainWorld("novel", bridge);
