import { useEffect, useId, useState } from "react";
import {
  Bug,
  Cpu,
  FileText,
  Gauge,
  Globe,
  Lightbulb,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
  Wrench,
} from "lucide-react";
import type { ContributionSettings } from "../../shared/insights";
import {
  agentProviders,
  providerLabels,
  type AgentProvider,
  type ModelCatalog,
  type ReasoningEffort,
} from "../../shared/models";
import { reasoningLabels } from "../models/ModelSummary";
import {
  defaultPonytailMode,
  ponytailSource,
  type PonytailMode,
} from "../../shared/efficiency";
import "./mission.css";

export const directionOptions = [
  {
    value: "bugfix",
    label: "修復問題",
    hint: "讓原本的行為正常運作",
    icon: Bug,
  },
  {
    value: "feature",
    label: "新增功能",
    hint: "讓使用者能完成新任務",
    icon: Lightbulb,
  },
  {
    value: "performance",
    label: "改善效能",
    hint: "減少等待與資源耗用",
    icon: Gauge,
  },
  {
    value: "ux",
    label: "使用體驗",
    hint: "讓操作更直覺、更順暢",
    icon: WandSparkles,
  },
  {
    value: "testing",
    label: "補足測試",
    hint: "保護重要行為與邊界",
    icon: ShieldCheck,
  },
  {
    value: "docs",
    label: "完善文件",
    hint: "讓理解與上手更容易",
    icon: FileText,
  },
  {
    value: "maintenance",
    label: "維護整理",
    hint: "降低後續修改的負擔",
    icon: Wrench,
  },
] as const;

export interface DirectionSettingsProps {
  value: ContributionSettings;
  onChange: (next: ContributionSettings) => void;
  compact?: boolean;
  modelsOnly?: boolean;
}

