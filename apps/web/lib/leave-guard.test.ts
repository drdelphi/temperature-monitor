import { describe, expect, it } from 'vitest';
import { requestLeave, setLeaveGuard } from './leave-guard';

describe('leave guard', () => {
  it('runs proceed immediately when no guard is set', () => {
    setLeaveGuard(null);
    let ran = false;
    expect(requestLeave(() => {
      ran = true;
    })).toBe(true);
    expect(ran).toBe(true);
  });

  it('hands proceed to the guard and does not run it now', () => {
    let held: (() => void) | null = null;
    setLeaveGuard((proceed) => {
      held = proceed;
      return false;
    });
    let ran = false;
    expect(requestLeave(() => {
      ran = true;
    })).toBe(false);
    expect(ran).toBe(false);
    expect(held).toBeTypeOf('function');
    held!();
    expect(ran).toBe(true);
    setLeaveGuard(null);
  });
});
