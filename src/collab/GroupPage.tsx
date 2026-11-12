/**
 * The Group page (#/group): who is here, what is held in one repository,
 * live teammate progress, cross-file dependency guards, team handoff TODOs,
 * and member/account management.
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  CheckSquare,
  FolderGit2,
  GitFork,
  Info,
  KeyRound,
  Shield,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import type {
  CollabCheckResponse,
  CollabConflict,
  CollabDependency,
  CollabDependencyHit,
  CollabDependencyMode,
  CollabDetectedImport,
  CollabFileDependency,
  CollabHold,
  CollabInfo,
  CollabInviteResponse,
  CollabMemberRecord,
  CollabTasksResponse,
} from "../../shared/collab";
import type { Formatters } from "../../shared/i18n/locale";
import type { PairCodeResponse } from "../../shared/pairing";
import { product } from "../../shared/product";
import { api, ApiError, send } from "../api";
import type { Status } from "../app/hooks/useAppData";
import { useFormat, useT, type Messages } from "../i18n";
import { participantToken } from "./participant";
import { Modal } from "../modals/Modal";
import { CopyCommand } from "../setup/CopyCommand";
import { createGroupStore, reasonOf, type GroupState } from "./store";
import "./group.css";

type Store = ReturnType<typeof createGroupStore>;
type Me = NonNullable<CollabInfo["me"]>;

/** A time with its seconds, for "as of". */
const seconds = { timeStyle: "medium" } as const;

const sentenceOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The first two characters of a name, for its circle. */
const initials = (name: string) => Array.from(name).slice(0, 2).join("").toUpperCase();

/** Moves the focus once the next render is on screen. */
function focusSoon(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
}

function runHref(runId: string, filePath?: string) {
  const base = `#/runs/${encodeURIComponent(runId)}/${filePath ? "changes" : "overview"}`;
  return filePath ? `${base}?file=${encodeURIComponent(filePath)}` : base;
}

/**
 * A request of the page: `busy` while it runs, and the server's sentence when it is refused.
 * The control that was pressed is `aria-disabled` while busy, and never `disabled`: it keeps the focus.
 */
function useRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(request: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request();
    } catch (cause) {
      setError(sentenceOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

/** What the box between Paths and the button says. */
export interface Answer {
  asOf: string | number;
  /** After a hold that was refused because another one is in the way. */
  notTaken?: true;
  /** The asked paths that cannot be held, as they were sent. */
  invalid: string[];
  /** The holds in the way, each with its held paths. */
  holds: { name: string; mine: boolean; title: string; paths: string[]; since?: string }[];
  /** Cross-file dependency hits (`block` guards or `warn` reminders). */
  dependencyHits?: CollabDependencyHit[];
}

type InTheWay = Answer["holds"][number];

/** One entry for each hold in the way, with its held paths. */
function byHold(found: (Omit<InTheWay, "paths"> & { key: string; scope: string })[]) {
  const holds = new Map<string, InTheWay>();
  for (const { key, scope, ...hold } of found) {
    const entry = holds.get(key) ?? { ...hold, paths: [] };
    if (!entry.paths.includes(scope)) entry.paths.push(scope);
    holds.set(key, entry);
  }
  return [...holds.values()];
}

/**
 * A private-use character that stands for a value in a sentence of the
 * dictionary, which places it: 0 is the holder, 1 the title, the paths follow.
 * What the server sent never goes through the dictionary, so it stays text.
 */
const slot = (index: number) => String.fromCharCode(0xe000 + index);
const slots = /([\ue000-\uf8ff])/;

interface Line {
  text: string;
  values: string[];
}

/** The answer's sentences: what cannot be held, then holds and dependency hits in the way. */
function linesOf(answer: Answer, t: Messages["collab"], format: Formatters): Line[] {
  const listed = (paths: string[]) =>
    format.list(
      paths.map((_, index) => slot(index + 2)),
      { type: "unit" },
    );
  const lines = answer.holds.map((hold) => ({
    text: (hold.mine ? t.youHold : t.holds)({
      name: slot(0),
      paths: listed(hold.paths),
      title: slot(1),
      time: hold.since && format.time(hold.since),
    }),
    values: [hold.mine ? t.me : hold.name, hold.title, ...hold.paths],
  }));
  for (const hit of answer.dependencyHits ?? []) {
    const template = hit.mode === "block" ? t.dependencyBlock : t.dependencyWarn;
    lines.push({
      text: template({
        holder: slot(0),
        title: slot(1),
        askedPath: slot(2),
        heldPath: slot(3),
      }),
      values: [hit.holder, hit.title, hit.askedPath, hit.heldPath],
    });
  }
  if (answer.invalid.length)
    lines.unshift({
      text: t.cannotHold({ paths: listed(answer.invalid) }),
      values: ["", "", ...answer.invalid],
    });
  return lines;
}

/** A sentence with its values in place: the holder in bold, each path as code. */
const rich = ({ text, values }: Line) =>
  text.split(slots).map((part, index) => {
    if (index % 2 === 0) return part;
    const value = part.charCodeAt(0) - 0xe000;
    if (value === 1) return values[1];
    return value === 0 ? (
      <strong key={index}>{values[0]}</strong>
    ) : (
      <code key={index} className="log-command">
        {values[value]}
      </code>
    );
  });

/** The answer as plain sentences, for the live region. */
function heard(answer: Answer | undefined, t: Messages["collab"], format: Formatters) {
  if (!answer) return "";
  const lines = linesOf(answer, t, format).map(({ text, values }) =>
    text.replace(new RegExp(slots, "g"), (mark) => values[mark.charCodeAt(0) - 0xe000]),
  );
  if (!lines.length) return t.spoken.sentence({ text: t.free });
  if (answer.notTaken) lines[0] = t.notTaken({ then: lines[0] });
  return lines.map((text) => t.spoken.sentence({ text })).join(" ");
}

/** Whether Take hold is off: no title, no answer, or a hold / blocked dependency in the way. */
export const cannotTake = (title: string, answer?: Answer) =>
  !title.trim() ||
  !answer ||
  answer.holds.length > 0 ||
  answer.invalid.length > 0 ||
  Boolean(answer.dependencyHits?.some((hit) => hit.mode === "block"));

/** At most one box: who is in the way, in words, or that nothing is. */
export function HoldAnswer({ answer }: { answer?: Answer }) {
  const t = useT("collab");
  const format = useFormat();
  const lines = answer ? linesOf(answer, t, format) : [];
  const asOf = answer && <p>{t.answerAsOf({ time: format.time(answer.asOf, seconds) })}</p>;
  return (
    <div id="hold-answer">
      {answer &&
        (lines.length ? (
          <div className="split-warning">
            <TriangleAlert size={16} aria-hidden="true" />
            <div>
              {lines.map((line, index) => (
                <p key={index}>
                  {answer.notTaken && index === 0 && <strong>{t.notTaken({ then: "" })}</strong>}
                  {rich(line)}
                </p>
              ))}
              {asOf}
            </div>
          </div>
        ) : (
          <div className="split-info">
            <Info size={16} aria-hidden="true" />
            <div>
              <p>{t.free}</p>
              {asOf}
            </div>
          </div>
        ))}
    </div>
  );
}

/** First set-up as admin (either locally at the host or remotely over VPN/Tailscale). */
export function BootstrapAdminCard({
  store,
  info,
  refused,
}: {
  store: Pick<Store, "start">;
  info: CollabInfo;
  refused?: string;
}) {
  const t = useT("collab");
  const [name, setName] = useState(info.tailscaleName ?? "");
  const [withAccount, setWithAccount] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const request = useRequest();
  const error = request.error || refused;
  const remote = Boolean(info.canBootstrap);
  const canSubmit =
    Boolean(name.trim()) && (!withAccount || (Boolean(username.trim()) && password.length >= 8));

  return (
    <form
      className="settings-card"
      onSubmit={(event) => {
        event.preventDefault();
        void request.run(() =>
          store
            .start(
              name.trim(),
              withAccount ? { username: username.trim(), password } : undefined,
            )
            .then(() => focusSoon(".group-page h1")),
        );
      }}
    >
      <div className="section-heading">
        <div>
          <h2>{remote ? t.host.remoteTitle : t.host.title}</h2>
          <p>{remote ? t.host.remoteBody : t.host.body}</p>
        </div>
      </div>
      {info.tailscaleLogin && (
        <div className="split-info">
          <Info size={16} aria-hidden="true" />
          <div>
            <p>{t.host.tailscaleAutoBind({ login: info.tailscaleLogin })}</p>
          </div>
        </div>
      )}
      <label className="field-label" htmlFor="host-name">
        {t.host.name} <span>{t.shownOnBoard}</span>
      </label>
      <input
        className="text-input"
        id="host-name"
        value={name}
        maxLength={40}
        autoComplete="off"
        aria-describedby={error ? "card-error" : undefined}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="draft-task-items">
        <label>
          <input
            type="checkbox"
            checked={withAccount}
            onChange={(event) => setWithAccount(event.target.checked)}
          />
          <span>{t.auth.optionalAccount}</span>
        </label>
      </div>
      {withAccount && (
        <>
          <label className="field-label" htmlFor="bootstrap-username">
            {t.auth.username}
          </label>
          <input
            className="text-input"
            id="bootstrap-username"
            value={username}
            maxLength={32}
            placeholder={t.auth.usernamePlaceholder}
            autoComplete="username"
            autoCapitalize="off"
            onChange={(event) => setUsername(event.target.value)}
          />
          <label className="field-label" htmlFor="bootstrap-password">
            {t.auth.password}
          </label>
          <input
            className="text-input"
            id="bootstrap-password"
            type="password"
            value={password}
            maxLength={128}
            placeholder={t.auth.passwordPlaceholder}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </>
      )}
      {error && (
        <p className="inline-error" role="alert" id="card-error">
          {error}
        </p>
      )}
      <button
        className="button primary full-width"
        aria-disabled={request.busy}
        disabled={!canSubmit}
      >
        {t.host.submit}
      </button>
    </form>
  );
}

/** Unjoined card: invite code (+ optional reusable account), team username/password login, or Tailscale. */
function JoinAuthCard({
  store,
  info,
  refused,
}: {
  store: Store;
  info: CollabInfo;
  refused?: string;
}) {
  const t = useT("collab");
  const [tab, setTab] = useState<"invite" | "login" | "tailscale">(
    info.tailscaleAvailable ? "tailscale" : "invite",
  );
  const [code, setCode] = useState("");
  const [withAccount, setWithAccount] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const request = useRequest();
  const error = request.error || refused;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void request.run(async () => {
      if (tab === "login") {
        await store.login(username.trim(), password);
      } else if (tab === "tailscale") {
        await store.loginTailscale(code.trim() || undefined);
      } else {
        await store.join(
          code.trim(),
          withAccount && username.trim()
            ? { username: username.trim(), password }
            : undefined,
        );
      }
      focusSoon(".group-page h1");
    });
  };

  const canSubmit =
    tab === "login"
      ? Boolean(username.trim() && password.length >= 8)
      : tab === "tailscale"
        ? true
        : Boolean(code.trim() && (!withAccount || (username.trim() && password.length >= 8)));

  return (
    <form className="settings-card" onSubmit={submit}>
      <div className="view-toggle group-auth-tabs" role="group" aria-label={t.auth.tabsLabel}>
        <button
          type="button"
          className={tab === "invite" ? "selected" : ""}
          aria-pressed={tab === "invite"}
          onClick={() => {
            setTab("invite");
            request.setError("");
          }}
        >
          {t.auth.inviteTab}
        </button>
        <button
          type="button"
          className={tab === "login" ? "selected" : ""}
          aria-pressed={tab === "login"}
          onClick={() => {
            setTab("login");
            request.setError("");
          }}
        >
          {t.auth.loginTab}
        </button>
        <button
          type="button"
          className={tab === "tailscale" ? "selected" : ""}
          aria-pressed={tab === "tailscale"}
          onClick={() => {
            setTab("tailscale");
            request.setError("");
          }}
        >
          {t.auth.tailscaleTab}
        </button>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            {tab === "login"
              ? t.auth.loginTitle
              : tab === "tailscale"
                ? t.auth.tailscaleTitle
                : t.join.title}
          </h2>
          <p>
            {tab === "login"
              ? t.auth.loginBody
              : tab === "tailscale"
                ? t.auth.tailscaleBody
                : t.join.body}
          </p>
        </div>
      </div>
      {tab === "tailscale" && info.tailscaleLogin && (
        <p className="field-help" role="status">
          {t.auth.tailscaleDetected({ login: info.tailscaleLogin })}
        </p>
      )}
      {(tab === "invite" || tab === "tailscale") && (
        <>
          <label className="field-label" htmlFor="join-code">
            {tab === "invite" ? t.join.code : t.auth.inviteOptional}
          </label>
          <input
            className="text-input"
            id="join-code"
            value={code}
            maxLength={32}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
          />
        </>
      )}
      {tab === "invite" && (
        <div className="draft-task-items">
          <label>
            <input
              type="checkbox"
              checked={withAccount}
              onChange={(event) => setWithAccount(event.target.checked)}
            />
            <span>{t.auth.optionalAccount}</span>
          </label>
        </div>
      )}
      {(tab === "login" || (tab === "invite" && withAccount)) && (
        <>
          <label className="field-label" htmlFor="group-username">
            {t.auth.username}
          </label>
          <input
            className="text-input"
            id="group-username"
            value={username}
            maxLength={32}
            placeholder={t.auth.usernamePlaceholder}
            autoComplete="username"
            autoCapitalize="off"
            onChange={(event) => setUsername(event.target.value)}
          />
          <label className="field-label" htmlFor="group-password">
            {t.auth.password}
          </label>
          <input
            className="text-input"
            id="group-password"
            type="password"
            value={password}
            maxLength={128}
            placeholder={t.auth.passwordPlaceholder}
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            onChange={(event) => setPassword(event.target.value)}
          />
        </>
      )}
      {error && (
        <p className="inline-error" role="alert" id="card-error">
          {error}
        </p>
      )}
      <button
        className="button primary full-width"
        aria-disabled={request.busy}
        disabled={!canSubmit}
      >
        {tab === "login"
          ? t.auth.loginSubmit
          : tab === "tailscale"
            ? t.auth.tailscaleSubmit
            : t.join.submit}
      </button>
    </form>
  );
}

/** Name and role, then the code, which is shown once. */
function InviteDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  const t = useT("collab");
  const words = t.inviteDialog;
  const actions = useT("common").actions;
  const format = useFormat();
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(false);
  const [invite, setInvite] = useState<CollabInviteResponse>();
  const request = useRequest();
  const create = (event: FormEvent) => {
    event.preventDefault();
    void request.run(async () =>
      setInvite(
        await store.call<CollabInviteResponse>(
          "/invites",
          send("POST", admin ? { name: name.trim(), admin } : { name: name.trim() }),
        ),
      ),
    );
  };
  return (
    <Modal
      key={invite ? "code" : "name"}
      title={invite ? words.codeFor({ name: name.trim() }) : words.title}
      subtitle={
        invite &&
        (admin ? words.asAdmin : words.member)({
          name: name.trim(),
          time: format.time(invite.expiresAt),
        })
      }
      mark={<UserPlus size={23} />}
      onClose={onClose}
    >
      {invite ? (
        <>
          <CopyCommand command={invite.code} label={t.join.code} copyLabel={words.copy} />
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={onClose}>
              {words.done}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={create}>
          <label className="field-label" htmlFor="invite-name">
            {words.name} <span>{t.shownOnBoard}</span>
          </label>
          <input
            className="text-input"
            id="invite-name"
            value={name}
            maxLength={40}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          <div className="draft-task-items">
            <label>
              <input
                type="checkbox"
                checked={admin}
                aria-describedby="admin-help"
                onChange={(event) => setAdmin(event.target.checked)}
              />
              <span>{words.admin}</span>
            </label>
            <p id="admin-help">{words.adminHelp}</p>
          </div>
          {request.error && (
            <p className="inline-error" role="alert">
              {request.error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {actions.cancel}
            </button>
            <button className="button primary" aria-disabled={request.busy} disabled={!name.trim()}>
              {words.create}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Member self-service dialog to set or update their own username/password. */
function AccountDialog({ store, me, onClose }: { store: Store; me: Me; onClose: () => void }) {
  const t = useT("collab");
  const actions = useT("common").actions;
  const [username, setUsername] = useState(me.username ?? "");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const request = useRequest();

  const save = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    void request.run(async () => {
      await store.call(
        `/people/${encodeURIComponent(me.id)}`,
        send("PATCH", {
          ...(username.trim() ? { username: username.trim() } : {}),
          ...(password ? { password } : {}),
        }),
      );
      setPassword("");
      setSaved(true);
    });
  };

  return (
    <Modal
      title={t.accountDialog.title}
      subtitle={t.accountDialog.subtitle}
      mark={<KeyRound size={22} />}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <label className="field-label" htmlFor="my-account-username">
          {t.auth.username}
        </label>
        <input
          className="text-input"
          id="my-account-username"
          value={username}
          maxLength={32}
          placeholder={t.auth.usernamePlaceholder}
          autoComplete="username"
          autoCapitalize="off"
          onChange={(event) => setUsername(event.target.value)}
        />
        <label className="field-label" htmlFor="my-account-password">
          {t.auth.password}
        </label>
        <input
          className="text-input"
          id="my-account-password"
          type="password"
          value={password}
          maxLength={128}
          placeholder={t.auth.passwordPlaceholder}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
        />
        {saved && (
          <p className="field-help" role="status">
            {t.accountDialog.saved}
          </p>
        )}
        {request.error && (
          <p className="inline-error" role="alert">
            {request.error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {actions.close}
          </button>
          <button
            className="button primary"
            aria-disabled={request.busy}
            disabled={!username.trim() && password.length < 8}
          >
            {t.accountDialog.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Admin dialog to create accounts, assign admin roles, link Tailscale or disable/remove members. */
function AdminMembersDialog({ store, me, onClose }: { store: Store; me: Me; onClose: () => void }) {
  const t = useT("collab");
  const actions = useT("common").actions;
  const words = t.adminDialog;
  const [members, setMembers] = useState<CollabMemberRecord[]>([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tailscaleLogin, setTailscaleLogin] = useState("");
  const [admin, setAdmin] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editTailscale, setEditTailscale] = useState("");
  const [pairCreated, setPairCreated] = useState<PairCodeResponse | null>(null);
  const request = useRequest();

  const load = async () => {
    const res = await store.call<{ people: CollabMemberRecord[] }>("/people");
    setMembers(res.people.filter((item) => !item.removed));
  };

  useEffect(() => {
    void request.run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginEdit = (member: CollabMemberRecord) => {
    setEditingId(member.id);
    setEditName(member.name);
    setEditUsername(member.username ?? "");
    setEditPassword("");
    setEditTailscale(member.tailscaleLogin ?? "");
  };

  const saveEdit = (member: CollabMemberRecord) =>
    void request.run(async () => {
      const patch: Record<string, unknown> = {};
      if (editName.trim() && editName.trim() !== member.name) patch.name = editName.trim();
      if (editUsername.trim() && editUsername.trim() !== (member.username ?? ""))
        patch.username = editUsername.trim();
      if (editPassword.length >= 8) patch.password = editPassword;
      if (editTailscale.trim() !== (member.tailscaleLogin ?? ""))
        patch.tailscaleLogin = editTailscale.trim() || null;
      if (Object.keys(patch).length) {
        await store.call(`/people/${encodeURIComponent(member.id)}`, send("PATCH", patch));
        await load();
        store.reload();
      }
      setEditingId(null);
    });

  const createPairCode = () =>
    void request.run(async () => {
      const created = await api<PairCodeResponse>("/pair/codes", {
        ...send("POST", {}),
        headers: { "x-bell-participant": participantToken() },
      });
      setPairCreated(created);
    });

  const createMember = (event: FormEvent) => {
    event.preventDefault();
    void request.run(async () => {
      await store.call(
        "/people",
        send("POST", {
          name: name.trim(),
          username: username.trim(),
          password,
          ...(admin ? { admin: true } : {}),
          ...(tailscaleLogin.trim() ? { tailscaleLogin: tailscaleLogin.trim() } : {}),
        }),
      );
      setName("");
      setUsername("");
      setPassword("");
      setTailscaleLogin("");
      setAdmin(false);
      await load();
      store.reload();
    });
  };

  const updateMember = (id: string, patch: Record<string, unknown>) =>
    void request.run(async () => {
      await store.call(`/people/${encodeURIComponent(id)}`, send("PATCH", patch));
      await load();
      store.reload();
    });

  const removeMember = (id: string) =>
    void request.run(async () => {
      await store.call(`/people/${encodeURIComponent(id)}/remove`, send("POST", {}));
      await load();
      store.reload();
    });

  return (
    <Modal
      title={words.title}
      subtitle={words.subtitle}
      mark={<Users size={22} />}
      onClose={onClose}
    >
      <form className="group-admin-create" onSubmit={createMember}>
        <h3>{words.createHeading}</h3>
        <div className="group-admin-grid">
          <div>
            <label className="field-label" htmlFor="admin-member-name">
              {words.displayName}
            </label>
            <input
              className="text-input"
              id="admin-member-name"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="admin-member-username">
              {t.auth.username}
            </label>
            <input
              className="text-input"
              id="admin-member-username"
              value={username}
              maxLength={32}
              placeholder={t.auth.usernamePlaceholder}
              autoCapitalize="off"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="admin-member-password">
              {t.auth.password}
            </label>
            <input
              className="text-input"
              id="admin-member-password"
              type="password"
              value={password}
              maxLength={128}
              placeholder={t.auth.passwordPlaceholder}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="admin-member-ts">
              {words.tailscaleLabel}
            </label>
            <input
              className="text-input"
              id="admin-member-ts"
              value={tailscaleLogin}
              maxLength={120}
              placeholder={words.tailscalePlaceholder}
              autoCapitalize="off"
              onChange={(event) => setTailscaleLogin(event.target.value)}
            />
          </div>
        </div>
        <div className="draft-task-items">
          <label>
            <input
              type="checkbox"
              checked={admin}
              onChange={(event) => setAdmin(event.target.checked)}
            />
            <span>{words.roleAdmin}</span>
          </label>
        </div>
        <button
          className="button primary"
          aria-disabled={request.busy}
          disabled={!name.trim() || !username.trim() || password.length < 8}
        >
          {words.createSubmit}
        </button>
      </form>
      <div className="group-admin-members">
        <h3>{words.membersHeading}</h3>
        {request.error && (
          <p className="inline-error" role="alert">
            {request.error}
          </p>
        )}
        <ul className="group-sublist">
          {members.map((member) => (
            <li key={member.id} className="group-subrow">
              <div>
                <strong>
                  {member.id === me.id ? t.you({ name: member.name }) : member.name}
                </strong>
                <div className="mission-evidence-paths">
                  <code>{member.admin ? words.roleAdmin : words.roleMember}</code>
                  {member.username && <code>@{member.username}</code>}
                  {member.tailscaleLogin && <code>{member.tailscaleLogin}</code>}
                  {member.disabled && <code>{words.disabledBadge}</code>}
                </div>
                {editingId === member.id && (
                  <div className="group-admin-grid">
                    <div>
                      <label className="field-label" htmlFor={`edit-name-${member.id}`}>
                        {words.displayName}
                      </label>
                      <input
                        className="text-input"
                        id={`edit-name-${member.id}`}
                        value={editName}
                        maxLength={40}
                        onChange={(event) => setEditName(event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`edit-user-${member.id}`}>
                        {t.auth.username}
                      </label>
                      <input
                        className="text-input"
                        id={`edit-user-${member.id}`}
                        value={editUsername}
                        maxLength={32}
                        placeholder={t.auth.usernamePlaceholder}
                        autoCapitalize="off"
                        onChange={(event) => setEditUsername(event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`edit-pass-${member.id}`}>
                        {t.auth.password}
                      </label>
                      <input
                        className="text-input"
                        id={`edit-pass-${member.id}`}
                        type="password"
                        value={editPassword}
                        maxLength={128}
                        placeholder={words.newPasswordPlaceholder}
                        onChange={(event) => setEditPassword(event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`edit-ts-${member.id}`}>
                        {words.tailscaleLabel}
                      </label>
                      <input
                        className="text-input"
                        id={`edit-ts-${member.id}`}
                        value={editTailscale}
                        maxLength={120}
                        placeholder={words.tailscalePlaceholder}
                        autoCapitalize="off"
                        onChange={(event) => setEditTailscale(event.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="group-release">
                {editingId === member.id ? (
                  <>
                    <button
                      type="button"
                      className="button primary"
                      aria-disabled={request.busy}
                      disabled={
                        !editName.trim() ||
                        (Boolean(editPassword) && editPassword.length < 8)
                      }
                      onClick={() => saveEdit(member)}
                    >
                      {words.saveEdit}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setEditingId(null)}
                    >
                      {words.cancelEdit}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    aria-disabled={request.busy}
                    onClick={() => beginEdit(member)}
                  >
                    {words.edit}
                  </button>
                )}
                {member.id !== me.id && (
                  <>
                    <button
                      type="button"
                      className="button secondary"
                      aria-disabled={request.busy}
                      onClick={() => updateMember(member.id, { admin: !member.admin })}
                    >
                      {member.admin ? words.makeMember : words.makeAdmin}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      aria-disabled={request.busy}
                      onClick={() => updateMember(member.id, { disabled: !member.disabled })}
                    >
                      {member.disabled ? words.enable : words.disable}
                    </button>
                    <button
                      type="button"
                      className="button danger"
                      aria-disabled={request.busy}
                      onClick={() => removeMember(member.id)}
                    >
                      {words.remove}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="group-admin-members">
        <h3>{words.pairHeading}</h3>
        <p className="field-help">{words.pairHelp}</p>
        <button
          type="button"
          className="button secondary"
          aria-disabled={request.busy}
          onClick={createPairCode}
        >
          {words.pairCreate}
        </button>
        {pairCreated && <CopyCommand command={pairCreated.code} />}
      </div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          {actions.close}
        </button>
      </div>
    </Modal>
  );
}

interface BoardProps {
  store: Store;
  state: GroupState;
  /** The id of the repository on the page. */
  project: string;
  held: CollabHold[];
  me: Me;
}

/** Held now: one row for each hold, in the server's order. Rows never change places. */
function HeldNow({ store, state, project, held, me }: BoardProps) {
  const t = useT("collab");
  const format = useFormat();
  const list = useRef<HTMLUListElement>(null);
  const [rows, setRows] = useState(() => held.map((hold) => ({ hold, gone: false })));
  const [asked, setAsked] = useState("");
  const [ending, setEnding] = useState("");
  const [failed, setFailed] = useState<{ id: string; message: string }>();
  const [released, setReleased] = useState("");

  useEffect(() => {
    const focused = list.current?.contains(document.activeElement) ?? false;
    const stay = focused || (list.current?.matches(":hover") ?? false);
    setRows((shown) => [
      ...shown.flatMap((old) => {
        const hold = held.find((other) => other.claimId === old.hold.claimId);
        return hold ? [{ hold, gone: false }] : stay ? [{ ...old, gone: true }] : [];
      }),
      ...held
        .filter((hold) => !shown.some((old) => old.hold.claimId === hold.claimId))
        .map((hold) => ({ hold, gone: false })),
    ]);
    if (focused) focusSoon(".group-holds:not(:focus-within)");
  }, [held]);

  const settle = (stay: boolean) => {
    if (!stay) setRows((shown) => shown.filter((row) => !row.gone));
  };

  const end = async (hold: CollabHold, mine: boolean, done = false) => {
    if (ending === hold.claimId) return;
    setEnding(hold.claimId);
    setFailed(undefined);
    try {
      await store.call(
        `/projects/${encodeURIComponent(project)}/holds/${encodeURIComponent(hold.claimId)}/${mine ? "release" : "revoke"}`,
        send("POST", mine ? { fence: hold.fence, ...(done ? { done: true } : {}) } : {}),
      );
      if (mine) {
        const words = { title: hold.title, paths: format.list(hold.scopes, { type: "unit" }) };
        setReleased(done ? t.spoken.finishedAndReleased(words) : t.spoken.releasedUnfinished(words));
      }
      setAsked("");
      list.current?.focus();
    } catch (error) {
      if (reasonOf(error) === "staleFence") store.reload();
      setFailed({ id: hold.claimId, message: sentenceOf(error) });
    } finally {
      setEnding("");
    }
  };

  return (
    <section aria-labelledby="held-h">
      <div className="section-heading">
        <h2 id="held-h">{t.heldNow}</h2>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {released}
      </p>
      {rows.length ? (
        <ul
          ref={list}
          className="settings-card group-holds"
          tabIndex={-1}
          aria-labelledby="held-h"
          onPointerLeave={(event) => settle(event.currentTarget.contains(document.activeElement))}
          onBlur={(event) =>
            settle(
              event.currentTarget.matches(":hover") ||
                event.currentTarget.contains(event.relatedTarget),
            )
          }
        >
          {rows.map(({ hold, gone }) => {
            const id = hold.claimId;
            const mine = hold.holder === me.id;
            const name = state.people.find((person) => person.id === hold.holder)?.name ?? "";
            const fresh = state.added.some((added) => added.claimId === id);
            return (
              <li
                key={id}
                className={`group-hold${mine ? " mine" : ""}${fresh ? " changed" : ""}`}
              >
                <span className="profile-avatar" aria-hidden="true">
                  {initials(name)}
                </span>
                <div>
                  <strong>{mine ? t.me : name}</strong>
                  <small>{t.since({ time: format.time(hold.since) })}</small>
                </div>
                <div className="group-what">
                  <strong>{hold.title}</strong>
                  <div className="mission-evidence-paths">
                    {hold.scopes.map((scope, index) => (
                      <code key={index}>{scope}</code>
                    ))}
                  </div>
                  {hold.dependsOn?.length ? (
                    <p className="field-help">
                      {t.dependsOn.cardNote({
                        titles: format.list(
                          hold.dependsOn.map((task) => task.title),
                          { type: "conjunction" },
                        ),
                      })}
                    </p>
                  ) : null}
                  {asked === id && !gone && (
                    <div
                      className="run-list-confirm"
                      role="group"
                      aria-label={t.revokeHold({ title: hold.title })}
                    >
                      <p>{t.revokeQuestion({ name, title: hold.title })}</p>
                      <div>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={ending === id}
                          autoFocus
                          onClick={() => {
                            setAsked("");
                            setFailed(undefined);
                            focusSoon(`[data-revoke="${CSS.escape(id)}"]`);
                          }}
                        >
                          {t.keep}
                        </button>
                        <button
                          type="button"
                          className="button danger"
                          aria-disabled={ending === id}
                          onClick={() => void end(hold, false)}
                        >
                          {t.revoke}
                        </button>
                      </div>
                    </div>
                  )}
                  {failed?.id === id && (
                    <p role="alert" className="inline-error">
                      {failed.message}
                    </p>
                  )}
                </div>
                {gone ? (
                  <small>{t.gone}</small>
                ) : mine ? (
                  <div className="group-release">
                    <button
                      type="button"
                      className="button primary"
                      aria-disabled={ending === id}
                      aria-label={t.release.finishAria({ title: hold.title })}
                      onClick={() => void end(hold, true, true)}
                    >
                      {t.release.finish}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      aria-disabled={ending === id}
                      aria-label={t.release.unfinishedAria({ title: hold.title })}
                      onClick={() => void end(hold, true)}
                    >
                      {t.release.unfinished}
                    </button>
                  </div>
                ) : (
                  me.admin &&
                  asked !== id && (
                    <button
                      type="button"
                      className="button secondary"
                      data-revoke={id}
                      aria-label={t.revokeHold({ title: hold.title })}
                      onClick={() => {
                        setFailed(undefined);
                        setAsked(id);
                      }}
                    >
                      {t.revoke}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="settings-card">
          {t.nothingHeld({ time: format.time(state.asOf ?? "", seconds) })}
        </p>
      )}
      {rows.some(({ hold, gone }) => !gone && hold.holder === me.id) && (
        <p className="field-help">{t.release.finishHint}</p>
      )}
      <p className="field-help">{t.honesty}</p>
    </section>
  );
}

/** Live member progress & workspace presence (Requirement 2). */
function LiveProgressSection({ state, me }: { state: GroupState; me: Me }) {
  const collab = useT("collab");
  const t = collab.liveProgress;
  const runStatus = useT("common").runStatus;
  const format = useFormat();
  const activities = state.activities ?? [];
  return (
    <section aria-labelledby="live-progress-h">
      <div className="section-heading">
        <div>
          <h2 id="live-progress-h">
            <Activity size={16} aria-hidden="true" /> {t.title}
          </h2>
          <p>{t.subtitle}</p>
        </div>
      </div>
      {activities.length ? (
        <ul className="settings-card group-sublist" aria-labelledby="live-progress-h">
          {activities.map((item) => {
            const isMe = item.id === me.id;
            const fileLabel = item.filePath
              ? item.lineStart !== undefined
                ? t.inspectingLines({
                    path: item.filePath,
                    start: item.lineStart,
                    end: item.lineEnd ?? item.lineStart,
                  })
                : t.inspectingFile({ path: item.filePath })
              : undefined;
            return (
              <li key={item.id} className="group-subrow">
                <div className="group-subrow-main">
                  <span className="profile-avatar" aria-hidden="true">
                    {initials(item.name)}
                  </span>
                  <div>
                    <strong>{isMe ? `${item.name} (${collab.me})` : item.name}</strong>
                    <small>{format.time(item.updatedAt, seconds)}</small>
                  </div>
                  <div>
                    {item.runTitle && <strong>{item.runTitle}</strong>}
                    <div className="mission-evidence-paths">
                      {item.view && <code>{t.views[item.view]}</code>}
                      {item.runStatus && <code>{runStatus[item.runStatus]}</code>}
                      {fileLabel && <code>{fileLabel}</code>}
                    </div>
                  </div>
                </div>
                {item.runId && (
                  <a className="button secondary" href={runHref(item.runId, item.filePath)}>
                    {t.openRun}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="settings-card">{t.empty}</p>
      )}
    </section>
  );
}

/** Cross-file dependency rules & static import scanner (Requirement 1c). */
function DependencyGuardsSection({ store, state, project, me }: BoardProps) {
  const t = useT("collab").depPanel;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<CollabDependencyMode>("block");
  const [note, setNote] = useState("");
  const [scanned, setScanned] = useState<CollabDetectedImport[]>();
  const [scanning, setScanning] = useState(false);
  const request = useRequest();
  const base = `/projects/${encodeURIComponent(project)}/dependencies`;
  const rules = state.dependencies ?? [];

  const createRule = (
    ruleFrom: string,
    ruleTo: string,
    ruleMode: CollabDependencyMode,
    ruleNote?: string,
  ) =>
    void request.run(async () => {
      await store.call(
        base,
        send("POST", {
          from: ruleFrom.trim(),
          to: ruleTo.trim(),
          mode: ruleMode,
          ...(ruleNote?.trim() ? { note: ruleNote.trim() } : {}),
        }),
      );
      if (ruleFrom === from) {
        setFrom("");
        setTo("");
        setNote("");
      }
    });

  const removeRule = (depId: string) =>
    void request.run(async () => {
      await store.call(`${base}/${encodeURIComponent(depId)}`, { method: "DELETE" });
    });

  const scanImports = async () => {
    if (scanning) return;
    setScanning(true);
    request.setError("");
    try {
      const answer = await store.call<{
        dependencies: CollabFileDependency[];
        detectedImports?: CollabDetectedImport[];
      }>(`${base}?scan=1`);
      const covered = new Set(rules.map((r) => `${r.from.toLowerCase()}->${r.to.toLowerCase()}`));
      setScanned(
        (answer.detectedImports ?? []).filter(
          (edge) => !covered.has(`${edge.from.toLowerCase()}->${edge.to.toLowerCase()}`),
        ),
      );
    } catch (cause) {
      request.setError(sentenceOf(cause));
    } finally {
      setScanning(false);
    }
  };

  return (
    <section aria-labelledby="dep-guards-h">
      <div className="section-heading">
        <div>
          <h2 id="dep-guards-h">
            <GitFork size={16} aria-hidden="true" /> {t.title}
          </h2>
          <p>{t.subtitle}</p>
        </div>
        <button
          type="button"
          className="button secondary"
          aria-disabled={scanning}
          onClick={() => void scanImports()}
        >
          {scanning ? t.scanning : t.scan}
        </button>
      </div>
      <div className="settings-card">
        {rules.length ? (
          <ul className="group-sublist" aria-labelledby="dep-guards-h">
            {rules.map((rule) => (
              <li key={rule.id} className="group-subrow">
                <div>
                  <div className="mission-evidence-paths">
                    <code>
                      <Shield size={12} aria-hidden="true" />{" "}
                      {rule.mode === "block" ? t.badgeBlock : t.badgeWarn}
                    </code>
                    <code>{rule.from}</code>
                    <span>{t.arrow}</span>
                    <code>{rule.to}</code>
                  </div>
                  {rule.note && <small>{rule.note}</small>}
                </div>
                {(me.admin || rule.createdBy === me.id) && (
                  <button
                    type="button"
                    className="button secondary"
                    aria-disabled={request.busy}
                    onClick={() => removeRule(rule.id)}
                  >
                    {t.remove}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-help">{t.empty}</p>
        )}

        {scanned !== undefined && (
          <div className="group-scanned-imports">
            <h3>{t.scannedTitle({ count: scanned.length })}</h3>
            {scanned.length ? (
              <ul className="group-sublist">
                {scanned.slice(0, 20).map((edge) => {
                  const key = `${edge.from}->${edge.to}`;
                  return (
                    <li key={key} className="group-subrow">
                      <div className="mission-evidence-paths">
                        <code>{t.badgeAuto}</code>
                        <code>{edge.from}</code>
                        <span>{t.arrow}</span>
                        <code>{edge.to}</code>
                      </div>
                      <div className="group-release">
                        <button
                          type="button"
                          className="button primary"
                          aria-disabled={request.busy}
                          onClick={() => {
                            createRule(edge.from, edge.to, "block");
                            setScanned((prev) =>
                              prev?.filter((item) => !(item.from === edge.from && item.to === edge.to)),
                            );
                          }}
                        >
                          {t.promoteBlock}
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          aria-disabled={request.busy}
                          onClick={() => {
                            createRule(edge.from, edge.to, "warn");
                            setScanned((prev) =>
                              prev?.filter((item) => !(item.from === edge.from && item.to === edge.to)),
                            );
                          }}
                        >
                          {t.promoteWarn}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="field-help">{t.scannedEmpty}</p>
            )}
          </div>
        )}

        <form
          className="group-dep-form"
          onSubmit={(event) => {
            event.preventDefault();
            createRule(from, to, mode, note);
          }}
        >
          <div className="group-admin-grid">
            <div>
              <label className="field-label" htmlFor="dep-from">
                {t.fromLabel}
              </label>
              <input
                className="text-input"
                id="dep-from"
                value={from}
                maxLength={240}
                placeholder={t.fromPlaceholder}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="dep-to">
                {t.toLabel}
              </label>
              <input
                className="text-input"
                id="dep-to"
                value={to}
                maxLength={240}
                placeholder={t.toPlaceholder}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="dep-mode">
                {t.modeLabel}
              </label>
              <select
                className="text-input"
                id="dep-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as CollabDependencyMode)}
              >
                <option value="block">{t.modeBlock}</option>
                <option value="warn">{t.modeWarn}</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="dep-note">
                {t.noteLabel}
              </label>
              <input
                className="text-input"
                id="dep-note"
                value={note}
                maxLength={200}
                placeholder={t.notePlaceholder}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
          {request.error && (
            <p className="inline-error" role="alert">
              {request.error}
            </p>
          )}
          <button
            className="button secondary"
            aria-disabled={request.busy}
            disabled={!from.trim() || !to.trim()}
          >
            {t.addSubmit}
          </button>
        </form>
      </div>
    </section>
  );
}

/** Open coordination / handoff TODOs across active runs in this repository (Requirement 3c). */
function TeamTodosSection({ state }: { state: GroupState }) {
  const t = useT("collab").todoPanel;
  const todos = state.openTodos ?? [];
  return (
    <section aria-labelledby="team-todos-h">
      <div className="section-heading">
        <div>
          <h2 id="team-todos-h">
            <CheckSquare size={16} aria-hidden="true" /> {t.title}
          </h2>
          <p>{t.subtitle}</p>
        </div>
      </div>
      {todos.length ? (
        <ul className="settings-card group-sublist" aria-labelledby="team-todos-h">
          {todos.map((todo) => (
            <li key={`${todo.runId}:${todo.id}`} className="group-subrow">
              <div>
                <strong>{todo.text}</strong>
                <div className="mission-evidence-paths">
                  <code>{todo.runTitle}</code>
                  {todo.filePath && <code>{todo.filePath}</code>}
                  {todo.assigneeName && <code>{t.assignedTo({ name: todo.assigneeName })}</code>}
                  <code>{t.byAuthor({ name: todo.authorName })}</code>
                </div>
              </div>
              <a className="button secondary" href={runHref(todo.runId, todo.filePath)}>
                {t.openRun}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-card">{t.empty}</p>
      )}
    </section>
  );
}

/** Selected tasks stay visible when their unfinished hold leaves the task list. */
export function taskChoices(tasks: CollabDependency[], selected: CollabDependency[]) {
  return [
    ...tasks,
    ...selected.filter((chosen) => !tasks.some((task) => task.taskId === chosen.taskId)),
  ];
}

/** The board of one repository: Start work, Held now, Live progress, Dependency guards and Team TODOs. */
function Board(props: BoardProps) {
  const { store, state, project, held, me } = props;
  const t = useT("collab");
  const format = useFormat();
  const [title, setTitle] = useState("");
  const [paths, setPaths] = useState("");
  const [tasks, setTasks] = useState<CollabDependency[]>([]);
  const [prerequisites, setPrerequisites] = useState<CollabDependency[]>([]);
  const [answered, setAnswered] = useState<{
    asked: string;
    held: CollabHold[];
    deps: CollabFileDependency[] | undefined;
    answer: Answer;
  }>();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ text: string; dependencyPending: boolean }>();
  const titleField = useRef<HTMLInputElement>(null);
  const scopes = paths
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const asked = scopes.join("\n");
  const offline = state.link === "reconnecting";
  const answer =
    answered?.asked === asked &&
    answered.held === held &&
    answered.deps === state.dependencies
      ? answered.answer
      : undefined;
  const check = `/projects/${encodeURIComponent(project)}`;
  const choices = taskChoices(tasks, prerequisites);

  useEffect(() => {
    const request = new AbortController();
    void store
      .call<CollabTasksResponse>(`${check}/tasks`, { signal: request.signal })
      .then((answer) => {
        if (!request.signal.aborted) setTasks(answer.tasks);
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted)
          setRefusal({ text: sentenceOf(error), dependencyPending: false });
      });
    return () => request.abort();
  }, [store, check, held]);

  useEffect(() => {
    setRefusal((last) => (last?.dependencyPending ? undefined : last));
  }, [held]);

  // Asked 400 ms after the last key, and again whenever holds or dependency rules change.
  useEffect(() => {
    if (!asked || offline) {
      setAnswered(undefined);
      return;
    }
    const request = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { asOf, invalid, meets, dependencyHits } = await store.call<CollabCheckResponse>(
          `${check}/check`,
          {
            ...send("POST", { scopes: asked.split("\n"), scanImports: true }),
            signal: request.signal,
          },
        );
        if (request.signal.aborted) return;
        setRefusal(undefined);
        setAnswered({
          asked,
          held,
          deps: state.dependencies,
          answer: {
            asOf,
            invalid,
            holds: byHold(
              meets.map((meet) => {
                const hold = held.find((other) => other.claimId === meet.claimId);
                return {
                  key: meet.claimId,
                  scope: meet.scope,
                  name: meet.holder,
                  mine: hold?.holder === me.id,
                  title: meet.title,
                  since: hold?.since,
                };
              }),
            ),
            ...(dependencyHits?.length ? { dependencyHits } : {}),
          },
        });
      } catch (error) {
        if (request.signal.aborted) return;
        setAnswered(undefined);
        setRefusal({ text: sentenceOf(error), dependencyPending: false });
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [store, check, asked, held, state.dependencies, offline, me.id]);

  const take = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(undefined);
    try {
      await store.call(
        `${check}/work`,
        send("POST", {
          title: title.trim(),
          scopes,
          ...(prerequisites.length
            ? { dependsOn: prerequisites.map((task) => task.taskId) }
            : {}),
        }),
      );
      setTitle("");
      setPaths("");
      setPrerequisites([]);
      setAnswered(undefined);
      titleField.current?.focus();
    } catch (error) {
      const conflicts =
        error instanceof ApiError && reasonOf(error) === "conflict"
          ? (error.details.conflicts as CollabConflict[] | undefined)
          : undefined;
      const blockedDeps =
        error instanceof ApiError && reasonOf(error) === "dependencyBlocked"
          ? (error.details.dependencyHits as CollabDependencyHit[] | undefined)
          : undefined;
      if (conflicts?.length || blockedDeps?.length) {
        focusSoon("#hold-paths");
        const notTaken: NonNullable<typeof answered> = {
          asked,
          held,
          deps: state.dependencies,
          answer: {
            asOf: Date.now(),
            notTaken: true,
            invalid: [],
            holds: byHold(
              (conflicts ?? []).map(({ scope, holder, title, since }) => ({
                key: JSON.stringify([holder, title, since]),
                scope,
                name: holder,
                mine: held.some(
                  (hold) =>
                    hold.holder === me.id && hold.since === since && hold.scopes.includes(scope),
                ),
                title,
                since,
              })),
            ),
            ...(blockedDeps?.length ? { dependencyHits: blockedDeps } : {}),
          },
        };
        setAnswered((last) =>
          last && (last.asked !== asked || last.held !== held) ? last : notTaken,
        );
      } else
        setRefusal({
          text: sentenceOf(error),
          dependencyPending: reasonOf(error) === "dependencyPending",
        });
    } finally {
      setBusy(false);
    }
  };

  const [said, setSaid] = useState("");
  const [link, setLink] = useState(state.link);
  if (link !== state.link) {
    setLink(state.link);
    setSaid(t.spoken.sentence({ text: t[state.link] }));
  }
  const { added, ended, people } = state;
  useEffect(() => {
    const [hold] = [...added, ...ended];
    if (!hold) return;
    const words = { paths: format.list(hold.scopes, { type: "unit" }), title: hold.title };
    setSaid(
      added.length + ended.length > 1
        ? t.spoken.changed({ count: held.length })
        : ended.length
          ? t.spoken.ended(words)
          : hold.holder === me.id
            ? t.spoken.youTook(words)
            : t.spoken.took({
                ...words,
                name: people.find((person) => person.id === hold.holder)?.name ?? "",
              }),
    );
  }, [added, ended, held, people, me.id, t, format]);

  return (
    <>
      <p className="visually-hidden" aria-live="polite">
        {said} {heard(answer, t, format)}
      </p>
      <div className="team-board-content">
        <section aria-labelledby="start-h">
          <div className="section-heading">
            <h2 id="start-h">{t.startWork}</h2>
          </div>
          <form className="settings-card" onSubmit={(event) => void take(event)}>
            <label className="field-label" htmlFor="hold-title">
              {t.holdTitle} <span>{t.shownOnBoard}</span>
            </label>
            <input
              ref={titleField}
              className="text-input"
              id="hold-title"
              value={title}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
            />
            <label className="field-label" htmlFor="hold-paths">
              {t.paths} <span>{t.onePerLine}</span>
            </label>
            <textarea
              className="text-input"
              id="hold-paths"
              rows={3}
              value={paths}
              spellCheck={false}
              autoCapitalize="off"
              aria-describedby="hold-help hold-answer"
              onChange={(event) => setPaths(event.target.value)}
            />
            <p className="field-help" id="hold-help">
              {t.pathsHelp}
            </p>
            <fieldset className="group-dependencies" aria-describedby="depends-help">
              <legend className="field-label">{t.dependsOn.label}</legend>
              <p className="field-help" id="depends-help">
                {t.dependsOn.help}
              </p>
              {choices.length ? (
                <div className="draft-task-items">
                  {choices.map((task) => {
                    const checked = prerequisites.some((chosen) => chosen.taskId === task.taskId);
                    return (
                      <label key={task.taskId}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && prerequisites.length >= 50}
                          onChange={({ target }) =>
                            setPrerequisites((current) =>
                              target.checked
                                ? [...current, { taskId: task.taskId, title: task.title }]
                                : current.filter((chosen) => chosen.taskId !== task.taskId),
                            )
                          }
                        />
                        <span>{task.title}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="field-help">{t.dependsOn.empty}</p>
              )}
              {prerequisites.length > 0 && (
                <div className="group-selected">
                  <span>{t.dependsOn.selectedCount({ count: prerequisites.length })}</span>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setPrerequisites([]);
                      focusSoon("#hold-paths");
                    }}
                  >
                    {t.dependsOn.clear}
                  </button>
                </div>
              )}
            </fieldset>
            <HoldAnswer answer={answer} />
            {refusal && (
              <p className="inline-error" role="alert">
                {refusal.text}
              </p>
            )}
            <button
              className="button primary full-width"
              aria-disabled={busy}
              disabled={cannotTake(title, answer)}
            >
              {t.takeHold}
            </button>
          </form>
        </section>
        <div className="group-board-main">
          <HeldNow {...props} />
          <LiveProgressSection state={state} me={me} />
          <DependencyGuardsSection {...props} />
          <TeamTodosSection state={state} />
        </div>
      </div>
    </>
  );
}

export function GroupPage({ status }: { status: Status | null }) {
  const t = useT("collab");
  const format = useFormat();
  const [store] = useState(createGroupStore);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const on = Boolean(status?.collab);
  useEffect(() => {
    if (!on) return;
    store.open();
    return store.close;
  }, [store, on]);
  const [inviting, setInviting] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
  const [editingAccount, setEditingAccount] = useState(false);
  const adding = useRequest();
  const addable = useRef<HTMLSelectElement>(null);
  const add = (repoId: string) =>
    void adding.run(() => store.add(repoId).then(() => focusSoon(".group-page h1")));

  const { info, projects, held } = state;
  const me = on && info?.state === "ready" ? info.me : undefined;
  const project = me && projects?.find((item) => item.id === state.project);
  const forget = adding.setError;
  useEffect(() => forget(""), [forget, project?.id, me?.id]);
  const canInvite = me && (me.admin || info?.host);
  const people = state.people.filter((person) => !person.removed);
  const circles = people.length > 4 ? people.slice(0, 3) : people;
  const nameOf = (person: (typeof people)[number]) => {
    const name = person.id === me?.id ? t.you({ name: person.name }) : person.name;
    return state.present.includes(person.id) ? t.viewing({ name }) : name;
  };

  let card: ReactNode = null;
  if (!on) {
    card = status && (
      <div className="settings-card">
        <div className="section-heading">
          <div>
            <h2>{t.off.title}</h2>
            <p>{t.off.body}</p>
          </div>
        </div>
        <CopyCommand command={`${product.binNames[0]} start --group`} />
      </div>
    );
  } else if (info?.state === "stopped") {
    card = (
      <div className="settings-card" role="alert">
        <div className="section-heading">
          <h2>{t.stopped.title}</h2>
        </div>
        <p className="inline-error">{t.stopped.body}</p>
      </div>
    );
  } else if (info && !me) {
    card = info.host || info.canBootstrap ? (
      <BootstrapAdminCard store={store} info={info} refused={state.refused} />
    ) : info.state === "notSetUp" ? (
      <p className="settings-card">{t.setUpAtHost}</p>
    ) : (
      <JoinAuthCard store={store} info={info} refused={state.refused} />
    );
  } else if (me && projects?.length === 0) {
    card = state.addable?.length ? (
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          add(addable.current!.value);
        }}
      >
        <div className="section-heading">
          <div>
            <h2>{t.addARepository}</h2>
            <p>{t.firstRepository}</p>
          </div>
        </div>
        <label className="field-label" htmlFor="add-repo">
          {t.repository}
        </label>
        <select ref={addable} className="text-input" id="add-repo" aria-disabled={adding.busy}>
          {state.addable.map((repo) => (
            <option key={repo.repoId} value={repo.repoId}>
              {repo.name}
            </option>
          ))}
        </select>
        {adding.busy && (
          <p className="field-help import-cloning" role="status">
            {t.adding}
          </p>
        )}
        {adding.error && (
          <p className="inline-error" role="alert">
            {adding.error}
          </p>
        )}
        <button className="button primary full-width" aria-disabled={adding.busy}>
          {t.addRepository}
        </button>
      </form>
    ) : (
      <p className="settings-card">{me.admin ? t.nothingToAdd : t.noRepository}</p>
    );
  } else if (!held && state.link === "reconnecting") {
    card = (
      <p className="settings-card" role="status">
        {t.reconnecting}
      </p>
    );
  }

  return (
    <section className="page-content group-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1 tabIndex={-1}>{t.title}</h1>
          {project && (
            <div className="repo-meta">
              <span>
                <FolderGit2 size={13} aria-hidden="true" />
                {projects!.length > 1 || state.addable?.length ? (
                  <select
                    className="sidebar-language-select"
                    aria-label={t.repository}
                    value={project.id}
                    aria-disabled={adding.busy}
                    onChange={({ target: { value } }) => {
                      if (adding.busy) return;
                      if (projects!.some((item) => item.id === value)) store.choose(value);
                      else add(value.slice(1));
                    }}
                  >
                    {projects!.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                    {state.addable?.length ? (
                      <optgroup label={t.addARepository}>
                        {state.addable.map((repo) => (
                          <option key={repo.repoId} value={`+${repo.repoId}`}>
                            {repo.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                ) : (
                  project.name
                )}
              </span>
              {held && (
                <>
                  <i />
                  <span className={`status-badge${state.link === "reconnecting" ? " error" : ""}`}>
                    <span />
                    {t[state.link]}
                  </span>
                  <span>{t.asOf({ time: format.time(state.asOf ?? "", seconds) })}</span>
                </>
              )}
            </div>
          )}
        </div>
        {(project || me) && (
          <div className="group-people" role="group" aria-label={t.people}>
            {circles.map((person) => (
              <span
                key={person.id}
                className={`profile-avatar${state.present.includes(person.id) ? " here" : ""}`}
                role="img"
                tabIndex={0}
                aria-label={nameOf(person)}
              >
                {initials(person.name)}
              </span>
            ))}
            {people.length > circles.length && (
              <span
                className="profile-avatar"
                role="img"
                tabIndex={0}
                aria-label={format.list(people.slice(circles.length).map(nameOf), { type: "unit" })}
              >
                +{people.length - circles.length}
              </span>
            )}
            {me && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditingAccount(true)}
              >
                <KeyRound size={15} aria-hidden="true" />
                {t.myAccount}
              </button>
            )}
            {me?.admin && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setManagingMembers(true)}
              >
                <Users size={15} aria-hidden="true" />
                {t.manageMembers}
              </button>
            )}
            {canInvite && (
              <button type="button" className="button secondary" onClick={() => setInviting(true)}>
                <UserPlus size={15} aria-hidden="true" />
                {t.invite}
              </button>
            )}
          </div>
        )}
      </div>
      {project && adding.busy && (
        <p className="field-help import-cloning" role="status">
          {t.adding}
        </p>
      )}
      {project && adding.error && (
        <p className="inline-error" role="alert">
          {adding.error}
        </p>
      )}
      {project && me && held ? (
        <Board
          key={project.id}
          store={store}
          state={state}
          project={project.id}
          held={held}
          me={me}
        />
      ) : (
        card
      )}
      {inviting && canInvite && <InviteDialog store={store} onClose={() => setInviting(false)} />}
      {editingAccount && me && (
        <AccountDialog store={store} me={me} onClose={() => setEditingAccount(false)} />
      )}
      {managingMembers && me?.admin && (
        <AdminMembersDialog store={store} me={me} onClose={() => setManagingMembers(false)} />
      )}
    </section>
  );
}
