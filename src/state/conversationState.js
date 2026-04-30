/**
 * In-memory conversation state manager.
 * Tracks multi-step flows per phone number.
 *
 * State shape:
 * {
 *   flow: 'onboarding' | 'daily_feed' | 'daily_water' | 'daily_health' |
 *         'weekly_checkin' | 'event_followup' | null,
 *   group: number,       // onboarding group (1, 2, 3)
 *   step: number,        // current step within the flow/group
 *   data: {},            // partial data collected so far
 *   farmerId: string,    // set once farmer exists in DB
 *   pondId: string,      // set once pond exists in DB
 *   eventType: string,   // for event_followup: 'mortality' | 'slow_growth' | 'disease' etc.
 *   updatedAt: number    // timestamp for auto-cleanup
 * }
 */

const states = new Map();

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function getState(phone) {
  const state = states.get(phone);
  if (state && Date.now() - state.updatedAt > SESSION_TIMEOUT_MS) {
    // Session expired — clear it
    states.delete(phone);
    return null;
  }
  return state || null;
}

function setState(phone, state) {
  states.set(phone, {
    ...state,
    updatedAt: Date.now(),
  });
}

function clearState(phone) {
  states.delete(phone);
}

function updateStateData(phone, newData) {
  const current = getState(phone);
  if (!current) return;
  setState(phone, {
    ...current,
    data: { ...current.data, ...newData },
    step: current.step + 1,
  });
}

/**
 * Advance to next group (for onboarding) without incrementing step
 */
function advanceGroup(phone) {
  const current = getState(phone);
  if (!current) return;
  setState(phone, {
    ...current,
    group: (current.group || 1) + 1,
    step: 0,
    // keep data accumulated across groups
  });
}

function isInFlow(phone) {
  const state = getState(phone);
  return state && state.flow !== null;
}

module.exports = {
  getState,
  setState,
  clearState,
  updateStateData,
  advanceGroup,
  isInFlow,
};