export function DirectionSettings({
  value,
  onChange,
  compact = false,
  modelsOnly = false,
}: DirectionSettingsProps) {
  const id = useId();
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [modelError, setModelError] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const provider = value.provider ?? "codex";
  const providerLabel = providerLabels[provider];
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setLoadingModels(true);
    setModelError("");
    fetch(`/api/models?provider=${provider}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`暫時無法讀取 ${providerLabel} 模型清單。`);
        const result: ModelCatalog = await response.json();
        if (!controller.signal.aborted) {
          setCatalog(result);
          setModelError(result.error || "");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setModelError(
            error instanceof Error ? error.message : "模型清單載入失敗。",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingModels(false);
      });
    return () => controller.abort();
  }, [catalogAttempt, provider, providerLabel]);
  const models = catalog?.models ?? [];
  const defaultModel = models.find((model) => model.isDefault);
  const selectedModel = value.model
    ? models.find((model) => model.id === value.model)
    : defaultModel;
  const availableEfforts = selectedModel?.reasoningEfforts ?? [];
  const unknownModel = !!value.model && !selectedModel;
  const unknownEffort =
    !!value.reasoningEffort &&
    !availableEfforts.includes(value.reasoningEffort);
  function update<K extends keyof ContributionSettings>(
    key: K,
    next: ContributionSettings[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div
      className={`mission-settings${compact ? " mission-settings-compact" : ""}${modelsOnly ? " mission-settings-models-only" : ""}`}
    >
      {!modelsOnly && (
        <>
          <fieldset className="mission-fieldset">
            <legend>
              <span className="mission-legend-icon">
                <Sparkles size={16} />
              </span>
              這次想從哪個方向貢獻？
            </legend>
            <p className="mission-field-note">
              選一個主要方向，讓團隊圍繞同一個目標工作。
            </p>
            <div className="mission-direction-grid">
              {directionOptions.map(
                ({ value: direction, label, hint, icon: Icon }) => (
                  <label
                    className={`mission-direction${value.direction === direction ? " mission-direction-selected" : ""}`}
                    key={direction}
                  >
                    <input
                      type="radio"
                      name={`${id}-direction`}
                      value={direction}
                      checked={value.direction === direction}
                      onChange={() => update("direction", direction)}
                    />
                    <Icon size={17} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      {!compact && <small>{hint}</small>}
                    </span>
                  </label>
                ),
              )}
            </div>
          </fieldset>

          <div className="mission-settings-fields">
            <div className="mission-form-field">
              <label htmlFor={`${id}-target`}>誰會因此受益？</label>
              <input
                id={`${id}-target`}
                maxLength={2000}
                value={value.targetUser}
                onChange={(event) => update("targetUser", event.target.value)}
                placeholder="例如：用這個 SDK 建立儀表板的前端開發者"
              />
            </div>
            <div className="mission-form-field">
              <label htmlFor={`${id}-outcome`}>完成後，使用者會有什麼不同？</label>
              <textarea
                id={`${id}-outcome`}
                maxLength={4000}
                value={value.outcome}
                onChange={(event) => update("outcome", event.target.value)}
                rows={compact ? 2 : 3}
                placeholder="例如：短暫網路中斷時，列表能自動重試載入，不需要手動重新整理。"
              />
            </div>
            <div className="mission-form-columns">
              <div className="mission-form-field">
                <label htmlFor={`${id}-constraints`}>
                  開發界線 <span>選填</span>
                </label>
                <textarea
                  id={`${id}-constraints`}
                  maxLength={4000}
                  value={value.constraints}
                  onChange={(event) => update("constraints", event.target.value)}
                  rows={3}
                  placeholder="例如：維持既有 API 相容；只處理 GET；不新增套件。"
                  aria-describedby={`${id}-constraints-help`}
                />
                <p id={`${id}-constraints-help`} className="mission-field-note">
                  寫下不能改動的行為、相容性或範圍限制。
                </p>
              </div>
              <div className="mission-form-field">
                <label htmlFor={`${id}-acceptance`}>
                  怎樣算完成？ <span>選填</span>
                </label>
                <textarea
                  id={`${id}-acceptance`}
                  maxLength={4000}
                  value={value.acceptance}
                  onChange={(event) => update("acceptance", event.target.value)}
                  rows={3}
                  placeholder={
                    "例如：\n暫時性失敗可重試成功\n401 不重試\n既有測試全部通過"
                  }
                  aria-describedby={`${id}-acceptance-help`}
                />
                <p id={`${id}-acceptance-help`} className="mission-field-note">
                  以可觀察的結果或測試描述，一行一項。
                </p>
              </div>
            </div>
            <div className="mission-form-field">
              <label htmlFor={`${id}-issue`}>
                相關 issue 連結 <span>選填</span>
              </label>
              <input
                id={`${id}-issue`}
                type="text"
                inputMode="url"
                maxLength={400}
                value={value.issueUrl ?? ""}
                onChange={(event) => update("issueUrl", event.target.value)}
                placeholder="https://github.com/owner/repo/issues/123"
                aria-describedby={`${id}-issue-help`}
              />
              <p id={`${id}-issue-help`} className="mission-field-note">
                只接受 GitHub issue 頁面網址。填了之後，PR 草稿才可以寫 Fixes／Refs
                #編號並連回這個 issue；送出前請先在 issue 留言表明要處理。
              </p>
            </div>
          </div>

        </>
      )}
      <div
        className="mission-model-settings"
        role="group"
        aria-labelledby={`${id}-model-heading`}
      >
        <div className="mission-model-header">
          <h3 id={`${id}-model-heading`} className="mission-model-heading">
            <Cpu size={16} aria-hidden="true" />
            模型與思考方式
          </h3>
          <p className="mission-field-note">
            所有專案與 Agents
            共用此設定。新任務會記錄自己的設定，後續修改不會影響已建立的任務。
          </p>
        </div>
        <div className="mission-form-field">
          <label htmlFor={`${id}-provider`}>Agent</label>
          <select
            id={`${id}-provider`}
            value={provider}
            aria-describedby={`${id}-provider-help`}
            onChange={(event) =>
              onChange({
                ...value,
                provider: event.target.value as AgentProvider,
                model: "",
                reasoningEffort: "",
              })
            }
          >
            {agentProviders.map((option) => (
              <option key={option} value={option}>
                {providerLabels[option]}
              </option>
            ))}
          </select>
          <p id={`${id}-provider-help`} className="mission-field-note">
            {provider === "claude"
              ? "沿用本機 Claude Code 的訂閱登入，不使用 API 金鑰；可用模型依方案而定。"
              : "沿用本機 Codex CLI 的登入。"}
          </p>
        </div>
        <div className="mission-form-columns">
          <div className="mission-form-field">
            <label htmlFor={`${id}-model`}>執行模型</label>
            <select
              id={`${id}-model`}
              value={value.model ?? ""}
              disabled={loadingModels}
              aria-describedby={`${id}-model-help`}
              onChange={(event) => {
                const model = event.target.value;
                const nextModel = model
                  ? models.find((option) => option.id === model)
                  : defaultModel;
                const reasoningEffort =
                  value.reasoningEffort &&
                  nextModel?.reasoningEfforts.includes(value.reasoningEffort)
                    ? value.reasoningEffort
                    : "";
                onChange({ ...value, model, reasoningEffort });
              }}
            >
              <option value="">
                {providerLabel} 預設
                {defaultModel ? ` · ${defaultModel.name}` : ""}
              </option>
              {unknownModel && (
                <option value={value.model}>
                  {value.model} · 已儲存，待確認
                </option>
              )}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <p id={`${id}-model-help`} className="mission-field-note">
              {loadingModels
                ? `正在讀取本機 ${providerLabel} 可用模型…`
                : unknownModel
                  ? "目前無法驗證這個已儲存的模型，請重新選擇或載入清單。"
                  : selectedModel?.description ||
                    `沿用本機 ${providerLabel} 的預設模型。`}
            </p>
          </div>
          <div className="mission-form-field">
            <label htmlFor={`${id}-reasoning`}>思考強度</label>
            <select
              id={`${id}-reasoning`}
              value={value.reasoningEffort ?? ""}
              disabled={
                loadingModels ||
                (!availableEfforts.length && !value.reasoningEffort)
              }
              aria-describedby={`${id}-reasoning-help`}
              onChange={(event) =>
                update(
                  "reasoningEffort",
                  event.target.value as ReasoningEffort | "",
                )
              }
            >
              <option value="">
                模型預設
                {selectedModel?.defaultReasoningEffort
                  ? ` · ${reasoningLabels[selectedModel.defaultReasoningEffort]}`
                  : ""}
              </option>
              {unknownEffort && (
                <option value={value.reasoningEffort}>
                  {value.reasoningEffort} · 已儲存，待確認
                </option>
              )}
              {availableEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {reasoningLabels[effort]} · {effort}
                </option>
              ))}
            </select>
            <p id={`${id}-reasoning-help`} className="mission-field-note">
              {unknownEffort && !loadingModels
                ? "已儲存的強度未在此模型的清單中，請重新選擇。"
                : "只列出所選模型支援的強度；較高的強度每回合需要更久、用量也較多，BELL 會為 Claude Code 以及 xhigh、max 強度延長等待時間。"}
            </p>
          </div>
        </div>
        <label className="mission-plan-option">
          <input
            type="checkbox"
            checked={value.webAccess === true}
            onChange={(event) => update("webAccess", event.target.checked)}
            aria-describedby={`${id}-web-help`}
          />
          <span className="mission-plan-copy">
            <strong>
              <Globe size={16} />
              允許 Agent 上網搜尋與讀取網頁
            </strong>
            <small id={`${id}-web-help`}>
              套用到 Lead、Teammates、Reviewer、Test analyst
              與追問導師；專案分析與探索貢獻維持離線。網頁內容視為不可信資料；Claude Code 的 curl、wget 仍被拒絕。
            </small>
          </span>
        </label>
        {modelError && (
          <div className="mission-model-error" role="status">
            <span>{modelError} 已儲存的選擇會保留。</span>
            <button
              type="button"
              onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
              disabled={loadingModels}
            >
              重新載入
            </button>
          </div>
        )}
      </div>

      {!modelsOnly && (
        <>
          <div className="mission-form-field mission-ponytail-setting">
            <label htmlFor={`${id}-ponytail`}>Ponytail 開發方式</label>
            <select
              id={`${id}-ponytail`}
              value={value.ponytailMode ?? defaultPonytailMode}
              onChange={(event) =>
                update("ponytailMode", event.target.value as PonytailMode)
              }
              aria-describedby={`${id}-ponytail-help`}
            >
              <option value="lite">輕量 · 預設</option>
              <option value="full">完整</option>
              <option value="off">關閉</option>
            </select>
            <p id={`${id}-ponytail-help`} className="mission-field-note">
              輕量：以精簡規則減少過度開發。完整：套用更多規則，優先重用現有程式與原生功能。關閉：方便比較不同方式的成果與用量。{" "}
              <a href={ponytailSource} target="_blank" rel="noreferrer">
                查看 Ponytail
              </a>
            </p>
          </div>

          <div className="mission-team-settings">
            <fieldset className="mission-fieldset mission-team-size">
              <legend>
                <span className="mission-legend-icon">
                  <Users size={16} />
                </span>
                協作規模
              </legend>
              <div className="mission-team-choices">
                {([2, 3, 4] as const).map((count) => (
                  <label
                    className={
                      value.maxTeammates === count
                        ? "mission-team-choice selected"
                        : "mission-team-choice"
                    }
                    key={count}
                  >
                    <input
                      type="radio"
                      name={`${id}-teammates`}
                      checked={value.maxTeammates === count}
                      onChange={() => update("maxTeammates", count)}
                    />
                    <strong>{count}</strong>
                    <span>位隊友</span>
                  </label>
                ))}
              </div>
              <p className="mission-field-note">
                設定團隊上限，實際分工由任務計畫決定。
              </p>
            </fieldset>
            <label className="mission-plan-option">
              <input
                type="checkbox"
                checked={value.requirePlanApproval}
                onChange={(event) =>
                  update("requirePlanApproval", event.target.checked)
                }
              />
              <span className="mission-plan-copy">
                <strong>
                  <Settings2 size={16} />
                  開發前，先讓我確認計畫
                </strong>
                <small>先看分工、範圍與驗收方式，確認後再進入實作。</small>
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
