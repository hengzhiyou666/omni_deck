import * as SecureStore from 'expo-secure-store';
import { useWifiStore } from '../../stores/useWifiStore';

const saved = [
  { ssid: 'Cudy-64AF', password: 'router-password' },
  { ssid: 'office', password: 'office-password' },
];

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockReset().mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
  useWifiStore.setState({ networks: [], selectedSsid: null, loaded: false, error: null });
});

it('loads credentials securely once and preserves the selection across subsequent loads', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(saved));
  await useWifiStore.getState().load();
  expect(useWifiStore.getState()).toMatchObject({ networks: saved, selectedSsid: 'Cudy-64AF', loaded: true, error: null });
  useWifiStore.getState().select('office');
  await useWifiStore.getState().load();
  expect(useWifiStore.getState().selectedSsid).toBe('office');
  expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
});

it('loads existing credentials before adding a network and updates an SSID without duplicating it', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(saved));
  await useWifiStore.getState().save('office', 'updated-password');
  const expected = [{ ssid: 'office', password: 'updated-password' }, saved[0]];
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('omnideck_wifi_networks', JSON.stringify(expected));
  expect(useWifiStore.getState()).toMatchObject({ networks: expected, selectedSsid: 'office', error: null });
});

it('does not report credentials remembered until secure persistence succeeds', async () => {
  await useWifiStore.getState().load();
  let finish!: () => void;
  (SecureStore.setItemAsync as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const writing = useWifiStore.getState().save('Cudy-64AF', 'router-password');
  await Promise.resolve();
  await Promise.resolve();
  expect(useWifiStore.getState().networks).toEqual([]);
  finish();
  await writing;
  expect(useWifiStore.getState().networks).toEqual([saved[0]]);
});

it('keeps a previously remembered password if secure persistence fails and does not expose native error details', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(saved));
  await useWifiStore.getState().load();
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('native error: new-secret-password'));
  await expect(useWifiStore.getState().save('Cudy-64AF', 'new-secret-password')).rejects.toThrow('Could not remember Wi-Fi');
  expect(useWifiStore.getState().networks).toEqual(saved);
  expect(useWifiStore.getState().error).not.toContain('new-secret-password');
});

it('allows an explicit retry after a read error and never writes over unknown stored credentials', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('Native store unavailable'));
  await useWifiStore.getState().load();
  expect(useWifiStore.getState()).toMatchObject({ networks: [], loaded: false });
  await expect(useWifiStore.getState().save('new-router', 'new-password')).rejects.toThrow('Cannot read remembered Wi-Fi');
  await expect(useWifiStore.getState().forget('Cudy-64AF')).rejects.toThrow('Cannot read remembered Wi-Fi');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(saved));
  await useWifiStore.getState().load();
  expect(useWifiStore.getState()).toMatchObject({ networks: saved, loaded: true, error: null });
});

it.each(['{invalid json', '{"ssid":"partial"}', '[{"ssid":"partial"}]'])('does not silently erase malformed saved credentials: %s', async value => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(value);
  await useWifiStore.getState().load();
  expect(useWifiStore.getState().loaded).toBe(false);
  expect(useWifiStore.getState().error).toContain('Cannot read remembered Wi-Fi');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it('forgets a selected network, selects the next one, then removes the final secure entry', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(saved));
  await useWifiStore.getState().forget('Cudy-64AF');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('omnideck_wifi_networks', JSON.stringify([saved[1]]));
  expect(useWifiStore.getState()).toMatchObject({ networks: [saved[1]], selectedSsid: 'office' });
  await useWifiStore.getState().forget('office');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('omnideck_wifi_networks');
  expect(useWifiStore.getState()).toMatchObject({ networks: [], selectedSsid: null, error: null });
});

it('preserves a remembered entry and selection when forgetting fails', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(saved));
  await useWifiStore.getState().load();
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Native delete unavailable'));
  await expect(useWifiStore.getState().forget('Cudy-64AF')).rejects.toThrow('Could not forget Wi-Fi');
  expect(useWifiStore.getState()).toMatchObject({ networks: saved, selectedSsid: 'Cudy-64AF' });
});
