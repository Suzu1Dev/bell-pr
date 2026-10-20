/**
 * The project's own rules for the "Before you contribute" card (DESIGN
 * §5.1, F7): the policy files at the clone's commit, read locally with
 * `git ls-tree` and `git show` (no network), one hop of in-repository links
 * from CONTRIBUTING, the account's default files from `<owner>/.github`
 * (as the PR draft reads them), and the `.gitattributes` patterns of
 * generated files (for reviewability, F9). Each file's raw text, HTML
 * comments kept, goes through the shared classifier (`classifyPolicy`);
 * the PR draft keeps reading its rules without comments
 * (`markdownProse`), so only this card sees what comments say.
 */
import path from "node:path";
import type { HelpChannel, PolicyFinding, PolicyKind } from "../shared/contribution.js";
import { attachCarveOuts, classifyPolicy, rawProse } from "../shared/project-policy.js";
import {
  accountDefaults,
  defaultsKind,
  documentKind,
  parseTree,
  priority,
  type DocumentKind,
  type Entry,
} from "./draft-sources.js";
import { safeRelativePath, sensitivePath } from "./git.js";
import { git, redact } from "./process.js";

/** Limits of the stored rules (`Repository.contributionRules`). */
export const policyLimits = {
  findings: 30,
  filesRead: 60,
  generated: 30,
  /** Links followed from CONTRIBUTING (one hop). */
  linked: 10,
  /** Bytes of one file; larger files are left out. */
  fileBytes: 128_000,
} as const;

/** One file the rules were read from, as the card names it. */
export interface PolicyDocument {
  /** The repository path, or `<owner>/.github/<path>` for an account default. */
  path: string;
  content: string;
  kind: DocumentKind;
}

/**
 * The files the rules card reads: the PR draft's guidance files
 * (`documentKind`) except the README, which describes the software rather
 * than how to contribute to it.
 */
export function policyFile(filePath: string) {
  const kind = documentKind(filePath);
  if (!kind) return undefined;
  const stem = filePath
    .split("/")
    .at(-1)!
    .toLowerCase()
    .replace(/\.(?:md|markdown|rst|txt|adoc|org)$/, "");
  return stem === "readme" ? undefined : kind;
}

/** NUL bytes or undecodable text: not a document. */
const binary = (content: string) => content.includes("\0") || content.includes("\ufffd");

/** Text files a link may lead to: Markdown, reStructuredText, AsciiDoc, plain text. */
const linkedText = /\.(?:md|markdown|rst|txt|adoc)$/i;

/**
 * The in-repository files a CONTRIBUTING file links to: Markdown inline and
 * reference links, reStructuredText links, and links to this repository on
 * GitHub. A leading `/` is the repository root; anything else is relative
 * to the linking file. Paths outside the repository, to sensitive files or
 * to anything but a text document are left out.
 */
export function linkedPaths(
  from: string,
  content: string,
  repository?: string,
): string[] {
  const targets = [
    ...[...content.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g)].map((match) => match[1]),
    ...[...content.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)].map((match) => match[1]),
    ...[...content.matchAll(/`[^`<]*<([^>`]+)>`_{1,2}/g)].map((match) => match[1]),
  ];
  const own = repository
    ? new RegExp(
        `^https://github\\.com/${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/blob/[^/]+/(.+)$`,
        "i",
      )
    : undefined;
  const found: string[] = [];
  for (const raw of targets) {
    let target = raw.replace(/[#?].*$/, "");
    const github = own?.exec(target);
    if (github) target = `/${github[1]}`;
    else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      continue;
    }
    if (!target) continue;
    const resolved = target.startsWith("/")
      ? path.posix.normalize(target.slice(1))
      : path.posix.join(path.posix.dirname(from), target);
    if (
      !resolved ||
      resolved.startsWith("..") ||
      !safeRelativePath(resolved) ||
      sensitivePath(resolved) ||
      !linkedText.test(resolved) ||
      found.includes(resolved)
    )
      continue;
    found.push(resolved);
  }
  return found;
}

/**
 * The `linguist-generated` patterns of a `.gitattributes` file: the paths
 * GitHub (and BELL's reviewability snapshot) treat as generated output.
 */
export function generatedPatterns(content: string): string[] {
  const patterns: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const [pattern, ...attributes] = line.trim().split(/\s+/);
    if (!pattern || pattern.startsWith("#") || pattern.length > 200) continue;
    if (
      attributes.some(
        (attribute) =>
          attribute === "linguist-generated" ||
          attribute === "linguist-generated=true",
      ) &&
      !patterns.includes(pattern)
    )
      patterns.push(pattern);
  }
  return patterns.slice(0, policyLimits.generated);
}

