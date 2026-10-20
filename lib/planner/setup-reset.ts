/** The sequence must be deliberate, with no more than two seconds between keys. */
export function createSetupResetSequence() {
  const sequence = ['x', 'c', 'x', 's', 'x'];
  let position = 0;
  let lastAt = 0;

  return (key: string, now = Date.now()): boolean => {
    if (now - lastAt > 2000) position = 0;
    lastAt = now;
    const pressed = key.toLowerCase();
    position = pressed === sequence[position] ? position + 1 : pressed === sequence[0] ? 1 : 0;
    if (position !== sequence.length) return false;
    position = 0;
    return true;
  };
}

/** Leave other apps' data alone when sharing an origin such as localhost. */
export function clearPlannerStorage(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && (key.startsWith('fourYear.') || /^four-year-planner-v\d+$/.test(key) || key === 'planner.clubs.open')) {
      storage.removeItem(key);
    }
  }
}
