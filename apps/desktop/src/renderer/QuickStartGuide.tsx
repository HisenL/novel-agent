import { useEffect, useRef, useState } from "react";

export function QuickStartGuide({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="quick-start-guide"
      aria-labelledby="guide-title"
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2 id="guide-title">小说创作首次使用向导</h2>
        <button
          onClick={() => dialog.current?.close()}
          aria-label="关闭使用指南"
        >
          关闭
        </button>
      </div>
      <p aria-live="polite">第 {step + 1} / 3 步</p>
      {step === 0 && (
        <>
          <p>先准备作品，再连接模型，最后审阅修改。开发版不需要安装包。</p>
          <ol>
            <li>
              <strong>选择作品文件夹</strong>
              <p>
                空文件夹用“新建 /
                导入作品”；已初始化的作品用“打开作品”。切换失败不会搬迁或删除原作品。
              </p>
            </li>
            <li>
              <strong>填写创作约定</strong>
              <p>
                左下角“作品管理”→“作品设置表单”，填写作品名称、题材、视角、世界规则和禁区。改作品名称不会改磁盘文件夹名。
              </p>
            </li>
          </ol>
        </>
      )}
      {step === 1 && (
        <>
          <strong>连接模型并开始创作</strong>
          <p>
            右上角“模型设置”填写服务并测试连接。密钥只填设置页，不要发到对话里。测试连接与创作可能收费；离线仍可打开和编辑作品。
          </p>
          <p>
            在右侧描述目标，例如“先读取创作约定，和我讨论开场方向，暂不生成正文”。探索模式只读，共创模式可生成候选。
          </p>
        </>
      )}
      {step === 2 && (
        <>
          <h3>保存与审阅</h3>
          <p>
            手动编辑后点保存或按 Ctrl+S。AI
            候选不是正式正文；检查“修改对比”，接受后才写入作品，拒绝保持原稿。选中文字可限定改写范围。
          </p>
          <h3>撤销与继续</h3>
          <p>
            “版本历史”→“撤销这次修改”会生成反向候选，仍需审阅接受。外部修改发生冲突时不会强行覆盖。关闭前保存正文；“任务历史”可找回任务，继续任务可能产生新的模型费用。
          </p>
          <h3>导入与导出</h3>
          <p>
            文件夹中的 Markdown/YAML 导入会先预览，确认后复制，原文件保留。导出
            ZIP
            只含已保存正文与设定，不含待审候选、任务历史或密钥，不是完整备份。ZIP
            先解压，再用“新建 / 导入作品”打开。
          </p>
          <p>
            当前为开发预览。遇到问题请记录操作和错误文字，不要发送 API Key。
          </p>
        </>
      )}
      <div className="modal-actions">
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>
          上一步
        </button>
        {step < 2 ? (
          <button onClick={() => setStep(step + 1)}>下一步</button>
        ) : (
          <button onClick={() => dialog.current?.close()}>
            完成，开始创作
          </button>
        )}
      </div>
    </dialog>
  );
}
