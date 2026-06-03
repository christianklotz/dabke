export function assignmentVar(memberId: string, patternId: string, dayIso: string): string {
  return `assign:${memberId}:${patternId}:${dayIso}`;
}

export function assignedDayVariableName(memberId: string, dayIso: string): string {
  return `assigned_day_${memberId}_${dayIso}`;
}

export function assignedDayStartVariableName(memberId: string, dayIso: string): string {
  return `assigned_day_start_${memberId}_${dayIso}`;
}
