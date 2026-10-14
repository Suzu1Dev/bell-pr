import type { TeamTaskStatus } from "../../shared/team";

/** Stable ids of the task board's lanes; labels and messages are looked up by id. */
export type TeamLaneId = "todo" | "running" | "done";

export interface TeamLane {
  id: TeamLaneId;
  /** The task statuses shown in this lane. */
  states: readonly TeamTaskStatus[];
}

/** The task board's lanes in display order. Failed tasks sit in the done lane. */
export const teamLanes: readonly TeamLane[] = [
  { id: "todo", states: ["pending", "ready", "blocked"] },
  { id: "running", states: ["running"] },
  { id: "done", states: ["complete", "failed"] },
];
