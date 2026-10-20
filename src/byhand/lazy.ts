/**
 * The one lazy chunk of Learn by hand (DESIGN v1.2 §11.1). Each mount loads
 * it as
 *
 *   lazy(() => import("../byhand/lazy").then((m) => ({ default: m.GuidePanel })))
 *
 * inside the existing ErrorBoundary and Suspense, with a fixed-height
 * Loader2 fallback. The chunk imports nothing from src/demo/** or the
 * src/review barrel, imports shared modules as types, and keeps its
 * dictionaries module-local (write/i18n, record/i18n).
 */
export { PlanWithGuide, type PlanWithGuideProps } from "./write/PlanWithGuide";
export { YourTurn, type YourTurnProps } from "./write/YourTurn";
export { GuidePanel, type GuidePanelProps } from "./write/GuidePanel";
export { ReadyDialog, type ReadyDialogProps } from "./write/ReadyDialog";
export { ByHandRecord, type ByHandRecordProps } from "./record/ByHandRecord";
export { DraftHelpers, type DraftHelpersProps } from "./record/DraftHelpers";
