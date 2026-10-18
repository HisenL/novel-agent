import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  FileText,
  FolderOpen,
  History,
  Plus,
  Send,
  Settings,
  Sparkles,
  Square,
  Check,
  X,
  Download,
  ArrowLeft,
  ListChecks,
  RefreshCw,
  Feather,
  Users,
  PanelLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Undo2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { diffLines } from "diff";
import type {
  AuthoringSession,
  DocumentContent,
  DocumentFile,
  ProposalView,
  ProviderConfig,
  SelectionScope,
  CandidateScopeEntry,
  RootImportEntry,
} from "@novel-agent/kernel";
import type { Revision } from "@novel-agent/protocol";
import type { HostState } from "../bridge.js";
import { Editor } from "./Editor.js";
import { QuickStartGuide } from "./QuickStartGuide.js";
import { fileDisplayTitle } from "./file-display-title.js";
import { applySavedDocument } from "./save-result.js";
import { validateResumeSkill } from "./resume-skill.js";
import { skillSelection } from "./skill-selection.js";
import { MessageText } from "./MessageText.js";
import { proposalTitle } from "./proposal-title.js";
import { taskCandidateScope, taskControls } from "./task-controls.js";
import { LatestRequest, SelectedRequest } from "./latest-request.js";
import {
  resolveAuthoringMode,
  type AuthoringMode,
} from "@novel-agent/kernel/authoring-mode";
import { costSummary, latestTurnEvents, turnUsage } from "./usage.js";
import { StorySettingsDialog } from "./StorySettingsDialog.js";
import { readStorySettings } from "./story-settings.js";
import { proposalCandidateScope, proposalSelection } from "./proposal-scope.js";
import { filterTaskHistory } from "./task-history.js";
import {
  BUILTIN_SKILLS,
  getBuiltinSkill,
} from "@novel-agent/kernel/builtin-skills";
import {
  documentTemplates,
  templateContent,
  type DocumentTemplate,
} from "./document-templates.js";

async function rpc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await window.novel.request({
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method,
    params,
  });
  if (response.error) throw new Error(response.error.message);
  return response.result as T;
}
type SessionItem = Pick<
  AuthoringSession,
  "id" | "title" | "status" | "updatedAt"
>;
const statusLabel: Record<string, string> = {
  idle: "尚未开始",
  running: "正在创作",
  paused: "已暂停",
  awaiting_approval: "等待审阅",
  completed: "本轮完成",
  failed: "需要处理",
};
const labels: Record<string, string> = {
  list_documents: "查看作品目录",
  read_document: "阅读作品资料",
  search_story: "检索故事线索",
  update_plan: "更新创作计划",
  propose_document: "准备修改候选",
};
const basename = (path: string) => path.split(/[\\/]/u).at(-1) ?? path;

