let counter = 0;
/** Short unique ids for the in-memory store. Postgres uses gen_random_uuid(). */
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
