import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'omnideck_wifi_networks';
const LOAD_ERROR = '无法读取已记住的 Wi-Fi，请重试 / Cannot read remembered Wi-Fi';

export interface WifiNetwork {
  ssid: string;
  password: string;
}

interface WifiState {
  networks: WifiNetwork[];
  selectedSsid: string | null;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  select: (ssid: string) => void;
  save: (ssid: string, password: string) => Promise<void>;
  forget: (ssid: string) => Promise<void>;
}

function parseNetworks(json: string | null): WifiNetwork[] {
  if (json === null) return [];
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || !value.every(n => n && typeof n === 'object'
    && typeof n.ssid === 'string' && n.ssid.length > 0 && typeof n.password === 'string')) {
    throw new Error(LOAD_ERROR);
  }
  return value.map(({ ssid, password }) => ({ ssid, password }));
}

let loading: Promise<void> | null = null;

export const useWifiStore = create<WifiState>((set, get) => ({
  networks: [], selectedSsid: null, loaded: false, error: null,

  load: async () => {
    if (get().loaded) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        const networks = parseNetworks(await SecureStore.getItemAsync(STORAGE_KEY));
        const selectedSsid = networks.some(n => n.ssid === get().selectedSsid)
          ? get().selectedSsid : networks[0]?.ssid ?? null;
        set({ networks, selectedSsid, loaded: true, error: null });
      } catch {
        set({ error: LOAD_ERROR });
      }
    })();
    try { await loading; }
    finally { loading = null; }
  },

  select: (ssid) => {
    if (get().networks.some(n => n.ssid === ssid)) set({ selectedSsid: ssid });
  },

  save: async (ssid, password) => {
    await get().load();
    if (!get().loaded) throw new Error(LOAD_ERROR);
    const networks = [{ ssid, password }, ...get().networks.filter(n => n.ssid !== ssid)];
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(networks));
      set({ networks, selectedSsid: ssid, error: null });
    } catch {
      const message = '未能记住此 Wi-Fi，请重试 / Could not remember Wi-Fi';
      set({ error: message });
      throw new Error(message);
    }
  },

  forget: async (ssid) => {
    await get().load();
    if (!get().loaded) throw new Error(LOAD_ERROR);
    const networks = get().networks.filter(n => n.ssid !== ssid);
    try {
      if (networks.length) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(networks));
      else await SecureStore.deleteItemAsync(STORAGE_KEY);
      set({ networks, selectedSsid: get().selectedSsid === ssid ? networks[0]?.ssid ?? null : get().selectedSsid, error: null });
    } catch {
      const message = '未能忘记此 Wi-Fi，请重试 / Could not forget Wi-Fi';
      set({ error: message });
      throw new Error(message);
    }
  },
}));
