export function optionalDurationOverride(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 5 && duration <= 60 ? duration : undefined;
}

export function hasValidDurationOverride(value: string): boolean {
  return value.trim() === "" || optionalDurationOverride(value) !== undefined;
}