/** What the card keeps first when a project states more than 30 rules. */
const weight = (finding: PolicyFinding) =>
  finding.kind === "ban" && finding.contribution
    ? 0
    : ((
        {
          area: 1,
          disclose: 2,
          "own-words": 3,
          understand: 4,
          "issue-first": 5,
          agent: 6,
          ban: 7,
        } satisfies Record<PolicyKind, number>
      )[finding.kind] ?? 8);

/** A quote as the card stores it: checked for credentials, 300 characters or fewer. */
const storedQuote = (quote: string) => redact(quote).slice(0, 300);

/**
 * The rules of the documents, in reading order, each quote checked for
 * credentials. A ban or reserved-issue rule carries the carve-outs of its
 * own document (`attachCarveOuts`, DESIGN v1.2 F12). Over 30, the ones
 * that block publishing stay (explicit bans, reserved areas, disclosures)
 * and the rest make room.
 */
export function policyFindings(documents: readonly PolicyDocument[]): PolicyFinding[] {
  const all = documents.flatMap((document) =>
    attachCarveOuts(document.path, document.content, classifyPolicy(document.path, document.content)).map(
      (finding) => ({
        ...finding,
        quote: storedQuote(finding.quote),
        ...(finding.allows
          ? { allows: finding.allows.map((allowance) => ({ ...allowance, quote: storedQuote(allowance.quote) })) }
          : {}),
      }),
    ),
  );
  if (all.length <= policyLimits.findings) return all;
  const kept = new Set(
    all
      .map((finding, index) => ({ finding, index }))
      .sort((a, b) => weight(a.finding) - weight(b.finding) || a.index - b.index)
      .slice(0, policyLimits.findings)
      .map(({ index }) => index),
  );
  return all.filter((_, index) => kept.has(index));
}

/** At most this many of the project's help channels are kept (`ContributionRules.channels`). */
const maxChannels = 5;

/**
 * Where the project's people talk, by address: Zulip, Discord invites,
 * Discourse forums (a `discourse.` host or a `/c/` category path),
 * Matrix, mailing lists (`lists.` hosts, Mailman, Google Groups), Gitter,
 * and the repository's own GitHub Discussions.
 */
function channelAddress(url: URL, repository?: string) {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  const path = pathname.replace(/\/+$/, "");
  return (
    host.endsWith(".zulipchat.com") ||
    (/^(?:www\.)?discord\.gg$/.test(host) && path.length > 1) ||
    (/^(?:www\.)?discord(?:app)?\.com$/.test(host) && /^\/invite\/[^/]+/.test(path)) ||
    host.startsWith("discourse.") ||
    pathname.startsWith("/c/") ||
    host === "matrix.to" ||
    host.startsWith("lists.") ||
    `${host}${pathname}`.includes("mailman") ||
    host === "groups.google.com" ||
    host === "gitter.im" ||
    host === "app.gitter.im" ||
    (!!repository &&
      /^(?:www\.)?github\.com$/.test(host) &&
      path.startsWith(`/${repository.toLowerCase()}/discussions`))
  );
}

