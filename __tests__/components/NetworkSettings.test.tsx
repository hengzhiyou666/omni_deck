jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() }, Linking: {}, Platform: { OS: 'android' },
  StyleSheet: { create: (s: any) => s }, Text: 'Text', TextInput: 'TextInput', View: 'View', Switch: 'Switch',
  useColorScheme: () => 'light',
}));
jest.mock('../../components/ProductUI', () => ({ ProductButton: 'ProductButton', ProductCard: 'View', SectionHeader: 'Text' }));
jest.mock('../../components/TrafficPanel', () => ({ TrafficPanel: () => null }));
jest.mock('../../components/BluetoothConnect', () => ({ BluetoothConnect: () => null }));
jest.mock('../../modules/expo-robot-ble/src', () => ({
  robotBle: { joinWifi: jest.fn(async () => {}) }, requestWifiPermission: jest.fn(async () => {}),
}));
jest.mock('../../lib/robot-hotspot', () => ({
  ...jest.requireActual('../../lib/robot-hotspot'), waitForRobotControl: jest.fn(async () => {}),
}));

import React from 'react';
import { Alert } from 'react-native';
const { act, create } = require('react-test-renderer');
import { NetworkSettings } from '../../components/NetworkSettings';
import { BleTransport } from '../../lib/ble-transport';
import { robotBle } from '../../modules/expo-robot-ble/src';
import { waitForRobotControl } from '../../lib/robot-hotspot';
import { useRosStore } from '../../stores/useRosStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { usePairingStore } from '../../stores/usePairingStore';
import type { Transport } from '../../lib/transport';
import { useWifiStore } from '../../stores/useWifiStore';
import * as SecureStore from 'expo-secure-store';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  jest.clearAllMocks();
  useWifiStore.setState({ networks: [], selectedSsid: null, loaded: true, error: null });
  (robotBle!.joinWifi as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
});

it('switches hotspot to external Wi-Fi over BLE, then joins the phone and verifies the returned data endpoint', async () => {
  const original = useRosStore.getState();
  const ble = new BleTransport();
  const request = jest.spyOn(ble, 'requestNetwork').mockResolvedValue({ mode: 'wifi', endpoint: 'ws://192.168.10.100:8765' });
  const data = { subscribe: () => ({ unsubscribe() {} }) } as unknown as Transport;
  const connect = jest.fn(async (url: string) => {
    useRosStore.setState({ transport: data, connection: { url, status: 'connected', ros: null, error: null } });
  });
  useSettingsStore.setState({ language: 'zh' });
  useRosStore.setState({ transport: ble, connectToUrl: connect,
    connection: { url: 'ble://AA:BB:CC:DD:EE:FF', status: 'connected', ros: null, error: null } });
  let tree: any;
  const button = (label: string) => tree.root.findAll((n: any) => n.type === 'ProductButton' && n.props.label === label)[0];
  try {
    await act(async () => { tree = create(<NetworkSettings />); });
    await act(async () => { button('连接外部 Wi-Fi').props.onPress(); });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Wi-Fi SSID' }).props.onChangeText('test-router');
      tree.root.findByProps({ accessibilityLabel: 'Wi-Fi 密码' }).props.onChangeText('test-password');
    });
    expect(button('关闭热点并连接此 Wi-Fi').props.disabled).toBe(false);
    await act(async () => { button('关闭热点并连接此 Wi-Fi').props.onPress(); });
    expect(request).not.toHaveBeenCalled(); // User must confirm the disruptive network switch.
    const actions = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
    await act(async () => { actions[1].onPress(); });
    expect(request).toHaveBeenCalledWith({ action: 'wifi', ssid: 'test-router', password: 'test-password' });
    expect(robotBle!.joinWifi).toHaveBeenCalledWith('test-router', 'test-password', '192.168.10.100');
    expect(connect).toHaveBeenCalledWith('ws://192.168.10.100:8765');
    expect(waitForRobotControl).toHaveBeenCalledWith(data);
  } finally {
    await act(async () => { tree?.unmount(); });
    useRosStore.setState(original);
    request.mockRestore();
  }
});

