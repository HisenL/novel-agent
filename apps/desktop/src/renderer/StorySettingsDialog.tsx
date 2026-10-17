import { useEffect, useState } from "react";
import type { DocumentContent } from "@novel-agent/kernel";
import {
  readStorySettings,
  writeStorySettings,
  storyFields,
  unboundStoryFields,
} from "./story-settings.js";

export function StorySettingsDialog({
  document,
  onSave,
  onClose,
}: {
  document: DocumentContent;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState(() =>
    readStorySettings(document.content),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unbound = unboundStoryFields(document.content);
  const changed =
    JSON.stringify(values) !==
    JSON.stringify(readStorySettings(document.content));
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (changed) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [changed]);
  const close = () => {
    if (
      !busy &&
      (!changed || window.confirm("作品设置尚未保存，是否放弃这些修改？"))
    )
      onClose();
  };
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      await onSave(writeStorySettings(document.content, values));
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "保存失败，修改仍保留在表单中。",
      );
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
        aria-label="作品设置"
      >
        <div className="modal-heading">
          <h2>作品设置与创作约定</h2>
          <button className="secondary" disabled={busy} onClick={close}>
            关闭作品设置
          </button>
        </div>
        <p className="muted-text">
          保存到当前作品的
          story.yaml。智能体会参考这些约定；其他字段和注释保留，保存产生可撤销版本。
        </p>
        {unbound.length > 0 && (
          <p role="status">
            此文件还有表单未显示的字段：{unbound.join("、")}
            。空白表单项不代表没有相关约定；请关闭设置并在左侧打开“创作约定”查看完整
            YAML。保存表单不会迁移或删除这些字段。
          </p>
        )}
        {storyFields.map(([field, label]) => (
          <label key={field}>
            {label}
            {field === "title" ? (
              <input
                maxLength={4000}
                value={values[field]}
                onChange={(e) =>
                  setValues({ ...values, [field]: e.target.value })
                }
              />
            ) : (
              <textarea
                rows={2}
                maxLength={4000}
                value={values[field]}
                onChange={(e) =>
                  setValues({ ...values, [field]: e.target.value })
                }
              />
            )}
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <button
          className="primary"
          disabled={busy || !changed}
          onClick={() => void save()}
        >
          {busy ? "正在保存…" : "保存作品设置"}
        </button>
      </section>
    </div>
  );
}
