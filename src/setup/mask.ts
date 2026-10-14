/**
 * Presentation masking for environment checks. A passing row's detail is
 * the person's own account (the GitHub login, the agent CLI's account, the
 * Git "Name <e-mail>"), so it is masked whole. A row with a problem keeps
 * its explanation, and only the e-mail addresses the check names (the
 * address Git guessed, the suggested no-reply address) are masked, in the
 * detail and in the fix commands.
 */
import type { DoctorCheck, DoctorCheckId } from "../../shared/doctor";

/** Checks whose detail names the person when they pass. */
const userDetails: readonly DoctorCheckId[] = [
  "gh-auth",
  "claude-auth",
  "codex-auth",
  "git-identity",
];

/** The addresses `checks` name, longest first. */
function personalValues(checks: readonly DoctorCheck[]): string[] {
  return checks
    .flatMap((check) => [check.params?.email, check.params?.noreply])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);
}

/** `text` with each address that `checks` name masked. */
export function maskCheckValues(
  text: string,
  checks: readonly DoctorCheck[],
  maskUser: (value: string) => string,
): string {
  let masked = text;
  for (const value of personalValues(checks))
    masked = masked.split(value).join(maskUser(value));
  return masked;
}

/** The detail to show for `check`, masked by `maskUser`. */
export function maskedDetail(
  check: DoctorCheck,
  maskUser: (value: string) => string,
): string | undefined {
  if (!check.detail) return check.detail;
  if (check.status === "ok" && userDetails.includes(check.id))
    return maskUser(check.detail);
  return maskCheckValues(check.detail, [check], maskUser);
}
