export default {
  fullAccessNotice: "This Claude agent ran without the OS sandbox because full access was selected for this run.",
  busy: "Passwordless sudo is being configured. Please wait.",
  invalidUser: "This account name cannot safely be written to a sudoers rule.",
  invalidRule: "The sudoers rule failed visudo validation and was not installed.",
  overridden: "Another sudoers rule may override this rule: sudo still asks for a password, so the new rule was removed.",
  removeManually: ({ file }: { file: string }) => `Removal needs a password. In a terminal, run sudo rm ${file}`,
  locked: ({ minutes }: { minutes: number }) => `After three incorrect passwords, setup is paused. Try again in ${minutes} minutes.`,
  forbidden: "This account cannot use sudo, so passwordless sudo cannot be enabled.",
  wrongPassword: ({ remaining, minutes }: { remaining: number; minutes: number }) => `Incorrect password. After ${remaining} more incorrect attempts, setup pauses for ${minutes} minutes.`,
  failed: ({ detail }: { detail: string }) => `sudo failed: ${detail}`,
};
