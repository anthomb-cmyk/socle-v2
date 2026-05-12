import type { JudgeResult } from "@/lib/llm/judge";

export type OpenclawVerdict = "likely_match" | "uncertain" | "unlikely_match";
export type JudgeCandidateStatus =
  | "approved_by_anthony"
  | "needs_anthony_review"
  | "weak_review"
  | "rejected_by_openclaw";

export function openclawVerdictFromJudge(result: Pick<JudgeResult, "verdict">): OpenclawVerdict {
  if (result.verdict === "approve") return "likely_match";
  if (result.verdict === "review") return "uncertain";
  return "unlikely_match";
}

export function candidateStatusFromJudge(
  result: Pick<JudgeResult, "verdict" | "confidence" | "reasoning">,
  candidate: { isAuthoritative: boolean; initialConfidence: number },
): JudgeCandidateStatus {
  if (result.verdict === "approve") return "approved_by_anthony";
  if (result.verdict === "reject") return "rejected_by_openclaw";

  const judgeUnavailable = /LLM judge failed|unparse-able response/i.test(result.reasoning ?? "");
  const weakCandidate = !candidate.isAuthoritative && candidate.initialConfidence <= 55;

  if (judgeUnavailable && weakCandidate && result.confidence <= 50) {
    return "weak_review";
  }

  return "needs_anthony_review";
}
