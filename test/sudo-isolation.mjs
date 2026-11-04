// No test may read or change the real sudoers rule: the doctor looks at a
// file that does not exist, and startServer skips the sudo cleanup.
import os from "node:os";
import path from "node:path";
import { sudoTestOverrides } from "../server/sudo-test-overrides.ts";

sudoTestOverrides.doctorSudoersFile = path.join(os.tmpdir(), "bell-pr-test-no-sudoers", "bell-pr-agent");
sudoTestOverrides.skipStartupCleanup = true;
