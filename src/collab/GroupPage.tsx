/**
 * The Group page (#/group): who is here, what is held in one repository and
 * whether the paths you want are free. The board comes from the store
 * (./store.ts). A refusal is the server's own sentence, shown as text where
 * the action was taken.
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { FolderGit2, Info, TriangleAlert, UserPlus } from "lucide-react";
import type {
  CollabCheckResponse,
  CollabConflict,
  CollabHold,
  CollabInfo,
  CollabInviteResponse,
} from "../../shared/collab";
import type { Formatters } from "../../shared/i18n/locale";
import { product } from "../../shared/product";
import { ApiError, send } from "../api";
import type { Status } from "../app/hooks/useAppData";
import { useFormat, useT, type Messages } from "../i18n";
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

/** The answer's sentences: what cannot be held, then one for each hold in the way. */
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

/** Whether Take hold is off: no title, no answer, or something in the way. */
export const cannotTake = (title: string, answer?: Answer) =>
  !title.trim() || !answer || answer.holds.length > 0 || answer.invalid.length > 0;

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

/** A state shown as one card with one field and one button: joining, and the first set-up at the host. */
function FieldCard({
  words,
  label,
  refused,
  action,
  ...field
}: {
  words: { title: string; body: string; submit: string };
  label: ReactNode;
  /** The server's sentence from before the card was shown. */
  refused?: string;
  action: (value: string) => Promise<unknown>;
} & InputHTMLAttributes<HTMLInputElement>) {
  const [value, setValue] = useState("");
  const request = useRequest();
  const error = request.error || refused;
  return (
    <form
      className="settings-card"
      onSubmit={(event) => {
        event.preventDefault();
        // The card goes with a start or a join: the page's heading takes the focus.
        void request.run(() => action(value.trim()).then(() => focusSoon(".group-page h1")));
      }}
    >
      <div className="section-heading">
        <div>
          <h2>{words.title}</h2>
          <p>{words.body}</p>
        </div>
      </div>
      <label className="field-label" htmlFor={field.id}>
        {label}
      </label>
      <input
        className="text-input"
        value={value}
        autoComplete="off"
        aria-describedby={error ? "card-error" : undefined}
        onChange={(event) => setValue(event.target.value)}
        {...field}
      />
      {error && (
        <p className="inline-error" role="alert" id="card-error">
          {error}
        </p>
      )}
      <button
        className="button primary full-width"
        aria-disabled={request.busy}
        disabled={!value.trim()}
      >
        {words.submit}
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
    // A key for each step: the dialog moves the focus to the step's first control.
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
  /** The hold an admin is asked about before it is revoked. */
  const [asked, setAsked] = useState("");
  const [ending, setEnding] = useState("");
  const [failed, setFailed] = useState<{ id: string; message: string }>();

  useEffect(() => {
    const focused = list.current?.contains(document.activeElement) ?? false;
    // Nothing moves under the pointer or the focus: an ended hold keeps its row until both have left.
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
    // The focused button went away with its hold: the list takes the focus.
    if (focused) focusSoon(".group-holds:not(:focus-within)");
  }, [held]);

  /** Once the pointer and the focus have both left the list, the ended holds go. */
  const settle = (stay: boolean) => {
    if (!stay) setRows((shown) => shown.filter((row) => !row.gone));
  };

  const end = async (hold: CollabHold, mine: boolean) => {
    if (ending === hold.claimId) return;
    setEnding(hold.claimId);
    setFailed(undefined);
    try {
      await store.call(
        `/projects/${encodeURIComponent(project)}/holds/${encodeURIComponent(hold.claimId)}/${mine ? "release" : "revoke"}`,
        send("POST", mine ? { fence: hold.fence } : {}),
      );
      setAsked("");
      // The row's button goes with the hold.
      list.current?.focus();
    } catch (error) {
      // The hold in hand is not the current one: the board is asked for again.
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
                  <button
                    type="button"
                    className="button secondary"
                    aria-disabled={ending === id}
                    aria-label={t.releaseHold({ title: hold.title })}
                    onClick={() => void end(hold, true)}
                  >
                    {t.release}
                  </button>
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
      <p className="field-help">{t.honesty}</p>
    </section>
  );
}

/** The board of one repository: Start work, which asks before it takes, and Held now. */
function Board(props: BoardProps) {
  const { store, state, project, held, me } = props;
  const t = useT("collab");
  const format = useFormat();
  const [title, setTitle] = useState("");
  const [paths, setPaths] = useState("");
  /** The last answer, with the paths and the board it is about: it shows for those only. */
  const [answered, setAnswered] = useState<{ asked: string; held: CollabHold[]; answer: Answer }>();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const titleField = useRef<HTMLInputElement>(null);
  const scopes = paths
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const asked = scopes.join("\n");
  const offline = state.link === "reconnecting";
  const answer =
    answered?.asked === asked && answered.held === held ? answered.answer : undefined;
  const check = `/projects/${encodeURIComponent(project)}`;

  // Asked 400 ms after the last key, and again whenever the board changes.
  useEffect(() => {
    if (!asked || offline) {
      setAnswered(undefined);
      return;
    }
    const request = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { asOf, invalid, meets } = await store.call<CollabCheckResponse>(`${check}/check`, {
          ...send("POST", { scopes: asked.split("\n") }),
          signal: request.signal,
        });
        // An answer for paths or a board that are no longer the ones on the page is dropped.
        if (request.signal.aborted) return;
        setRefusal("");
        setAnswered({
          asked,
          held,
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
          },
        });
      } catch (error) {
        if (request.signal.aborted) return;
        // No answer, so no box; the sentence says why.
        setAnswered(undefined);
        setRefusal(sentenceOf(error));
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [store, check, asked, held, offline, me.id]);

  const take = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal("");
    try {
      await store.call(`${check}/work`, send("POST", { title: title.trim(), scopes }));
      // The row arrives with the feed.
      setTitle("");
      setPaths("");
      setAnswered(undefined);
      titleField.current?.focus();
    } catch (error) {
      const conflicts =
        error instanceof ApiError && reasonOf(error) === "conflict"
          ? (error.details.conflicts as CollabConflict[] | undefined)
          : undefined;
      if (conflicts?.length) {
        // The button goes off with the hold in the way: the paths take the focus.
        focusSoon("#hold-paths");
        const notTaken: NonNullable<typeof answered> = {
          asked,
          held,
          answer: {
            asOf: Date.now(),
            notTaken: true,
            invalid: [],
            holds: byHold(
              conflicts.map(({ scope, holder, title, since }) => ({
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
          },
        };
        // An answer that came meanwhile, for other paths or a newer board, stays.
        setAnswered((last) =>
          last && (last.asked !== asked || last.held !== held) ? last : notTaken,
        );
      } else setRefusal(sentenceOf(error));
    } finally {
      setBusy(false);
    }
  };

  // One sentence for each batch of changes on the board, and one when the connection changes.
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
            <HoldAnswer answer={answer} />
            {refusal && (
              <p className="inline-error" role="alert">
                {refusal}
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
        <HeldNow {...props} />
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
  const adding = useRequest();
  const addable = useRef<HTMLSelectElement>(null);
  /** Adds a repository. Its card goes, or the picker changes: the page's heading takes the focus. */
  const add = (repoId: string) =>
    void adding.run(() => store.add(repoId).then(() => focusSoon(".group-page h1")));

  const { info, projects, held } = state;
  const me = on && info?.state === "ready" ? info.me : undefined;
  const project = me && projects?.find((item) => item.id === state.project);
  // A failed add's sentence goes with the card or the board it was said beside.
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
    card = info.host ? (
      <FieldCard
        id="host-name"
        words={t.host}
        label={
          <>
            {t.host.name} <span>{t.shownOnBoard}</span>
          </>
        }
        refused={state.refused}
        maxLength={40}
        action={store.start}
      />
    ) : info.state === "notSetUp" ? (
      <p className="settings-card">{t.setUpAtHost}</p>
    ) : (
      <FieldCard
        id="join-code"
        words={t.join}
        label={t.join.code}
        refused={state.refused}
        maxLength={32}
        autoCapitalize="characters"
        spellCheck={false}
        action={store.join}
      />
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
    // No answer yet, and the last request failed: the page says that it is trying.
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
              {/* The picker stays while the board of the repository just chosen is on its way. */}
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
        {(project || canInvite) && (
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
    </section>
  );
}
