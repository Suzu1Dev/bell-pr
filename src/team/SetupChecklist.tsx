import { Copy, Wrench } from "lucide-react";
import type { mergeSetupNeeds } from "../../shared/setup";

interface Props {
  needs: ReturnType<typeof mergeSetupNeeds>;
  onCopy: (command: string) => void;
}

/**
 * What agents could not run because this machine lacks something. Agents do
 * not change the machine, so the person installs it; each command is the
 * agent's suggestion and is shown to be checked, never run by BELL.
 */
export function SetupChecklist({ needs, onCopy }: Props) {
  if (!needs.length) return null;
  return (
    <section className="setup-checklist" aria-labelledby="setup-checklist-title">
      <h2 id="setup-checklist-title">
        <Wrench size={15} aria-hidden="true" />
        需要你在這台機器準備的環境
      </h2>
      <p>
        Agent 被要求不改動這台機器（不用 sudo，也不做全域或使用者層級的安裝），所以下列檢查在這次工作中沒有完整執行。指令是
        Agent 的建議，執行前請對照專案文件確認；裝好後可以自己在工作目錄重跑這些檢查，之後的貢獻也能直接執行。
      </p>
      <ul>
        {needs.map((need) => (
          <li key={need.command}>
            <strong>{need.need}</strong>
            {need.reason && <p>{need.reason}</p>}
            <div className="setup-checklist-command">
              <code>{need.command}</code>
              <button
                type="button"
                className="icon-button"
                aria-label={`複製指令：${need.command}`}
                title="複製指令"
                onClick={() => onCopy(need.command)}
              >
                <Copy size={13} />
              </button>
            </div>
            <small>回報者：{need.from.join("、")}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
