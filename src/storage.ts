import { Store } from "@tauri-apps/plugin-store";

const STORE_PATH = "settings.json";

let storePromise: Promise<Store> | null = null;

export const STORE_KEYS = {
  settings: "settings",
  deviceHistory: "deviceHistory",
  pairConnect: "pairConnect",
} as const;

export function getStore() {
  if (!storePromise) {
    storePromise = Store.load(STORE_PATH);
  }
  return storePromise;
}

export async function saveStoreValue(key: string, value: unknown) {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}