/** Characters that end a bare address in prose: closing brackets and quotes are not part of it. */
const addressPattern = /https?:\/\/[^\s<>()[\]"'`*]+/gi;

/**
 * The project's own human help channels in the files the card read (DESIGN
 * v1.2 F14), in reading order: at most 5, each with the file and line
 * that names it, and the words the file links it with (else its host and
 * path). Fenced code is left out. `repository` (owner/name) lets the
 * repository's own GitHub Discussions count.
 */
export function channelLinks(documents: readonly PolicyDocument[], repository?: string): HelpChannel[] {
  const channels: HelpChannel[] = [];
  for (const document of documents)
    for (const { line, text } of rawProse(document.content))
      for (const match of text.matchAll(addressPattern)) {
        const address = match[0].replace(/[.,;:!?]+$/, "");
        let url: URL;
        try {
          url = new URL(address);
        } catch {
          continue;
        }
        if (!channelAddress(url, repository) || address.length > 300) continue;
        const key = address.replace(/\/+$/, "").toLowerCase();
        if (channels.some((channel) => channel.url.replace(/\/+$/, "").toLowerCase() === key)) continue;
        // "[the forum](https://…)" or "`the forum <https://…>`_": the file's own words for it.
        const before = text.slice(0, match.index);
        const named =
          /\[([^\]]{1,120})\]\(\s*<?$/.exec(before)?.[1] ?? /`([^`<]{1,120}?)\s*<$/.exec(before)?.[1];
        const label = (named ?? `${url.host}${url.pathname.replace(/\/+$/, "")}`)
          .replace(/[*_`]+/g, "")
          .trim()
          .slice(0, 80);
        channels.push({ label: label || url.host, url: address, path: document.path, line });
        if (channels.length >= maxChannels) return channels;
      }
  return channels;
}

export interface LocalPolicy {
  /** The commit the files were read at. */
  baseSha: string;
  documents: PolicyDocument[];
  generated: string[];
  /** The community files the repository has itself (`defaultsKind`); account defaults fill only the others. */
  kinds: Set<DocumentKind>;
}

/**
 * Reads the policy files of the repository at `repoPath` at its checked-out
 * commit, without the network: by name (`policyFile`), then the in-repo
 * files CONTRIBUTING links to, and the `.gitattributes` patterns.
 * `repository` (owner/name) lets a link to this repository on GitHub count
 * as a local one. Files over 128 KB, binary files and anything but regular
 * files are left out; at most 60 files are read. Rejects when Git cannot
 * read the commit.
 */
export async function readLocalPolicy(
  repoPath: string,
  options: { repository?: string; signal?: AbortSignal } = {},
): Promise<LocalPolicy> {
  const baseSha = (
    await git(repoPath, ["rev-parse", "--verify", "HEAD^{commit}"], {
      signal: options.signal,
    })
  ).stdout.trim();
  const tree = parseTree(
    (
      await git(repoPath, ["ls-tree", "--full-tree", "-r", "-l", "-z", baseSha], {
        signal: options.signal,
        maxBytes: 64_000_000,
      })
    ).stdout,
  );
  const files = new Map(
    tree
      .filter(
        (entry) =>
          entry.type === "blob" &&
          ["100644", "100755"].includes(entry.mode) &&
          Number.isSafeInteger(entry.size) &&
          entry.size >= 0 &&
          entry.size <= policyLimits.fileBytes,
      )
      .map((entry) => [entry.path, entry]),
  );
  const show = async (entry: Entry) =>
    (
      await git(
        repoPath,
        ["show", "--no-ext-diff", "--no-textconv", `${baseSha}:${entry.path}`],
        { signal: options.signal, maxBytes: policyLimits.fileBytes + 2_000 },
      )
    ).stdout;
  const documents: PolicyDocument[] = [];
  const kinds = new Set<DocumentKind>();
  const read = async (entry: Entry, kind: DocumentKind) => {
    if (documents.length >= policyLimits.filesRead) return;
    if (documents.some((document) => document.path === entry.path)) return;
    const content = await show(entry);
    // Binary files are not guidance.
    if (binary(content)) return;
    documents.push({ path: entry.path, content, kind });
  };
  const named = tree
    .filter((entry) => policyFile(entry.path))
    .sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  for (const entry of named) {
    const own = defaultsKind(entry.path);
    if (own) kinds.add(own);
    const file = files.get(entry.path);
    if (file) await read(file, policyFile(entry.path)!);
  }
  // One hop of links from CONTRIBUTING, inside the repository only.
  let linked = 0;
  for (const document of [...documents]) {
    if (!/^contributing(?:\.[^/]*)?$/i.test(document.path.split("/").at(-1)!)) continue;
    for (const target of linkedPaths(document.path, document.content, options.repository)) {
      const entry = files.get(target);
      if (!entry || linked >= policyLimits.linked) continue;
      const before = documents.length;
      await read(entry, policyFile(target) ?? "documentation");
      if (documents.length > before) linked++;
    }
  }
  const attributes = files.get(".gitattributes");
  const generated = attributes ? generatedPatterns(await show(attributes)) : [];
  return { baseSha, documents, generated, kinds };
}

/**
 * The account's default CONTRIBUTING and pull request templates from
 * `<owner>/.github`, for the kinds the repository lacks, the way GitHub
 * shows them on the repository (and the PR draft reads them). Undefined
 * when the account has none or they are not public; rejects when GitHub
 * cannot be read.
 */
export async function readAccountPolicy(
  owner: string,
  missing: (kind: DocumentKind) => boolean,
  github: Parameters<typeof accountDefaults>[2],
  room: number,
): Promise<{ repository: string; documents: PolicyDocument[] } | undefined> {
  const defaults = await accountDefaults(
    owner,
    (kind) => (kind === "contributing" || kind === "template") && missing(kind),
    github,
  );
  if (defaults.status !== "found") return undefined;
  const documents: PolicyDocument[] = [];
  for (const entry of defaults.entries) {
    if (documents.length >= room) break;
    if (!Number.isSafeInteger(entry.size) || entry.size > policyLimits.fileBytes) continue;
    const content = await defaults.read(entry);
    if (binary(content)) continue;
    documents.push({
      path: `${owner}/.github/${entry.path}`,
      content,
      kind: documentKind(entry.path)!,
    });
  }
  return { repository: `${owner}/.github`, documents };
}
