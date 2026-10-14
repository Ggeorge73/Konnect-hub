'use client';

/**
 * Sets (or removes, with null) one query parameter in place, without a server round trip.
 * Next.js keeps useSearchParams() in sync with window.history.replaceState, so a panel keyed on
 * `?item=KEY` opens instantly; router.replace would refetch the dynamic route's RSC payload first
 * (KH-46: that round trip alone pushed the item panel past its 300 ms budget).
 */
export function replaceSearchParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  // State must be null: Next's patched replaceState skips the router sync for its own state objects.
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