export function App() {
  const [host, setHost] = useState<HostState | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [document, setDocument] = useState<DocumentContent | null>(null);
  const [content, setContent] = useState("");
  const [session, setSession] = useState<AuthoringSession | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [task, setTask] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [mode, setMode] = useState<AuthoringMode>("coauthor");
  const [limitCandidates, setLimitCandidates] = useState(false);
  const [candidatePaths, setCandidatePaths] = useState<string[]>([]);
  const [skillId, setSkillId] = useState("");
  const { selected: selectedSkill, historical: historicalSkill } =
    skillSelection(skillId);
  const [selection, setSelection] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const sendingTask = useRef(false);
  const openingWorkspace = useRef(false);
  const savingDocument = useRef(false);
  const documentReads = useRef(new LatestRequest());
  const sessionReads = useRef(new SelectedRequest());
  const sessionListReads = useRef(new LatestRequest());
  const conversation = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(
    () => localStorage.getItem("novel-agent:onboarding-v1") !== "done",
  );
  const [uninitializedRoot, setUninitializedRoot] = useState<string | null>(
    null,
  );
  const [showTasks, setShowTasks] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    entries: RootImportEntry[];
    warnings: string[];
  } | null>(null);
  const [selectedImports, setSelectedImports] = useState<string[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("all");
  useEffect(() => {
    setHistoryQuery("");
    setHistoryStatus("all");
  }, [root]);
  const [showProject, setShowProject] = useState(false);
  const [storySettings, setStorySettings] = useState<DocumentContent | null>(
    null,
  );
  const [view, setView] = useState<"editor" | "diff" | "history">("editor");
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [editCandidate, setEditCandidate] = useState(false);
  const [candidateText, setCandidateText] = useState("");
  const current = useRef({ root, sessionId: session?.id });
  current.current = { root, sessionId: session?.id };
  const dirty = document !== null && content !== document.content;
  const candidateDirty =
    proposal?.status === "pending" && candidateText !== proposal.after;
  const [kernelAvailable, setKernelAvailable] = useState(true);
  const running = kernelAvailable && session?.status === "running";
  const [newFile, setNewFile] = useState(false);
  const [newFileError, setNewFileError] = useState("");
  const creatingFile = useRef(false);
  const [newPath, setNewPath] = useState("manuscript/main/第二章.md");
  const [newTemplate, setNewTemplate] = useState<DocumentTemplate>("blank");
  useEffect(() => {
    setNewFileError("");
  }, [newFile, newPath, newTemplate]);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "操作未完成，请重试。");
  }, []);
  const loadSessions = useCallback(async () => {
    if (openingWorkspace.current) return;
    const result = await sessionListReads.current.read(() =>
      rpc<SessionItem[]>("session.list"),
    );
    if (result) setSessions(result.value);
  }, []);
  const loadSession = useCallback(async (id: string, refresh = false) => {
    if (refresh && openingWorkspace.current) return;
    const result = await sessionReads.current.read(
      id,
      () => rpc<AuthoringSession>("session.get", { sessionId: id }),
      refresh,
    );
    if (result) {
      setSession(result.value);
      if (!refresh) {
        const controls = taskControls(result.value.events);
        setMode(controls.mode);
        setReadOnly(controls.readOnly);
        setSkillId(controls.skillId);
        const scope = taskCandidateScope(result.value.events);
        setLimitCandidates(scope.limited);
        setCandidatePaths(scope.paths);
        // An editor selection belongs to the previous task/document, not this history item.
        setSelection(null);
      }
    }
  }, []);
  const openDocument = useCallback(
    async (path: string) => {
      if (openingWorkspace.current) return false;
      if (
        dirty &&
        !window.confirm("当前正文尚未保存，是否放弃这些编辑并读取所选文件？")
      )
        return false;
      const result = await documentReads.current.read(() =>
        rpc<DocumentContent>("workspace.read", { path }),
      );
      if (!result) return false;
      const doc = result.value;
      setDocument(doc);
      setContent(doc.content);
      setSelection(null);
      setView("editor");
      if (root) localStorage.setItem(`focus:${root}`, path);
      return true;
    },
    [dirty, root],
  );
  useEffect(() => {
    void window.novel.hostState().then(setHost).catch(report);
  }, [report]);
  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async (): Promise<void> => {
      if (checking) return;
      checking = true;
      try {
        const state = await window.novel.hostState();
        if (active) setKernelAvailable(state.kernelAvailable);
      } catch {
        // An observation failure alone does not prove that the Kernel exited.
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent): void => {
      if (dirty || candidateDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, candidateDirty]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remove = window.novel.events((event) => {
      if (!current.current.root) return;
      if (event.streamId === current.current.sessionId) {
        setSession((previous) =>
          previous?.id === event.streamId
            ? {
                ...previous,
                events: [
                  ...previous.events.filter((e) => e.eventId !== event.eventId),
                  event,
                ],
              }
            : previous,
        );
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const id = current.current.sessionId;
        if (id) void loadSession(id, true).catch(report);
        void loadSessions().catch(report);
      }, 180);
    });
    return () => {
      remove();
      if (timer) clearTimeout(timer);
    };
  }, [loadSession, loadSessions, report]);

  const openWorkspace = async (
    create: boolean,
    knownRoot?: string,
    importFiles?: { source: string; sourceHash: string }[],
  ): Promise<void> => {
    if (openingWorkspace.current) return;
    if (candidateDirty) {
      setError(
        "候选中有尚未提交的手动调整，请先返回修改对比处理，再切换作品。",
      );
      return;
    }
    if (running) {
      setError("请先暂停当前任务，等待暂停完成后再切换作品。");
      return;
    }
    if (dirty && !window.confirm("正文尚未保存，是否放弃编辑并切换作品？"))
      return;
    setError("");
    openingWorkspace.current = true;
    documentReads.current.invalidate();
    setBusy(true);
    let chosenRoot: string | undefined;
    try {
      const path = knownRoot ?? (await window.novel.chooseWorkspace(create));
      if (!path) return;
      sessionReads.current.reset();
      sessionListReads.current.invalidate();
      chosenRoot = path;
      setSwitchingWorkspace(true);
      setUninitializedRoot(null);
      const result = await rpc<{
        root: string;
        files: DocumentFile[];
        importPreview?: { entries: RootImportEntry[]; warnings: string[] };
        imports?: { imported: string[]; skipped: string[] };
      }>(create ? "workspace.create" : "workspace.open", {
        root: path,
        ...(importFiles ? { importFiles } : {}),
      });
      setRoot(result.root);
      setShowProject(false);
      setNotice("");
      setImportPreview(
        result.importPreview &&
          (result.importPreview.entries.length ||
            result.importPreview.warnings.length)
          ? result.importPreview
          : null,
      );
      setSelectedImports(
        result.importPreview?.entries
          .filter((entry) => !entry.targetExists)
          .map((entry) => entry.source) ?? [],
      );
      if (result.imports)
        setNotice(
          `已复制 ${result.imports.imported.length} 个文件，原文件保留。${result.imports.skipped.join(" ")}`,
        );
      setTask("");
      setSkillId("");
      setReadOnly(false);
      setMode("coauthor");
      setLimitCandidates(false);
      setCandidatePaths([]);
      setRevisions([]);
      setFiles(result.files);
      setSession(null);
      setSessions([]);
      setProposal(null);
      setSelection(null);
      setDocument(null);
      setContent("");
      setView("editor");
      const focus = localStorage.getItem(`focus:${result.root}`);
      const first =
        result.files.find((f) => f.path === result.imports?.imported[0]) ??
        result.files.find((f) => f.path === focus) ??
        result.files.find((f) => f.kind === "manuscript") ??
        result.files[0];
      if (first) {
        const doc = await rpc<DocumentContent>("workspace.read", {
          path: first.path,
        });
        setDocument(doc);
        setContent(doc.content);
      } else {
        setDocument(null);
        setContent("");
      }
      const list = await rpc<SessionItem[]>("session.list");
      setSessions(list);
      const last = list.find((s) => !s.title.startsWith("手动保存"));
      if (last) await loadSession(last.id);
      setHost(await window.novel.hostState());
    } catch (cause) {
      sessionReads.current.reset(current.current.sessionId ?? null);
      if (
        !create &&
        chosenRoot &&
        cause instanceof Error &&
        cause.message.startsWith("此文件夹还不是作品")
      ) {
        setUninitializedRoot(chosenRoot);
        setShowProject(true);
      }
      report(cause);
    } finally {
      openingWorkspace.current = false;
      setSwitchingWorkspace(false);
      setBusy(false);
    }
  };
  const save = async (snapshot = content): Promise<void> => {
    if (!document || savingDocument.current || openingWorkspace.current) return;
    savingDocument.current = true;
    setError("");
    try {
      const saved = await rpc<DocumentContent>("workspace.save", {
        path: document.path,
        content: snapshot,
        baseHash: document.hash,
      });
      setDocument((active) => applySavedDocument(active, document, saved));
      if (current.current.root === root && !openingWorkspace.current) {
        setNotice(`${document.path} 已保存，并记录新版本。`);
        await loadSessions();
      }
    } catch (cause) {
      if (current.current.root === root && !openingWorkspace.current)
        report(cause);
    } finally {
      savingDocument.current = false;
    }
  };
  const beginTask = async (
    instruction = task,
    resume = false,
  ): Promise<void> => {
    if (sendingTask.current || busy || running || !kernelAvailable) return;
    if (!instruction.trim() || !root) return;
    if (!host?.hasKey) {
      setShowSettings(true);
      return;
    }
    if (dirty) {
      setError("请先保存正文，再让智能体参考当前内容。");
      return;
    }
    setError("");
    setBusy(true);
    sendingTask.current = true;
    let startedSessionId: string | undefined;
    try {
      const next =
        session ??
        (await rpc<AuthoringSession>("session.create", {
          title: instruction.slice(0, 40),
        }));
      current.current.sessionId = next.id;
      startedSessionId = next.id;
      sessionReads.current.reset(next.id);
      setSession({ ...next, status: "running" });
      const previousContext = [...next.events]
        .reverse()
        .find((event) => event.type === "context.compiled")?.payload as
        | { selection?: SelectionScope | null; skill?: unknown }
        | undefined;
      const taskSelection = resume
        ? (previousContext?.selection ?? undefined)
        : selection && document?.hash
          ? { ...selection, path: document.path, baseHash: document.hash }
          : undefined;
      const taskReadOnly = resume
        ? (
            [...next.events]
              .reverse()
              .find((event) => event.type === "turn.started")?.payload as
              | { readOnly?: boolean }
              | undefined
          )?.readOnly === true
        : readOnly;
      const taskSkillId = resume
        ? ((
            [...next.events]
              .reverse()
              .find((event) => event.type === "turn.started")?.payload as
              | { skillId?: string }
              | undefined
          )?.skillId ?? "")
        : skillId;
      if (resume) validateResumeSkill(taskSkillId, previousContext?.skill);
      if (resume) setReadOnly(taskReadOnly);
      if (resume) setSkillId(taskSkillId);
      const taskMode = resume
        ? resolveAuthoringMode(
            (
              [...next.events]
                .reverse()
                .find((event) => event.type === "turn.started")?.payload as
                | { mode?: unknown }
                | undefined
            )?.mode,
          )
        : mode;
      if (resume) setMode(taskMode);
      let taskScope: CandidateScopeEntry[] | undefined;
      if (resume) {
        taskScope = (
          [...next.events]
            .reverse()
            .find((event) => event.type === "turn.started")?.payload as
            | { candidateScope?: CandidateScopeEntry[] }
            | undefined
        )?.candidateScope;
        setLimitCandidates(taskScope !== undefined);
        setCandidatePaths(taskScope?.map((entry) => entry.path) ?? []);
      } else if (limitCandidates) {
        if (candidatePaths.length === 0)
          throw new Error("请至少选择一个候选文件。");
        taskScope = await Promise.all(
          candidatePaths.map(async (path) => {
            const doc = await rpc<DocumentContent>("workspace.read", { path });
            if (!doc.hash)
              throw new Error("候选范围中的文件不存在，请重新选择。");
            return { path, baseHash: doc.hash };
          }),
        );
      }
      if (
        taskSelection &&
        taskScope &&
        !taskScope.some((entry) => entry.path === taskSelection.path)
      )
        throw new Error("选区文件不在候选范围内，请调整范围或清除选区。");
      if (taskMode === "batch") {
        if (!taskScope?.length) throw new Error("请先选择批量候选范围。");
        if (
          taskReadOnly ||
          taskSelection ||
          getBuiltinSkill(taskSkillId)?.readOnly
        )
          throw new Error("批量候选不能同时启用只读、审稿技能或局部选区。");
        if (
          !window.confirm(
            `启动批量候选？\n文件：\n${taskScope.map((entry) => entry.path).join("\n")}\n\n最多 ${host.provider.maxSteps} 次模型调用，每次最多 ${host.provider.maxOutputTokens} 输出 Token。输入用量及费用未知，不是总费用保证。\n遇到文件冲突、模型要求作者决策、服务错误或调用上限时停止，已有候选保留。所有候选仍须逐项接受。`,
          )
        ) {
          await loadSession(next.id, true);
          return;
        }
      }
      await rpc("turn.start", {
        ...(taskScope ? { candidateScope: taskScope } : {}),
        mode: taskMode,
        readOnly: taskReadOnly,
        sessionId: next.id,
        task: instruction,
        focusPath: taskSelection?.path ?? document?.path,
        ...(taskSkillId ? { skillId: taskSkillId } : {}),
        ...(taskSelection ? { selection: taskSelection } : {}),
      });
      setTask("");
      await loadSession(next.id, true);
      await loadSessions();
    } catch (cause) {
      report(cause);
      if (startedSessionId)
        await loadSession(startedSessionId, true).catch(() => {});
    } finally {
      sendingTask.current = false;
      setBusy(false);
    }
  };
  const review = (p: ProposalView): void => {
    if (candidateDirty) {
      if (p.id === proposal?.id) {
        setView("diff");
        return;
      }
      setError("候选中有尚未提交的手动调整，请先处理，再打开其他候选。");
      return;
    }
    setProposal(p);
    setCandidateText(p.after);
    setEditCandidate(false);
    setView("diff");
  };
  const prepareRedo = async (): Promise<void> => {
    if (!proposal || running || busy) return;
    if (candidateDirty) {
      setError("候选中有手动调整，请先处理这些调整，再准备重做要求。");
      return;
    }
    if (dirty) {
      setError("请先保存正文，再准备重做要求。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const source = await rpc<AuthoringSession>("session.get", {
        sessionId: proposal.sessionId,
      });
      const doc = await rpc<DocumentContent>("workspace.read", {
        path: proposal.path,
      });
      const scope = proposalSelection(source, proposal);
      const candidateScope = proposalCandidateScope(source, proposal);
      if (scope && scope.baseHash !== doc.hash)
        throw new Error(
          "原选区对应的正文已改变。请打开最新正文重新选择范围，再提出修改要求。",
        );
      sessionReads.current.reset(source.id);
      setSession(source);
      setLimitCandidates(candidateScope.limited);
      setCandidatePaths(candidateScope.paths);
      setDocument(doc);
      setContent(doc.content);
      setSelection(scope ? { from: scope.from, to: scope.to } : null);
      setMode("coauthor");
      setReadOnly(false);
      setSkillId("");
      setTask(
        `请重新阅读 ${proposal.path}，根据我的意见重做候选 ${proposal.id}。只生成新的候选，不发布内容。${scope ? "仍然只改原选区。" : ""}\n我的修改意见：`,
      );
      setView("editor");
      setNotice(
        "已准备重做要求，请补充意见后发送。原候选保持原状态，不会自动接受或拒绝。",
      );
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  };
  const resolveProposal = async (accept: boolean): Promise<void> => {
    if (accept && dirty) {
      setError(
        "正文有未保存的修改，请先返回写作页保存，再审阅候选；有冲突时不会覆盖。",
      );
      return;
    }
    if (!proposal) return;
    setError("");
    setBusy(true);
    try {
      let id = proposal.id;
      if (accept && candidateDirty) {
        const revised = await rpc<ProposalView>("proposal.revise", {
          sessionId: proposal.sessionId,
          proposalId: id,
          content: candidateText,
        });
        id = revised.id;
      }
      await rpc(accept ? "proposal.accept" : "proposal.reject", {
        sessionId: proposal.sessionId,
        proposalId: id,
      });
      setProposal(
        await rpc<ProposalView>("proposal.get", {
          sessionId: proposal.sessionId,
          proposalId: id,
        }),
      );
      await loadSession(proposal.sessionId);
      setFiles(await rpc<DocumentFile[]>("workspace.list"));
      if (accept) {
        const doc = await rpc<DocumentContent>("workspace.read", {
          path: proposal.path,
        });
        setDocument(doc);
        setContent(doc.content);
        setSelection(null);
        setNotice("修改已接受，已保存一个新版本。");
      } else setNotice("已拒绝，正式正文保持不变。");
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  };
  const showHistory = async (): Promise<void> => {
    try {
      setRevisions(await rpc<Revision[]>("revision.list"));
      setView("history");
    } catch (cause) {
      report(cause);
    }
  };
  const undo = async (id: string): Promise<void> => {
    try {
      const p = await rpc<ProposalView>("revision.undo", { revisionId: id });
      await loadSession(p.sessionId);
      review(p);
      setNotice("已生成撤销候选，请检查并接受。");
    } catch (cause) {
      report(cause);
    }
  };
  const exportStory = async (): Promise<void> => {
    if (dirty) {
      setError(
        "正文尚未保存，请先保存再导出。导出只包含已保存的正文和设定，不包含待审候选。",
      );
      return;
    }
    try {
      const bytes = await rpc<number[]>("workspace.export");
      const target = await window.novel.exportFile(bytes);
      if (target)
        setNotice(
          `作品已导出到 ${target}。仅含已保存正文和设定，不含任务历史、待审候选或密钥。解压后可用“新建 / 导入作品”继续写作。`,
        );
    } catch (cause) {
      report(cause);
    }
  };
  const createFile = async (): Promise<void> => {
    if (creatingFile.current) return;
    if (dirty) {
      setNewFileError(
        "当前正文尚未保存。请先记下新文件路径，关闭此窗口并保存正文，再创建文件。",
      );
      return;
    }
    creatingFile.current = true;
    setBusy(true);
    setNewFileError("");
    try {
      const doc = await rpc<DocumentContent>("workspace.save", {
        path: newPath,
        content: templateContent(newTemplate, newPath),
        baseHash: null,
      });
      setDocument(doc);
      setContent(doc.content);
      setSelection(null);
      setFiles(await rpc<DocumentFile[]>("workspace.list"));
      setNewFile(false);
      setView("editor");
    } catch (cause) {
      setNewFileError(
        cause instanceof Error
          ? cause.message
          : "文件创建失败，请检查路径后重试。",
      );
    } finally {
      creatingFile.current = false;
      setBusy(false);
    }
  };
  const recentEvents = latestTurnEvents(session?.events ?? []);
  const plan = [...recentEvents]
    .reverse()
    .find((e) => e.type === "plan.updated")?.payload as
    | { steps: string[] }
    | undefined;
  const messages =
    session?.events.filter((e) => e.type === "message.created") ?? [];
  const usage = turnUsage(session?.events ?? []);
  const lastIssue = [...recentEvents]
    .reverse()
    .find((e) =>
      ["turn.failed", "turn.interrupted", "budget.paused"].includes(e.type),
    )?.payload as { message: string } | undefined;
  const modelEvents = recentEvents.slice(
    recentEvents.findLastIndex((e) => e.type === "model.started") + 1,
  );
  const streaming = modelEvents.some((e) => e.type === "model.completed")
    ? ""
    : modelEvents
        .filter((e) => e.type === "model.text")
        .map((e) => (e.payload as { text: string }).text)
        .join("");
  const pendingProposals =
    session?.proposals.filter((p) => p.status === "pending") ?? [];
  const matchingTasks = filterTaskHistory(
    sessions,
    historyQuery,
    historyStatus,
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Feather size={19} />
          </span>
          <strong>Novel Agent</strong>
          <span className="dev-label">创作工作台 · 早期版本</span>
        </div>
        <div className="top-actions">
          <button className="text-button" onClick={() => setShowGuide(true)}>
            使用指南
          </button>
          <span className="local-badge">
            <span className="dot" />
            本地工作区
          </span>
          <button
            className="icon-button"
            title="模型设置"
            aria-label="模型设置"
            onClick={() => setShowSettings(true)}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>
      {showGuide && (
        <QuickStartGuide
          onClose={() => {
            localStorage.setItem("novel-agent:onboarding-v1", "done");
            setShowGuide(false);
          }}
        />
      )}
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-title">
            <BookOpen size={17} />
            <strong>{root ? basename(root) : "我的作品"}</strong>
            <button
              className="icon-button"
              title="打开作品"
              aria-label="打开作品"
              onClick={() => void openWorkspace(false)}
            >
              <FolderOpen size={17} />
            </button>
          </div>
          <div className="sidebar-scroll">
            {!root ? (
              <div className="empty-tree">
                <p>
                  让每个故事，
                  <br />
                  都有自己的空间。
                </p>
                <button
                  className="secondary full"
                  disabled={busy}
                  onClick={() => void openWorkspace(true)}
                >
                  <Plus size={16} />
                  新建 / 导入作品
                </button>
              </div>
            ) : (
              <>
                <div className="group-heading">
                  创作手稿
                  <button
                    className="icon-button"
                    title="新建文件"
                    aria-label="新建文件"
                    onClick={() => {
                      setNewPath("manuscript/main/新章节.md");
                      setNewTemplate("blank");
                      setNewFile(true);
                    }}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {files
                  .filter((f) => f.kind === "manuscript")
                  .map((file) => (
                    <button
                      className={`tree-item ${document?.path === file.path ? "selected" : ""}`}
                      key={file.path}
                      onClick={() => void openDocument(file.path).catch(report)}
                      title={file.path}
                    >
                      <FileText size={16} />
                      <span>{fileDisplayTitle(file)}</span>
                    </button>
                  ))}
                <div className="group-heading">
                  大纲与场景计划
                  <button
                    className="icon-button"
                    title="添加大纲或场景计划"
                    aria-label="添加大纲或场景计划"
                    onClick={() => {
                      setNewPath("outline/章节计划.md");
                      setNewTemplate("scene");
                      setNewFile(true);
                    }}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {files
                  .filter((f) => f.kind === "outline")
                  .map((file) => (
                    <button
                      className={`tree-item ${document?.path === file.path ? "selected" : ""}`}
                      key={file.path}
                      onClick={() => void openDocument(file.path).catch(report)}
                      title={file.path}
                    >
                      <ListChecks size={16} />
                      <span>{fileDisplayTitle(file)}</span>
                    </button>
                  ))}
                <div className="group-heading">故事档案</div>
                {files
                  .filter((f) => f.kind === "canon" || f.kind === "rules")
                  .map((file) => (
                    <button
                      className={`tree-item ${document?.path === file.path ? "selected" : ""}`}
                      key={file.path}
                      onClick={() => void openDocument(file.path).catch(report)}
                      title={file.path}
                    >
                      {file.kind === "canon" ? (
                        <Users size={16} />
                      ) : (
                        <ListChecks size={16} />
                      )}
                      <span>{fileDisplayTitle(file)}</span>
                    </button>
                  ))}
                <button
                  className="tree-item subtle"
                  onClick={() => {
                    setNewPath("canon/characters/主角.md");
                    setNewTemplate("character");
                    setNewFile(true);
                  }}
                >
                  <Plus size={15} />
                  添加人物或设定
                </button>
              </>
            )}
            {host?.recent.length ? (
              <>
                <div className="group-heading">最近作品</div>
                {host.recent.map((path) => (
                  <button
                    className="tree-item"
                    key={path}
                    title={path}
                    onClick={() => void openWorkspace(false, path)}
                  >
                    <FolderOpen size={15} />
                    <span>{basename(path)}</span>
                  </button>
                ))}
              </>
            ) : null}
          </div>
          <div className="sidebar-bottom">
            <button className="tree-item" onClick={() => setShowProject(true)}>
              <Settings size={16} />
              作品管理
            </button>
            <button
              className="tree-item"
              disabled={!root}
              onClick={() => void exportStory()}
            >
              <Download size={16} />
              导出作品
            </button>
            <button
              className="tree-item"
              onClick={() => void openWorkspace(true)}
            >
              <Plus size={16} />
              新建 / 导入作品
            </button>
          </div>
        </aside>
        <main className="writing-pane">
          <div className="document-bar">
            <div className="breadcrumb">
              <PanelLeft size={16} />
              <span>{root ? basename(root) : "欢迎"}</span>
              <ChevronRight size={13} />
              <strong>
                {document ? basename(document.path) : "开始你的故事"}
              </strong>
              {dirty && <span className="unsaved">未保存</span>}
            </div>
            {document && (
              <button
                className="icon-button"
                title="重新读取磁盘上的文件；未保存修改会先询问"
                aria-label="重新读取文件"
                onClick={() =>
                  void openDocument(document.path)
                    .then((loaded) => {
                      if (loaded) setError("");
                    })
                    .catch(report)
                }
              >
                <RefreshCw size={15} />
              </button>
            )}
            {document && (
              <button
                className="save-button"
                disabled={!dirty || switchingWorkspace}
                onClick={() => void save()}
              >
                <Check size={15} />
                {dirty ? "保存修改" : "已保存"}
              </button>
            )}
          </div>
          {root && (
            <div className="editor-tabs">
              <button
                className={view === "editor" ? "active" : ""}
                onClick={() => setView("editor")}
              >
                <FileText size={15} />
                写作
              </button>
              <button
                className={view === "diff" ? "active" : ""}
                disabled={!proposal}
                onClick={() => setView("diff")}
              >
                <SlidersHorizontal size={15} />
                修改对比
              </button>
              <button
                className={view === "history" ? "active" : ""}
                onClick={() => void showHistory()}
              >
                <History size={15} />
                版本历史
              </button>
            </div>
          )}
          {(error || notice) && (
            <div
              role={error ? "alert" : "status"}
              className={`banner ${error ? "error" : "success"}`}
            >
              {error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              <span>{error || notice}</span>
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {!root ? (
            <div className="welcome">
              <div className="welcome-eyebrow">
                <Feather size={16} />
                你的小说创作搭档
              </div>
              <h1>
                把一个念头，
                <br />
                写成自己的故事。
              </h1>
              <p className="welcome-copy">
                从第一句灵感，到下一章的转折。
                <br />
                在这里规划、写作、审阅，让智能体陪你推进每一步。
              </p>
              <div className="welcome-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void openWorkspace(true)}
                >
                  <Plus size={17} />
                  新建 / 导入作品
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void openWorkspace(false)}
                >
                  <FolderOpen size={17} />
                  打开已有作品
                </button>
              </div>
              <div className="welcome-cards">
                <article>
                  <ListChecks />
                  <h3>一起构思</h3>
                  <p>梳理人物、世界与故事方向。</p>
                </article>
                <article>
                  <FileText />
                  <h3>专注写作</h3>
                  <p>围绕当前章节，持续推进。</p>
                </article>
                <article>
                  <History />
                  <h3>由你决定</h3>
                  <p>每次修改可审阅、可撤销。</p>
                </article>
              </div>
              <div className="setup-hint">
                <span className={`dot ${host?.hasKey ? "" : "muted"}`} />
                {host?.hasKey
                  ? "模型已配置，可以开始创作。"
                  : "开始前，连接你自己的模型服务。"}
                <button
                  className="text-button"
                  onClick={() => setShowSettings(true)}
                >
                  {host?.hasKey ? "查看设置" : "连接模型"}
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : view === "editor" ? (
            <div className="manuscript-area">
              {switchingWorkspace ? (
                <div role="status" className="center-empty">
                  正在打开作品，请稍候…
                </div>
              ) : document ? (
                <>
                  <div className="paper-caption">
                    {document.path.startsWith("canon")
                      ? "故事设定"
                      : document.path === "story.yaml"
                        ? "创作约定"
                        : "正在写作"}
                    <span>选中文字，可以让智能体只修改这一段</span>
                  </div>
                  <Editor
                    key={`${root}:${document.path}`}
                    positionKey={`cursor:${root}:${document.path}`}
                    content={content}
                    onChange={(value) => {
                      documentReads.current.invalidate();
                      setContent(value);
                    }}
                    onSelection={(from, to) =>
                      setSelection(to > from ? { from, to } : null)
                    }
                    onSave={(snapshot) => void save(snapshot)}
                  />
                </>
              ) : (
                <div className="center-empty">选择左侧文件，开始写作。</div>
              )}
            </div>
          ) : view === "diff" && proposal ? (
            <div className="review-area">
              <div className="review-heading">
                <span className="eyebrow">
                  候选修改 ·{" "}
                  {proposal.status === "pending"
                    ? "等待你审阅"
                    : proposal.status === "accepted"
                      ? "已接受"
                      : proposal.status === "rejected"
                        ? "已拒绝"
                        : "存在冲突"}
                </span>
                <h2>{proposalTitle(proposal.changeSet.operations)}</h2>
                <p>{proposal.path}</p>
                <details className="proposal-explanation" key={proposal.id}>
                  <summary>查看候选说明</summary>
                  <div tabIndex={0}>{proposal.summary}</div>
                </details>
              </div>
              <div className="diff-legend">
                <span className="removed-key">删除内容</span>
                <span className="added-key">新增内容</span>
                {["pending", "rejected"].includes(proposal.status) && (
                  <button
                    className="text-button"
                    disabled={busy || running}
                    onClick={() => void prepareRedo()}
                  >
                    准备重做要求
                  </button>
                )}
                {proposal.status === "pending" && (
                  <button
                    className="text-button"
                    onClick={() => setEditCandidate(!editCandidate)}
                  >
                    {editCandidate ? "查看对比" : "调整候选内容"}
                  </button>
                )}
              </div>
              {editCandidate ? (
                <textarea
                  className="candidate-editor"
                  aria-label="调整候选内容"
                  value={candidateText}
                  onChange={(e) => setCandidateText(e.target.value)}
                />
              ) : (
                <div className="diff-content">
                  {diffLines(
                    proposal.before,
                    candidateDirty ? candidateText : proposal.after,
                  ).map((part, index) => (
                    <div
                      className={
                        part.added
                          ? "diff-added"
                          : part.removed
                            ? "diff-removed"
                            : "diff-same"
                      }
                      key={index}
                    >
                      <span className="diff-sign">
                        {part.added ? "+" : part.removed ? "−" : " "}
                      </span>
                      <pre>{part.value}</pre>
                    </div>
                  ))}
                </div>
              )}
              {proposal.status === "pending" && (
                <div className="review-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void resolveProposal(false)}
                  >
                    <X size={16} />
                    拒绝修改
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void resolveProposal(true)}
                  >
                    <Check size={16} />
                    {candidateDirty ? "调整后接受" : "接受修改"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="history-area">
              <span className="eyebrow">每一次选择，都有记录</span>
              <h2>版本历史</h2>
              {revisions.length === 0 ? (
                <p className="muted-text">
                  保存正文或接受候选后，版本会出现在这里。
                </p>
              ) : (
                revisions.map((r) => (
                  <article className="revision-card" key={r.revisionId}>
                    <div>
                      <strong>{r.resources[0]?.resourcePath}</strong>
                      <p>
                        {new Date(r.publishedAt).toLocaleString("zh-CN")}
                        {r.undoOfRevisionId ? " · 撤销版本" : ""}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => void undo(r.revisionId)}
                    >
                      <Undo2 size={15} />
                      撤销这次修改
                    </button>
                  </article>
                ))
              )}
            </div>
          )}
          <div className="document-footer">
            <span>
              {document
                ? `${content.replace(/\s/gu, "").length.toLocaleString()} 字`
                : "文稿属于你，保存在本地"}
            </span>
            <span>
              {selection
                ? `已选中 ${selection.to - selection.from} 个字符`
                : "Markdown · UTF-8"}
            </span>
          </div>
        </main>
        <aside className="agent-pane">
          <div className="agent-header">
            <div>
              <span className="agent-symbol">
                <Sparkles size={17} />
              </span>
              <strong>创作搭档</strong>
            </div>
            <div>
              <button
                className="icon-button"
                title="任务历史"
                aria-label="任务历史"
                disabled={!root}
                onClick={() => setShowTasks(!showTasks)}
              >
                <History size={17} />
              </button>
              <button
                className="icon-button"
                title="新任务"
                aria-label="新任务"
                disabled={running}
                onClick={() => {
                  sessionReads.current.reset();
                  setSession(null);
                  setTask("");
                  setReadOnly(false);
                  setMode("coauthor");
                  setSkillId("");
                  setLimitCandidates(false);
                  setCandidatePaths([]);
                  setSelection(null);
                }}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className="agent-status">
            <span className={`dot ${running ? "pulsing" : ""}`} />
            {!kernelAvailable
              ? "执行进程已退出"
              : session
                ? statusLabel[session.status]
                : "准备好，与你一起创作"}
            <span>{host?.hasKey ? host.provider.model : "尚未连接模型"}</span>
          </div>
          {!kernelAvailable && (
            <div className="task-issue" role="alert">
              执行进程已退出。请先复制保留未保存的正文和候选手动调整，再关闭并重新打开客户端，选择原作品查看恢复状态。已保存内容仍在磁盘；中断请求的用量和费用可能未知，不会自动重发。
            </div>
          )}
          {showTasks && (
            <div className="task-list">
              <input
                aria-label="搜索历史任务"
                placeholder="按任务标题查找…"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
              <select
                aria-label="筛选任务状态"
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value)}
              >
                <option value="all">全部状态</option>
                {Object.entries(statusLabel).map(([status, label]) => (
                  <option key={status} value={status}>
                    {label}
                  </option>
                ))}
              </select>
              <p>找到 {matchingTasks.length} 个任务</p>
              {matchingTasks.map((s) => (
                <button
                  key={s.id}
                  disabled={running}
                  onClick={() => {
                    void loadSession(s.id).catch(report);
                    setShowTasks(false);
                  }}
                >
                  <span>{s.title}</span>
                  <small>{statusLabel[s.status]}</small>
                </button>
              ))}
              {matchingTasks.length === 0 && (
                <p>没有匹配的创作任务，试试清空搜索或切换状态。</p>
              )}
            </div>
          )}
          {session && (
            <button
              className="latest-progress"
              onClick={() => {
                const panel = conversation.current;
                if (panel) panel.scrollTop = panel.scrollHeight;
              }}
            >
              查看最新进展
              {pendingProposals.length > 0
                ? ` · ${pendingProposals.length} 份候选待审`
                : ""}
            </button>
          )}
          <div className="agent-conversation" ref={conversation}>
            {!session ? (
              <div className="agent-intro">
                <span className="large-spark">
                  <Sparkles size={24} />
                </span>
                <h2>今天，故事走到哪里了？</h2>
                <p>
                  告诉我你想写什么。我会结合当前作品，帮助你构思、写作和修订。
                </p>
                <button
                  className="prompt-card"
                  onClick={() => {
                    setReadOnly(true);
                    setMode("explore");
                    setSkillId("scene-plan.v1");
                    setTask(
                      "先和我梳理故事设定，再规划前三章。暂不生成修改候选。",
                    );
                  }}
                >
                  梳理故事，从一个想法开始
                  <ChevronRight size={15} />
                </button>
                <button
                  className="prompt-card"
                  onClick={() => {
                    setReadOnly(false);
                    setMode("coauthor");
                    setSkillId("");
                    setTask(
                      "阅读当前章节和创作约定，规划下一场景并生成正文候选。",
                    );
                  }}
                >
                  继续当前章节
                  <ChevronRight size={15} />
                </button>
                <button
                  className="prompt-card"
                  onClick={() => {
                    setReadOnly(true);
                    setTask(
                      "只读审稿：检查当前作品的人物动机、时间线和设定冲突，指出依据和修改建议。",
                    );
                    setSkillId("continuity-review.v3");
                  }}
                >
                  检查设定与故事连续性
                  <ChevronRight size={15} />
                </button>
              </div>
            ) : (
              <>
                {plan && (
                  <div className="plan-card">
                    <div>
                      <ListChecks size={16} />
                      <strong>本轮创作计划</strong>
                    </div>
                    {plan.steps.map((s, i) => (
                      <p key={i}>
                        <span>{i + 1}</span>
                        {s}
                      </p>
                    ))}
                  </div>
                )}
                {messages.map((e) => {
                  const p = e.payload as { role: string; content: string };
                  return (
                    <div className={`message ${p.role}`} key={e.eventId}>
                      <div className="message-author">
                        {p.role === "user" ? (
                          "你"
                        ) : (
                          <>
                            <Sparkles size={13} />
                            创作搭档
                          </>
                        )}
                      </div>
                      {p.role === "user" ? (
                        <div className="message-text">{p.content}</div>
                      ) : (
                        <MessageText text={p.content} />
                      )}
                    </div>
                  );
                })}
                {recentEvents
                  .filter((e) => e.type === "tool.completed")
                  .slice(-6)
                  .map((e) => (
                    <div className="tool-step" key={e.eventId}>
                      <CheckCircle2 size={13} />
                      {labels[(e.payload as { tool: string }).tool] ??
                        "完成工具操作"}
                    </div>
                  ))}
                {running && (
                  <div className="working">
                    <Loader2 size={16} className="spin" />
                    正在推进任务…
                  </div>
                )}
                {running && streaming && (
                  <div className="message assistant">
                    <MessageText text={streaming} />
                  </div>
                )}
                {lastIssue && !running && (
                  <div className="task-issue">
                    <AlertCircle size={15} />
                    <div>
                      <p>{lastIssue.message}</p>
                      <p>
                        最近完成步骤：
                        {labels[
                          (
                            [...recentEvents]
                              .reverse()
                              .find((event) => event.type === "tool.completed")
                              ?.payload as { tool?: string } | undefined
                          )?.tool ?? ""
                        ] ?? "本轮尚无已记录的工具完成步骤"}
                        。当前有 {pendingProposals.length} 份候选等待审阅。
                      </p>
                      <p>
                        先查看已有候选和版本历史。软件不会自动重发请求；继续任务将调用模型，失败或中断的调用也可能已计费。
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setShowSettings(true)}
                      >
                        检查模型连接设置
                      </button>
                    </div>
                  </div>
                )}
                {!running &&
                  (lastIssue ||
                    ["paused", "failed"].includes(session.status)) && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void beginTask(
                          "继续之前的任务：先核对已经完成的计划、候选及当前正文，只推进未完成部分。不要重复发布已接受的内容。",
                          true,
                        )
                      }
                    >
                      <RefreshCw size={15} />
                      继续任务（将调用模型）
                    </button>
                  )}
                {pendingProposals.map((p) => (
                  <button
                    className="proposal-card"
                    key={p.id}
                    onClick={() => review(p)}
                  >
                    <span className="eyebrow">有一份修改等待审阅</span>
                    <strong>{p.summary}</strong>
                    <span>{p.path}</span>
                    <b>
                      查看修改对比
                      <ChevronRight size={14} />
                    </b>
                  </button>
                ))}
                {usage.started > 0 && (
                  <details className="receipt">
                    <summary>本轮参考与用量</summary>
                    <p>
                      {usage.models.join("、")} · 已发起 {usage.started} 次调用
                      ·{" "}
                      {usage.knownCalls
                        ? `已知累计 ${usage.inputTokens} 输入 / ${usage.outputTokens} 输出 Token`
                        : "暂无已确认用量"}{" "}
                      {usage.unknownCalls > 0
                        ? ` · ${usage.unknownCalls} 次调用用量未确认`
                        : ""}
                      · {costSummary(usage)}
                    </p>
                    {session.events
                      .filter((e) => e.type === "context.compiled")
                      .slice(-1)
                      .map((e) => (
                        <ul key={e.eventId}>
                          {(
                            e.payload as {
                              candidateScope?: CandidateScopeEntry[];
                            }
                          ).candidateScope && (
                            <li>
                              本轮候选范围：
                              {(
                                e.payload as {
                                  candidateScope: CandidateScopeEntry[];
                                }
                              ).candidateScope
                                .map((entry) => entry.path)
                                .join("、")}
                            </li>
                          )}
                          <li>
                            本轮工作模式：
                            {(e.payload as { mode?: string }).mode === "explore"
                              ? "探索"
                              : (e.payload as { mode?: string }).mode ===
                                  "batch"
                                ? "批量候选"
                                : "共创"}
                          </li>
                          {(
                            e.payload as {
                              skill?: {
                                name: string;
                                id: string;
                                instructions: string;
                              };
                            }
                          ).skill && (
                            <li>
                              <details>
                                <summary>
                                  本轮采用技能：
                                  {
                                    (e.payload as { skill: { name: string } })
                                      .skill.name
                                  }
                                </summary>
                                <p>
                                  {
                                    (e.payload as { skill: { id: string } })
                                      .skill.id
                                  }
                                </p>
                                <p>
                                  {
                                    (
                                      e.payload as {
                                        skill: { instructions: string };
                                      }
                                    ).skill.instructions
                                  }
                                </p>
                              </details>
                            </li>
                          )}
                          {(
                            e.payload as { sources: { path: string }[] }
                          ).sources.map((s) => (
                            <li key={s.path}>{s.path}</li>
                          ))}
                        </ul>
                      ))}
                  </details>
                )}
              </>
            )}
          </div>
          <div className="composer-area">
            <details className="skill-preview">
              <summary>
                候选文件范围 ·{" "}
                {limitCandidates
                  ? `${candidatePaths.length} 个文件`
                  : "未限定文件"}
              </summary>
              <label>
                <input
                  type="checkbox"
                  checked={limitCandidates}
                  disabled={running || busy}
                  onChange={(event) => {
                    setLimitCandidates(event.target.checked);
                    if (
                      event.target.checked &&
                      candidatePaths.length === 0 &&
                      document
                    )
                      setCandidatePaths([document.path]);
                  }}
                />
                限定可生成候选的文件
              </label>
              <p>
                只限制候选目标，仍可读取其他作品资料。最多 8
                个文件；这不是自动批量生成。
              </p>
              {limitCandidates &&
                files.map((file) => (
                  <label key={file.path} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      aria-label={`候选范围 ${file.path}`}
                      checked={candidatePaths.includes(file.path)}
                      disabled={
                        running ||
                        busy ||
                        (!candidatePaths.includes(file.path) &&
                          candidatePaths.length >= 8)
                      }
                      onChange={(event) =>
                        setCandidatePaths((paths) =>
                          event.target.checked
                            ? [...paths, file.path]
                            : paths.filter((path) => path !== file.path),
                        )
                      }
                    />
                    {file.path}
                  </label>
                ))}
            </details>
            <label className="composer-control">
              工作模式
              <select
                aria-label="工作模式"
                value={mode}
                disabled={running || busy}
                onChange={(event) => {
                  const nextMode = resolveAuthoringMode(event.target.value);
                  setMode(nextMode);
                  if (nextMode === "batch") {
                    setLimitCandidates(true);
                    if (!candidatePaths.length && document)
                      setCandidatePaths([document.path]);
                  }
                }}
              >
                <option value="coauthor">共创 · 生成候选后审阅</option>
                <option value="explore">探索 · 只讨论不改稿</option>
                <option value="batch">批量候选 · 限定范围逐项审阅</option>
              </select>
            </label>
            <p className="composer-note">
              {mode === "explore"
                ? "探索仅阅读、讨论与规划，不生成修改候选。"
                : mode === "batch"
                  ? "按范围连续生成候选，遇到停止条件暂停；不会自动接受。"
                  : "共创可调用工具和生成候选；你接受后才改动正文。"}
            </p>
            <label className="composer-control">
              创作技能
              <select
                aria-label="创作技能"
                value={skillId}
                disabled={running || busy}
                onChange={(event) => {
                  setSkillId(event.target.value);
                  if (getBuiltinSkill(event.target.value)?.readOnly)
                    setReadOnly(true);
                }}
              >
                <option value="">不指定技能</option>
                {historicalSkill && (
                  <option value={historicalSkill.id} disabled>
                    {historicalSkill.name} · 历史规则 v{historicalSkill.version}
                  </option>
                )}
                {BUILTIN_SKILLS.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedSkill && (
              <details className="skill-preview">
                <summary>查看技能规则 · {selectedSkill.name}</summary>
                <p>{selectedSkill.instructions}</p>
                {historicalSkill && (
                  <p>
                    当前沿用原任务的历史规则；选择其他技能后，新一轮将使用所选规则。
                  </p>
                )}
                <small>{selectedSkill.id} · 仅声明式规则，不增加工具权限</small>
              </details>
            )}
            <label className="composer-toggle">
              <input
                type="checkbox"
                checked={
                  readOnly ||
                  selectedSkill?.readOnly === true ||
                  mode === "explore"
                }
                disabled={
                  running ||
                  busy ||
                  selectedSkill?.readOnly === true ||
                  mode === "explore"
                }
                onChange={(event) => setReadOnly(event.target.checked)}
              />
              只读讨论与审稿（不生成候选）
            </label>
            {selection && (
              <div className="selection-chip">
                <FileText size={13} />
                仅修改选中段落
                <button
                  className="icon-button"
                  aria-label="清除选区限制"
                  onClick={() => setSelection(null)}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="composer">
              <textarea
                aria-label="创作要求"
                placeholder={
                  root
                    ? "描述你的想法，或告诉我下一步…"
                    : "先新建或打开一个作品…"
                }
                disabled={!root}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void beginTask();
                  }
                }}
              />
              <div className="composer-tools">
                <span>Ctrl + Enter 发送</span>
                {running ? (
                  <button
                    className="stop-button"
                    onClick={() =>
                      void rpc("turn.interrupt", {
                        sessionId: session!.id,
                      }).catch(report)
                    }
                  >
                    <Square size={13} />
                    暂停
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label="发送创作要求"
                    disabled={!root || !task.trim() || busy}
                    onClick={() => void beginTask()}
                  >
                    <Send size={17} />
                  </button>
                )}
              </div>
            </div>
            <p className="composer-note">AI 生成候选，由你决定是否写入作品。</p>
          </div>
        </aside>
      </div>
      {importPreview && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="导入文件夹稿件"
          >
            <h2>发现文件夹稿件</h2>
            <p>
              确认后复制到作品目录，不移动原文件，不覆盖已有目标。不调用模型。
            </p>
            {importPreview.entries.map((entry) => (
              <label key={entry.source} className="composer-toggle">
                <input
                  type="checkbox"
                  checked={selectedImports.includes(entry.source)}
                  disabled={busy || entry.targetExists}
                  onChange={(event) =>
                    setSelectedImports((selected) =>
                      event.target.checked
                        ? [...selected, entry.source]
                        : selected.filter((source) => source !== entry.source),
                    )
                  }
                />
                <span>
                  {entry.source} → {entry.target}
                  {entry.targetExists ? "（目标已存在，不会覆盖）" : ""}
                </span>
              </label>
            ))}
            {importPreview.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {error && <p role="alert">{error}</p>}
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setImportPreview(null)}>
                暂不导入
              </button>
              <button
                className="primary"
                disabled={busy || !root || !selectedImports.length}
                onClick={() =>
                  void openWorkspace(
                    true,
                    root!,
                    importPreview.entries
                      .filter((entry) => selectedImports.includes(entry.source))
                      .map(({ source, sourceHash }) => ({
                        source,
                        sourceHash,
                      })),
                  )
                }
              >
                复制所选稿件到作品
              </button>
            </div>
          </section>
        </div>
      )}
      {showProject && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="作品管理"
          >
            <div className="modal-heading">
              <h2>作品管理</h2>
              <button
                className="icon-button"
                aria-label="关闭作品管理"
                onClick={() => setShowProject(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              一份作品对应一个本地文件夹。切换作品不会移动、复制或删除原作品。
            </p>
            <label>
              当前作品位置
              <input readOnly value={root ?? "尚未打开作品"} />
            </label>
            {running && (
              <p role="status">
                任务正在运行，请先关闭此面板并暂停任务，再切换作品。
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {uninitializedRoot && (
              <div>
                <p>所选文件夹：{uninitializedRoot}</p>
                <p>
                  可在此建立作品配置和目录；已有正文不会被覆盖。不会移动当前作品。
                </p>
                <button
                  className="primary"
                  disabled={busy || running}
                  onClick={() => void openWorkspace(true, uninitializedRoot)}
                >
                  将所选文件夹初始化为作品
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="primary"
                disabled={!root || busy || running}
                onClick={() => {
                  if (dirty) {
                    setError("请先保存编辑器里的修改，再打开作品设置。");
                    return;
                  }
                  void rpc<DocumentContent>("workspace.read", {
                    path: "story.yaml",
                  })
                    .then((doc) => {
                      readStorySettings(doc.content);
                      setStorySettings(doc);
                      setShowProject(false);
                    })
                    .catch(report);
                }}
              >
                作品设置表单
              </button>
              <button
                className="secondary"
                disabled={busy || running}
                onClick={() => void openWorkspace(false)}
              >
                切换已有作品
              </button>
              <button
                className="primary"
                disabled={busy || running}
                onClick={() => void openWorkspace(true)}
              >
                新建 / 导入作品
              </button>
            </div>
            <p className="muted-text">
              空文件夹请选“新建 /
              导入作品”；“切换已有作品”用于已初始化的作品目录。
            </p>
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={!root}
                onClick={() => {
                  setShowProject(false);
                  void openDocument("story.yaml").catch(report);
                }}
              >
                编辑创作约定
              </button>
              <button
                className="secondary"
                disabled={!root}
                onClick={() => {
                  setShowProject(false);
                  void showHistory();
                }}
              >
                查看版本历史
              </button>
              <button
                className="secondary"
                disabled={!root}
                onClick={() => void exportStory()}
              >
                导出作品
              </button>
            </div>
            <p className="muted-text">
              作品设置保存到
              story.yaml；“编辑创作约定”保留完整文本编辑入口。目录搬迁、删除与批量管理尚未提供，不会自动更改磁盘位置。
            </p>
          </section>
        </div>
      )}
      {storySettings && (
        <StorySettingsDialog
          document={storySettings}
          onClose={() => setStorySettings(null)}
          onSave={async (content) => {
            const saved = await rpc<DocumentContent>("workspace.save", {
              path: "story.yaml",
              baseHash: storySettings.hash,
              content,
            });
            if (document?.path === "story.yaml") {
              setDocument(saved);
              setContent(saved.content);
            }
            setNotice("作品设置已保存，下一轮创作会参考这些约定。");
            await loadSessions();
          }}
        />
      )}
      {showSettings && host && (
        <SettingsDialog
          host={host}
          onClose={() => setShowSettings(false)}
          onSaved={setHost}
        />
      )}
      {newFile && (
        <div className="modal-backdrop">
          <section
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-label="新建作品文件"
          >
            <div className="modal-heading">
              <h2>添加作品文件</h2>
              <button
                className="icon-button"
                aria-label="关闭"
                onClick={() => setNewFile(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              文件类型
              <select
                aria-label="文件类型"
                value={newTemplate}
                onChange={(event) => {
                  const template = event.target.value as DocumentTemplate;
                  setNewTemplate(template);
                  setNewPath(documentTemplates[template].path);
                }}
              >
                {Object.entries(documentTemplates).map(([key, template]) => (
                  <option key={key} value={key}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              作品内路径
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
            </label>
            <p className="muted-text">
              正文使用 manuscript/，大纲使用 outline/，人物与设定使用 canon/。
              模板只提供待填写的结构，不调用模型、不自动编造设定；同名文件不会被覆盖。
            </p>
            {newFileError && <p role="alert">{newFileError}</p>}
            <button
              className="primary"
              disabled={busy}
              onClick={() => void createFile()}
            >
              创建文件
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function SettingsDialog({
  host,
  onClose,
  onSaved,
}: {
  host: HostState;
  onClose: () => void;
  onSaved: (state: HostState) => void;
}) {
  const [config, setConfig] = useState<ProviderConfig>(host.provider);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const update = <K extends keyof ProviderConfig>(
    key: K,
    value: ProviderConfig[K],
  ): void => setConfig({ ...config, [key]: value });
  const save = async (test: boolean): Promise<void> => {
    setBusy(true);
    setMessage("");
    setConnected(false);
    try {
      const state = await rpc<HostState>("provider.configure", {
        config,
        credential,
      });
      setCredential("");
      onSaved(state);
      if (test) {
        const result = await rpc<{ model: string }>("provider.test");
        setMessage(`连接成功，${result.model} 的工具调用已验证。`);
        setConnected(true);
      } else setMessage("设置已保存，密钥已由系统加密。可以关闭设置开始创作。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "设置未保存。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="模型设置"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">连接你的创作能力</span>
            <h2>模型设置</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭模型设置"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p className="muted-text">
          使用你自己的模型服务。运行任务时，相关作品内容会发送到下方地址。
        </p>
        <label>
          接口协议
          <select
            value={config.protocol}
            onChange={(e) =>
              update("protocol", e.target.value as ProviderConfig["protocol"])
            }
          >
            <option value="responses">OpenAI Responses</option>
            <option value="chat-completions">Chat Completions 兼容接口</option>
          </select>
        </label>
        <label>
          服务地址
          <input
            value={config.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label>
          模型名称
          <input
            value={config.model}
            onChange={(e) => update("model", e.target.value)}
            placeholder="填写你的服务支持的模型名称"
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            placeholder={
              host.hasKey
                ? "已保存 · 留空保持不变"
                : "粘贴密钥，仅在本机加密保存"
            }
          />
        </label>
        <div className="settings-grid">
          <label>
            每次输出上限
            <input
              type="number"
              min={256}
              max={16384}
              value={config.maxOutputTokens}
              onChange={(e) =>
                update("maxOutputTokens", Number(e.target.value))
              }
            />
          </label>
          <label>
            每轮调用上限
            <input
              type="number"
              min={1}
              max={20}
              value={config.maxSteps}
              onChange={(e) => update("maxSteps", Number(e.target.value))}
            />
          </label>
        </div>
        <div className="settings-grid">
          <label>
            输入单价（美元／百万 Token）
            <input
              type="number"
              min={0}
              max={1000000}
              step="any"
              placeholder="留空表示费用未知"
              value={config.inputUsdPerMillion ?? ""}
              onChange={(e) =>
                update(
                  "inputUsdPerMillion",
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            />
          </label>
          <label>
            输出单价（美元／百万 Token）
            <input
              type="number"
              min={0}
              max={1000000}
              step="any"
              placeholder="留空表示费用未知"
              value={config.outputUsdPerMillion ?? ""}
              onChange={(e) =>
                update(
                  "outputUsdPerMillion",
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={config.tools}
            onChange={(e) => update("tools", e.target.checked)}
          />
          该模型支持函数工具调用
        </label>
        <p className="settings-hint">
          连接测试会发起一次模型请求。单价请以服务商账单为准；这里的金额只是按你填写的价格和已返回用量估算，未知调用仍标为待确认。
        </p>
        {message && (
          <div
            role="status"
            className={`settings-message ${connected ? "connected" : ""}`}
          >
            {message}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void save(true)}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            保存并测试连接
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save(false)}
          >
            保存设置
          </button>
        </div>
      </section>
    </div>
  );
}
