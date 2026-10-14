/**
 * Virus-scan hook for uploads (FILE-01, spec 4 Files). Every attachment and logo upload calls
 * `scanFile` before anything is stored; a file that is not clean is refused with `reason`.
 *
 * TODO(security, before storing client files in production): replace `devScanner` with a real
 * scanner, e.g. ClamAV (clamd INSTREAM over TCP) or a cloud AV API, and call `setScanner()` from
 * server start-up. Until then this placeholder always passes, in dev and in production.
 */
export interface ScanInput {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface ScanResult {
  clean: boolean;
  /** Shown to the uploader when `clean` is false. */
  reason?: string;
}

export interface FileScanner {
  scan(file: ScanInput): Promise<ScanResult>;
}

/** Placeholder: always passes. See the TODO above. */
export const devScanner: FileScanner = {
  async scan() {
    return { clean: true };
  },
};

const g = globalThis as unknown as { __khScanner?: FileScanner };

/** Installs a scanner (a real one in production, a fake one in tests). */
export const setScanner = (s: FileScanner | null) => {
  g.__khScanner = s ?? undefined;
};

export const scanFile = (file: ScanInput): Promise<ScanResult> => (g.__khScanner ?? devScanner).scan(file);
