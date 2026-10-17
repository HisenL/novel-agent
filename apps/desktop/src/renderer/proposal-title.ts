/** Describe the operation, not a guessed content type or the length of its base text. */
export function proposalTitle(operations: readonly { kind: string }[]): string {
  return operations.length > 0 &&
    operations.every((operation) => operation.kind === "create")
    ? "审阅新建文件"
    : "审阅文件修改";
}
