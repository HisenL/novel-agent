#!/usr/bin/env node
import { NovelAgentKernel, type SessionView } from "@novel-agent/kernel";

function usage(): never {
  throw new Error(
    [
      "用法:",
      "  pnpm na init <workspace>",
      '  pnpm na start <workspace> --task "任务" [--resource manuscript/main/chapter-1.md]',
      "  pnpm na status <workspace> <session-id>",
      "  pnpm na resume <workspace> <session-id>",
      "  pnpm na approve <workspace> <session-id>",
      "  pnpm na reject <workspace> <session-id>",
    ].join("\n"),
  );
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function present(view: SessionView): object {
  return {
    sessionId: view.sessionId,
    status: view.status,
    task: view.task,
    resourcePath: view.resourcePath,
    candidatePath: view.candidatePath,
    changeSetId: view.changeSet?.changeSetId,
    revisionId: view.revision?.revisionId,
    eventCount: view.events.length,
  };
}

async function main(): Promise<void> {
  const [command, workspace, sessionId, ...rest] = process.argv.slice(2);
  if (command === undefined || workspace === undefined) usage();
  if (command === "init") {
    const info = NovelAgentKernel.initialize(workspace);
    console.log(JSON.stringify({ status: "initialized", ...info }, null, 2));
    return;
  }
  const kernel = new NovelAgentKernel(workspace);
  try {
    let view: SessionView;
    switch (command) {
      case "start": {
        const all = [sessionId, ...rest].filter(
          (value): value is string => value !== undefined,
        );
        const task = option(all, "--task");
        if (task === undefined) usage();
        const resourcePath = option(all, "--resource");
        view = await kernel.startTask({
          task,
          ...(resourcePath === undefined ? {} : { resourcePath }),
        });
        break;
      }
      case "status":
        if (sessionId === undefined) usage();
        view = kernel.getSession(sessionId);
        break;
      case "resume":
        if (sessionId === undefined) usage();
        view = kernel.resume(sessionId);
        break;
      case "approve":
        if (sessionId === undefined) usage();
        view = kernel.approve(sessionId);
        break;
      case "reject":
        if (sessionId === undefined) usage();
        view = kernel.reject(sessionId);
        break;
      default:
        usage();
    }
    console.log(JSON.stringify(present(view), null, 2));
  } finally {
    kernel.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
