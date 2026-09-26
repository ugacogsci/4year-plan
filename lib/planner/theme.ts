export type PlannerTheme = 'light' | 'dark';

export const PLANNER_THEME_STORAGE_KEY = 'fourYear.theme';

/** Read the student's saved appearance without assuming a browser exists. */
export function readStoredTheme(): PlannerTheme {
  if (typeof window === 'undefined') return 'light';
  return window.localStorage.getItem(PLANNER_THEME_STORAGE_KEY) === 'dark'
    ? 'dark'
    : 'light';
}
