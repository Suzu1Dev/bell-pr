// The release constant defaults to off. The suite still exercises Codex,
// so tests opt in here. Cases that cover the off switch set it back.
import { setCodexEnabledForTests } from "../shared/codex-switch.ts";

setCodexEnabledForTests(true);
