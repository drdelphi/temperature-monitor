type Proceed = () => void;
type Guard = (proceed: Proceed) => boolean;

let guard: Guard | null = null;

export function setLeaveGuard(next: Guard | null) {
  guard = next;
}

/** Run `proceed` now, or hand it to the active unsaved-changes guard. */
export function requestLeave(proceed: Proceed): boolean {
  if (!guard) {
    proceed();
    return true;
  }
  return guard(proceed);
}
