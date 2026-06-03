import type { SchedulingDay } from "../../types.js";
import type { RuleArtifact } from "../rule-descriptor.js";
import { boolVariable, hardConstraint, skipValidation } from "./artifacts.js";
import { assignedDayVariableName } from "./variables.js";

export function buildAssignedDayIndicator(params: {
  memberId: string;
  day: SchedulingDay;
  assignmentVars: readonly string[];
  variableName?: string;
}): { assignedDayVar: string; artifacts: readonly RuleArtifact[] } {
  const assignedDayVar =
    params.variableName ?? assignedDayVariableName(params.memberId, params.day.iso);
  const artifacts: RuleArtifact[] = [boolVariable(assignedDayVar)];

  if (params.assignmentVars.length === 0) {
    artifacts.push(
      hardConstraint({
        description: `${assignedDayVar} fixed to 0 on ${params.day.iso}`,
        validation: skipValidation(
          "scaffolding",
          "No assignments exist for this member and day, so the derived assigned-day variable is fixed to zero.",
        ),
        context: { memberIds: [params.memberId], days: [params.day.iso] },
        terms: [{ var: assignedDayVar, coeff: 1 }],
        comparator: "==",
        targetValue: 0,
      }),
    );
    return { assignedDayVar, artifacts };
  }

  for (const assignVar of params.assignmentVars) {
    artifacts.push(
      hardConstraint({
        description: `${assignedDayVar} covers ${assignVar}`,
        validation: skipValidation(
          "scaffolding",
          "This derived assigned-day variable must turn on whenever one of the day's assignment variables is on.",
        ),
        context: { memberIds: [params.memberId], days: [params.day.iso] },
        terms: [
          { var: assignedDayVar, coeff: 1 },
          { var: assignVar, coeff: -1 },
        ],
        comparator: ">=",
        targetValue: 0,
      }),
    );
  }

  artifacts.push(
    hardConstraint({
      description: `${assignedDayVar} limited by assignments on ${params.day.iso}`,
      validation: skipValidation(
        "scaffolding",
        "This derived assigned-day variable must stay off unless at least one assignment variable is on.",
      ),
      context: { memberIds: [params.memberId], days: [params.day.iso] },
      terms: [
        { var: assignedDayVar, coeff: 1 },
        ...params.assignmentVars.map((varName) => ({ var: varName, coeff: -1 })),
      ],
      comparator: "<=",
      targetValue: 0,
    }),
  );

  return { assignedDayVar, artifacts };
}
