export function filterTaskHistory<T extends { title: string; status: string }>(
  sessions: readonly T[],
  query: string,
  status = "all",
): T[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  return sessions.filter(
    (session) =>
      !session.title.startsWith("手动保存") &&
      (status === "all" || session.status === status) &&
      session.title.toLocaleLowerCase("zh-CN").includes(normalized),
  );
}