describe('saved Wi-Fi and Bluetooth provisioning', () => {
  const originalRos = useRosStore.getState();
  let tree: any;
  let ble: BleTransport;
  let request: jest.SpyInstance;
  let connect: jest.Mock;
  const data = { subscribe: () => ({ unsubscribe() {} }) } as unknown as Transport;
  const button = (label: string) => tree.root.findAll((n: any) => n.type === 'ProductButton' && n.props.label === label)[0];
  const field = (label: string) => tree.root.findByProps({ accessibilityLabel: label });
  const mount = async () => {
    await act(async () => { tree = create(<NetworkSettings />); });
    await act(async () => { button('连接外部 Wi-Fi').props.onPress(); });
  };
  const apply = async () => {
    await act(async () => { button('关闭热点并连接此 Wi-Fi').props.onPress(); });
    const actions = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
    await act(async () => { await actions[1].onPress(); });
  };
  beforeEach(() => {
    useSettingsStore.setState({ language: 'zh' });
    ble = new BleTransport();
    request = jest.spyOn(ble, 'requestNetwork').mockResolvedValue({ mode: 'wifi', endpoint: 'ws://192.168.10.100:8765' });
    connect = jest.fn(async (url: string) => {
      useRosStore.setState({ transport: data, connection: { url, status: 'connected', ros: null, error: null } });
    });
    useRosStore.setState({ transport: ble, connectToUrl: connect, savedConnections: [],
      connection: { url: 'ble://AA:BB:CC:DD:EE:FF', status: 'connected', ros: null, error: null } });
    useWifiStore.setState({ networks: [{ ssid: 'Office', password: 'office-password' }, { ssid: 'Lab', password: 'lab-password' }],
      selectedSsid: 'Office', loaded: true, error: null });
  });
  afterEach(async () => {
    await act(async () => { tree?.unmount(); });
    request.mockRestore();
    useRosStore.setState(originalRos);
  });
  it('restores the selected network and its password across tabs and remounts, and clears a different network password', async () => {
    await mount();
    expect(field('记住此 Wi-Fi').props.value).toBe(true);
    expect(field('Wi-Fi SSID').props.value).toBe('Office');
    await act(async () => { button('Lab').props.onPress(); });
    expect(field('Wi-Fi 密码').props.value).toBe('lab-password');
    expect(field('Wi-Fi 密码').props.secureTextEntry).toBe(true);
    await act(async () => { button('狗子热点').props.onPress(); button('连接外部 Wi-Fi').props.onPress(); });
    expect(field('Wi-Fi SSID').props.value).toBe('Lab');
    await act(async () => { tree.unmount(); });
    await mount();
    expect(field('Wi-Fi SSID').props.value).toBe('Lab');
    expect(field('Wi-Fi 密码').props.value).toBe('lab-password');
    await act(async () => { field('Wi-Fi SSID').props.onChangeText('Another'); });
    expect(field('Wi-Fi 密码').props.value).toBe('');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps newly activated credentials when the phone declines joining Wi-Fi', async () => {
    await mount();
    await act(async () => { field('Wi-Fi 密码').props.onChangeText('updated-password'); });
    (robotBle!.joinWifi as jest.Mock).mockImplementationOnce(async () => {
      expect(useWifiStore.getState().networks[0]).toEqual({ ssid: 'Office', password: 'updated-password' });
      throw new Error('Phone join declined');
    });
    await apply();
    expect(useWifiStore.getState().networks[0]).toEqual({ ssid: 'Office', password: 'updated-password' });
    expect(connect).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Phone join declined');
  });
  it('preserves the previous password when robot activation fails', async () => {
    await mount();
    await act(async () => { field('Wi-Fi 密码').props.onChangeText('incorrect-password'); });
    request.mockRejectedValueOnce(new Error('Robot activation failed'));
    await apply();
    expect(useWifiStore.getState().networks[0]).toEqual({ ssid: 'Office', password: 'office-password' });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(robotBle!.joinWifi).not.toHaveBeenCalled();
  });
  it('can select and connect a remembered network even after scanning fails', async () => {
    await mount();
    request.mockRejectedValueOnce(new Error('Scan unavailable in hotspot mode'));
    await act(async () => { await button('扫描附近 Wi-Fi').props.onPress(); });
    await act(async () => { button('Lab').props.onPress(); });
    expect(button('关闭热点并连接此 Wi-Fi').props.disabled).toBe(false);
    await apply();
    expect(request).toHaveBeenLastCalledWith({ action: 'wifi', ssid: 'Lab', password: 'lab-password' });
    expect(connect).toHaveBeenCalledWith('ws://192.168.10.100:8765');
  });
  it('forgets an entry without changing robot networks and honors remember being turned off', async () => {
    await mount();
    const officeRow = button('Office').parent;
    await act(async () => { await officeRow.findAll((n: any) => n.type === 'ProductButton' && n.props.label === '忘记')[0].props.onPress(); });
    expect(useWifiStore.getState().networks.map(n => n.ssid)).toEqual(['Lab']);
    expect(field('Wi-Fi SSID').props.value).toBe('Lab');
    expect(request).not.toHaveBeenCalled();
    await act(async () => { field('记住此 Wi-Fi').props.onValueChange(false); });
    await apply();
    expect(useWifiStore.getState().networks).toEqual([]);
    expect(request).toHaveBeenCalledWith({ action: 'wifi', ssid: 'Lab', password: 'lab-password' });
  });
  it('surfaces secure storage failure while still joining an already activated robot network', async () => {
    await mount();
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable'));
    await act(async () => { field('Wi-Fi 密码').props.onChangeText('updated-password'); });
    await apply();
    expect(useWifiStore.getState().networks[0].password).toBe('office-password');
    expect(connect).toHaveBeenCalledWith('ws://192.168.10.100:8765');
    expect(JSON.stringify(tree.toJSON())).toContain('未能读取或更新已记住的 Wi-Fi');
  });
  it('explicitly reconnects a saved Bluetooth address after hotspot handoff, using a fresh transport', async () => {
    const freshBle = new BleTransport();
    const freshRequest = jest.spyOn(freshBle, 'requestNetwork');
    connect.mockImplementationOnce(async (url: string) => {
      expect(useRosStore.getState().transportType).toBe('ble');
      useRosStore.setState({ transport: freshBle, connection: { url, status: 'connected', ros: null, error: null } });
    });
    useRosStore.setState({ transport: data, savedConnections: [{ url: 'ble://AA:BB:CC:DD:EE:FF', transport: 'ble', lastUsed: 1 }],
      connection: { url: 'ws://192.168.50.1:8765', status: 'connected', ros: null, error: null } });
    await mount();
    expect(button('扫描附近 Wi-Fi').props.disabled).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    await act(async () => { await button('重新连接蓝牙 · AA:BB:CC:DD:EE:FF').props.onPress(); });
    expect(connect).toHaveBeenCalledWith('ble://AA:BB:CC:DD:EE:FF');
    expect(button('扫描附近 Wi-Fi').props.disabled).toBe(false);
    expect(freshRequest).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    freshRequest.mockRestore();
  });
});

