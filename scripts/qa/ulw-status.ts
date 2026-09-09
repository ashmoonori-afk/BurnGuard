import path from "node:path";

export const ULW_SESSION_ID = "burnguard-mass-ulw-research-20260825";

export type UlwStatus = { readonly currentAttemptDir: string };

export function parseUlwStatus(raw: string): UlwStatus {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) {
    throw new TypeError("ULW status is not an object");
  }
  if (
    "currentAttemptDir" in value &&
    typeof value.currentAttemptDir === "string"
  ) {
    return { currentAttemptDir: value.currentAttemptDir };
  }
  if (!("plan" in value) || typeof value.plan !== "object" || value.plan === null) {
    throw new TypeError("ULW status has no plan");
  }
  const goals = "goals" in value.plan && Array.isArray(value.plan.goals)
    ? value.plan.goals.filter(
      (goal): goal is { readonly id: string; readonly attempt: number; readonly status: string } =>
        typeof goal === "object" &&
        goal !== null &&
        "id" in goal &&
        typeof goal.id === "string" &&
        "attempt" in goal &&
        Number.isSafeInteger(goal.attempt) &&
        goal.attempt > 0 &&
        "status" in goal &&
        typeof goal.status === "string",
    )
    : [];
  const goal = goals.find((candidate) =>
    candidate.status === "in_progress" || candidate.status === "pending"
  ) ?? goals.at(-1);
  if (goal === undefined) {
    throw new TypeError("ULW status has no valid goal attempt");
  }
  return {
    currentAttemptDir: path.posix.join(
      ".omo",
      "evidence",
      "ulw",
      ULW_SESSION_ID,
      goal.id,
      `a${goal.attempt}`,
    ),
  };
}
