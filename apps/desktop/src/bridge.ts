import type { EventEnvelope } from "@novel-agent/protocol";
import type { ProviderConfig } from "@novel-agent/kernel";

export interface HostState {
  kernelAvailable: boolean;
  recent: string[];
  provider: ProviderConfig;
  hasKey: boolean;
}
export interface DesktopBridge {
  request(message: unknown): Promise<{
    jsonrpc: "2.0";
    id: unknown;
    result?: unknown;
    error?: { code: number; message: string };
  }>;
  chooseWorkspace(create: boolean): Promise<string | null>;
  exportFile(bytes: number[]): Promise<string | null>;
  hostState(): Promise<HostState>;
  events(listener: (event: EventEnvelope) => void): () => void;
}
declare global {
  interface Window {
    novel: DesktopBridge;
  }
}