describe('remote gateway connection', () => {
  const originalRos = useRosStore.getState();
  const originalPairing = usePairingStore.getState();
  let tree: any;
  let connect: jest.Mock;
  const data = { subscribe: () => ({ unsubscribe() {} }) } as unknown as Transport;
  const button = (label: string) => tree.root.findAll((n: any) => n.type === 'ProductButton' && n.props.label === label)[0];
  const fill = async (endpoint: string, token = 'test-token') => {
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Remote endpoint' }).props.onChangeText(endpoint);
      tree.root.findByProps({ accessibilityLabel: 'Remote access token' }).props.onChangeText(token);
    });
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    usePairingStore.setState({ pairing: null, loaded: true });
    useSettingsStore.setState({ language: 'zh' });
    connect = jest.fn(async (url: string) => {
      expect(usePairingStore.getState().pairing).toEqual({ host: 'robot.example.com', user: 'operator', token: 'test-token' });
      useRosStore.setState({ transport: data, connection: { url, status: 'connected', ros: null, error: null } });
    });
    useRosStore.setState({ transport: null, savedConnections: [], connectToUrl: connect,
      connection: { url: '', status: 'disconnected', ros: null, error: null } });
    await act(async () => { tree = create(<NetworkSettings onConnected={() => {}} />); });
    await act(async () => { button('公网连接').props.onPress(); });
  });
  afterEach(async () => {
    await act(async () => { tree.unmount(); });
    useRosStore.setState(originalRos);
    usePairingStore.setState(originalPairing);
  });
  it('saves credentials before connecting and confirms real robot status without joining Wi-Fi', async () => {
    await fill('wss://robot.example.com:443/dog4');
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(connect).toHaveBeenCalledWith('wss://robot.example.com:443/dog4');
    expect(waitForRobotControl).toHaveBeenCalledWith(data);
    expect(robotBle!.joinWifi).not.toHaveBeenCalled();
    expect(button('进入控制')).toBeDefined();
  });
  it.each(['ws://robot.example.com', 'https://robot.example.com', 'robot.example.com'])('rejects %s before sending credentials', async (endpoint) => {
    await fill(endpoint);
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(connect).not.toHaveBeenCalled();
    expect(usePairingStore.getState().pairing).toBeNull();
    expect(button('进入控制')).toBeUndefined();
  });
  it('rejects missing credentials', async () => {
    await fill('wss://robot.example.com', '');
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(connect).not.toHaveBeenCalled();
  });
  it('does not show robot ready when the gateway has no robot telemetry', async () => {
    (waitForRobotControl as jest.Mock).mockRejectedValueOnce(new Error('Robot offline'));
    await fill('wss://robot.example.com');
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(button('进入控制')).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).toContain('Robot offline');
  });
});
