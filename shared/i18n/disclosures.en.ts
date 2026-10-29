/**
 * Approved disclosure sentences for Full access and passwordless sudo.
 * docs/security-model.md quotes these English strings.
 */
export const fullAccessDisclosure =
  "\"Full access\" is off by default. It turns off the OS sandbox and the credential deny rules for roles that write files, so those agents can read `~/.git-credentials` and `~/.ssh` and run `gh`, `git push`, and `curl`. Read-only roles keep their limits. Only the removal of `GH_TOKEN`/`GITHUB_TOKEN` from the environment still applies. Use it only in a throwaway VM or container.";

export const sudoDisclosure =
  "\"Passwordless sudo\" (Linux only) is off by default. It lets every process under your user account, including the agent, run any command as root without a password and read every file on that machine, including tokens and SSH keys. Use it only in a throwaway VM or container.";
