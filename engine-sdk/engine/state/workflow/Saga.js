// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/workflow/Saga.js — saga coordinator + compensation registry (spec §11).
//
// For multi-step workflows that span commit domains or external systems, true
// distributed atomic commit is avoided where possible (rule 40). Instead a saga
// runs a sequence of LOCAL steps, each with a forward action and a compensating
// action. If a step fails, the already-completed steps are compensated in
// reverse order. Compensation is a NEW action, not deletion of history (rule
// 44), and some effects cannot be perfectly undone — every saga declares a
// PIVOT step after which forward-only recovery applies because compensation is
// no longer possible (rule 45, the irreversible pivot).

export const SAGA_STATUS = Object.freeze({
  COMPLETED: 'completed',
  COMPENSATED: 'compensated',
  FAILED_PIVOTED: 'failed-pivoted', // failed past the pivot: cannot roll back
});

/**
 * Define a saga step.
 * @param {object} s
 * @param {string} s.name
 * @param {(ctx:object)=>Promise<*>|*} s.forward     forward action
 * @param {(ctx:object, fwd:*)=>Promise<*>|*} [s.compensate] undo action
 * @param {boolean} [s.pivot]  true → after this step, no rollback is possible
 * @returns {object} frozen step
 */
export function sagaStep(s) {
  if (typeof s?.forward !== 'function') throw new TypeError('sagaStep: forward must be a function');
  return Object.freeze({
    name: String(s.name ?? 'step'),
    forward: s.forward,
    compensate: typeof s.compensate === 'function' ? s.compensate : null,
    pivot: !!s.pivot,
  });
}

export class Saga {
  /** @param {object[]} steps ordered saga steps (use sagaStep) */
  constructor(steps = []) {
    this._steps = steps.map(sagaStep);
  }

  /**
   * Run the saga. Returns a structured outcome; never throws for ordinary step
   * failures (callers inspect `status`). Throws only on programmer error.
   *
   * Behavior:
   *  - all forward steps succeed → COMPLETED.
   *  - a step fails BEFORE the pivot → compensate completed steps in reverse →
   *    COMPENSATED.
   *  - a step fails AT/AFTER the pivot → forward-only; no rollback →
   *    FAILED_PIVOTED (must be reconciled, not silently undone).
   *
   * @param {object} [ctx] shared context passed to every action
   * @returns {Promise<{status:string, completed:string[], compensated:string[], error:*, pivotCrossed:boolean}>}
   */
  async run(ctx = {}) {
    const completed = [];     // names of forward-completed steps
    const forwardResults = []; // results aligned with completed
    let pivotCrossed = false;

    for (const step of this._steps) {
      try {
        const res = await step.forward(ctx);
        completed.push(step.name);
        forwardResults.push(res);
        if (step.pivot) pivotCrossed = true;
      } catch (error) {
        if (pivotCrossed) {
          // Past the irreversible pivot — cannot compensate. Surface for repair.
          return { status: SAGA_STATUS.FAILED_PIVOTED, completed, compensated: [], error, pivotCrossed };
        }
        const compensated = await this._compensate(ctx, completed, forwardResults);
        return { status: SAGA_STATUS.COMPENSATED, completed, compensated, error, pivotCrossed };
      }
    }
    return { status: SAGA_STATUS.COMPLETED, completed, compensated: [], error: null, pivotCrossed };
  }

  /** Compensate completed steps in reverse order; returns names compensated. */
  async _compensate(ctx, completed, forwardResults) {
    const compensated = [];
    for (let i = completed.length - 1; i >= 0; i--) {
      const step = this._steps[i];
      if (!step.compensate) continue; // nothing to undo for this step
      try { await step.compensate(ctx, forwardResults[i]); compensated.push(step.name); }
      catch (_) { /* compensation is best-effort; failures escalate via reconciler */ }
    }
    return compensated;
  }
}
