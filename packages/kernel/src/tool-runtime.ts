import type { PermissionBroker } from "./brokers.js";
import { readResource, type WorkspaceInfo } from "./workspace.js";

export class ToolRuntime {
  public constructor(private readonly permissions: PermissionBroker) {}

  public readManuscript(
    workspace: WorkspaceInfo,
    resourcePath: string,
  ): string {
    this.permissions.requireExact("story.manuscript.read");
    return readResource(workspace, resourcePath);
  }
}
