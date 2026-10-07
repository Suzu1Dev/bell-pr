import type {
  ContributionRecommendation,
  RecommendationPreferences,
} from "../../shared/insights";

export function orderedRecommendations(
  recommendations: ContributionRecommendation[],
  preferences: RecommendationPreferences,
) {
  const byId = new Map(recommendations.map((idea) => [idea.id, idea]));
  const ids = [...new Set([...preferences.order, ...byId.keys()])];
  return ids.flatMap((id) => {
    const idea = byId.get(id);
    return idea ? [idea] : [];
  });
}

export function moveRecommendation(
  orderedIds: string[],
  hiddenIds: string[],
  sourceId: string,
  targetId: string,
  side: "before" | "after",
) {
  const hidden = new Set(hiddenIds);
  const visible = orderedIds.filter((id) => !hidden.has(id));
  if (
    sourceId === targetId ||
    !visible.includes(sourceId) ||
    !visible.includes(targetId)
  ) {
    return orderedIds;
  }
  const reordered = visible.filter((id) => id !== sourceId);
  reordered.splice(
    reordered.indexOf(targetId) + (side === "after" ? 1 : 0),
    0,
    sourceId,
  );
  let index = 0;
  // Keep hidden cards in their saved slots so restoring one does not move it.
  return orderedIds.map((id) => (hidden.has(id) ? id : reordered[index++]));
}
