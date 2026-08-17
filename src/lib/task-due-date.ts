const DONE_STATUS_TYPES = new Set(["completed", "canceled"]);

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isTaskOverdue(
  dueDate: string | null | undefined,
  statusType: string | null | undefined,
  today = localDateKey(),
): boolean {
  return Boolean(
    dueDate
    && dueDate < today
    && !DONE_STATUS_TYPES.has((statusType ?? "").toLowerCase()),
  );
}
