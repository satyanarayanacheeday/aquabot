/**
 * In-memory conversation state manager.
 * Tracks multi-step flows (registration, daily data, weekly data) per phone number.
 *
 * State shape:
 * {
 *   flow: 'registration' | 'daily_data' | 'weekly_data' | null,
 *   step: number,
 *   data: {},          // partial data collected so far
 *   farmerId: string,  // set once farmer exists in DB
 *   farmId: string,    // set once farm exists in DB
 *   updatedAt: number  // timestamp for auto-cleanup
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

function isInFlow(phone) {
  const state = getState(phone);
  return state && state.flow !== null;
}

module.exports = {
  getState,
  setState,
  clearState,
  updateStateData,
  isInFlow,
};
