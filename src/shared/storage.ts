// TODO: Thin wrapper around chrome.storage.local / session.

export async function getStorage<T>(key: string): Promise<T | undefined> {
  void key;
  // TODO: chrome.storage.local.get
  return undefined;
}

export async function setStorage<T>(key: string, value: T): Promise<void> {
  void key;
  void value;
  // TODO: chrome.storage.local.set
}
