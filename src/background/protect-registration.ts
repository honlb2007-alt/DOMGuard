/** Compare registered content scripts with the scripts this version would register. */

export interface ExpectedRegistration {
  id: string;
  file: string;
  runAt: 'document_start' | 'document_end' | 'document_idle';
  wanted: boolean;
}

export interface ActualRegistration {
  id: string;
  js?: readonly string[];
  runAt?: string;
}

/**
 * Chrome's default runAt is document_idle. A missing value is that default.
 * A 1.0 protect script registered at document_idle does not match document_start.
 */
export function registeredScriptsMatch(
  expected: readonly ExpectedRegistration[],
  actual: readonly ActualRegistration[],
): boolean {
  for (const item of expected) {
    const found = actual.find((script) => script.id === item.id);
    if (!item.wanted) {
      if (found) {
        return false;
      }
      continue;
    }
    if (!found || !found.js || found.js.length !== 1 || found.js[0] !== item.file) {
      return false;
    }
    if ((found.runAt ?? 'document_idle') !== item.runAt) {
      return false;
    }
  }
  return true;
}
