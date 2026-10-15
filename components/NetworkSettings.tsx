import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Switch, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../hooks/useAppTheme';
import { BleTransport } from '../lib/ble-transport';
import { robotBle, requestWifiPermission } from '../modules/expo-robot-ble/src';
import { parseHotspotConnection, waitForRobotControl } from '../lib/robot-hotspot';
import { useRosStore } from '../stores/useRosStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ProductButton, ProductCard, SectionHeader } from './ProductUI';
import { TrafficPanel } from './TrafficPanel';
import { BluetoothConnect } from './BluetoothConnect';

export function NetworkSettings({ onConnected }: { onConnected?: () => void }) {
  const theme = useAppTheme();
  const zh = useSettingsStore(s => s.language) === 'zh';
  const transport = useRosStore(s => s.transport);
  const connected = useRosStore(s => s.connection.status) === 'connected';
  const [advanced, setAdvanced] = useState(false);
  const [stage, setStage] = useState('');
  const [ready, setReady] = useState(false);
  const [hotspot, setHotspot] = useState<{ ssid: string; password: string; endpoint: string } | null>(null);
  const [mode, setMode] = useState<'hotspot' | 'wifi'>('hotspot');
  const [ssid, setSsid] = useState('dog4-0008');
  const [password, setPassword] = useState('');
  const [networks, setNetworks] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [endpoint, setEndpoint] = useState('ws://192.168.50.1:8765');
  const [snapshot, setSnapshot] = useState<any>(null);
  const ble = transport instanceof BleTransport && connected;
  useEffect(() => {
    // Credentials belong to the selected robot, never to the next BLE device.
    if (ble) { setHotspot(null); setReady(false); setNotice(''); }
  }, [transport, ble]);
  useEffect(() => {
    setSnapshot(null);
    if (!connected || !transport) return;
    return transport.subscribe('/omni/network/status', 'std_msgs/msg/String', msg => {
      try {
        const data = JSON.parse(msg.data); setSnapshot(data);
        if (data.ready && data.endpoint && !data.endpoint.startsWith('ws://:')) setEndpoint(current => current === 'ws://192.168.50.1:8765' ? data.endpoint : current);
      } catch {}
    }).unsubscribe;
  }, [transport, connected]);
  const request = async (action: string) => {
    if (!(transport instanceof BleTransport)) return;
    setPending(true); setNotice('');
    try {
      if (action === 'wifi') { setReady(false); await requestWifiPermission(); }
      const result = await transport.requestNetwork({ action, ...(action === 'scan' ? {} : { ssid, password }) });
      if (result.networks) setNetworks(result.networks);
      else {
        setPassword('');
        if (result.endpoint) setEndpoint(result.endpoint);
        if (result.mode === 'hotspot' && result.password) setHotspot(parseHotspotConnection(result));
        if (result.mode === 'wifi') {
          setHotspot(null);
          setNotice(zh ? `狗子已关闭热点并连接 ${ssid}。正在连接同一 Wi-Fi…` : `Hotspot closed. Robot joined ${ssid}. Joining the same Wi-Fi…`);
          await robotBle!.joinWifi(ssid, password, new URL(result.endpoint).hostname);
          await connectData(result.endpoint);
        } else setNotice(zh ? '热点已配置，可点击“一键连接热点”。' : 'Hotspot configured. Tap Connect hotspot.');
      }
    } catch (e) { setNotice((e as Error).message); }
    finally { setPending(false); setStage(''); }
  };
  const apply = () => Alert.alert(zh ? '切换狗子网络' : 'Switch robot network',
    zh ? '将关闭狗子热点，连接所选 Wi-Fi。请先结束遥控与任务；手机随后会提示连接同一 Wi-Fi。' : 'The robot hotspot will close and join the selected Wi-Fi. Finish controls and tasks first; confirm joining the same Wi-Fi on your phone.', [
      { text: zh ? '取消' : 'Cancel', style: 'cancel' },
      { text: zh ? '应用' : 'Apply', onPress: () => void request(mode) },
    ]);
  const connectData = async (address: string) => {
    setStage(zh ? '正在连接狗端服务…' : 'Connecting robot services…');
    useRosStore.getState().setTransportType('foxglove');
    await useRosStore.getState().connectToUrl(address);
    const current = useRosStore.getState();
    if (current.connection.status !== 'connected' || !current.transport)
      throw new Error(current.connection.error || 'Connection failed');
    setStage(zh ? '正在确认控制服务…' : 'Checking control service…');
    await waitForRobotControl(current.transport);
    if (useRosStore.getState().transport !== current.transport) throw new Error('连接已更换 / Connection changed');
    setReady(true);
    setNotice(zh ? '连接就绪，可进入控制。' : 'Robot ready. Open controls.');
  };
  const quickConnect = async () => {
    if (pending) return;
    setPending(true); setNotice(''); setReady(false);
    try {
      await requestWifiPermission();
      let details = hotspot;
      if (transport instanceof BleTransport && connected) {
        setStage(zh ? '正在开启狗子热点…' : 'Preparing robot hotspot…');
        details = parseHotspotConnection(await transport.requestNetwork({ action: 'hotspot' }));
        setHotspot(details); setEndpoint(details.endpoint);
      }
      if (!details) throw new Error(zh ? '请先扫描并连接狗子蓝牙' : 'Connect robot Bluetooth first');
      setStage(zh ? '请在系统弹窗中确认连接热点…' : 'Confirm the system Wi-Fi connection prompt…');
      await robotBle!.joinWifi(details.ssid, details.password, new URL(details.endpoint).hostname);
      await connectData(details.endpoint);
    } catch (error) { setNotice((error as Error).message); }
    finally { setStage(''); setPending(false); }
  };
  const inputStyle = { borderWidth: 1, borderColor: theme.colors.borderDefault, borderRadius: 10,
    padding: 10, fontSize: 13, color: theme.colors.textPrimary, backgroundColor: theme.colors.bgInset };
  return <>
    <SectionHeader title={zh ? '网络与传输' : 'Network & streaming'} />
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <ProductButton compact label={zh ? '狗子热点' : 'Robot hotspot'} variant={mode === 'hotspot' ? 'primary' : 'secondary'} disabled={pending} onPress={() => { setMode('hotspot'); setNotice(''); }} />
      <ProductButton compact label={zh ? '连接外部 Wi-Fi' : 'External Wi-Fi'} variant={mode === 'wifi' ? 'primary' : 'secondary'} disabled={pending} onPress={() => { setMode('wifi'); setSsid(''); setPassword(''); setNotice(''); }} />
    </View>
    {mode === 'hotspot' ? <ProductCard>
      <Text style={{ color: theme.colors.textPrimary, fontWeight: '600', fontSize: 15 }}>{zh ? '手机直连狗子' : 'Connect directly to robot'}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginVertical: 10 }}>{zh ? '连接蓝牙后点击下方按钮，确认系统 Wi-Fi 弹窗即可。密码和地址自动填写。' : 'Connect Bluetooth, tap below, then confirm the system Wi-Fi prompt. Password and address are filled automatically.'}</Text>
      {!ble && !hotspot && <BluetoothConnect navigateOnConnect={false} />}
      <ProductButton label={pending ? (stage || (zh ? '正在配置…' : 'Configuring…')) : ready ? (zh ? '重新连接热点' : 'Reconnect hotspot') : (zh ? '一键连接热点' : 'Connect hotspot')}
        icon="wifi-outline" disabled={pending || (!ble && !hotspot)} onPress={() => void quickConnect()} />
      {hotspot && <Text selectable style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 10 }}>{zh ? '电脑连接同一热点：' : 'PC: join the same hotspot: '}{hotspot.ssid}{'\n'}{zh ? '热点密码：' : 'Password: '}{hotspot.password}{'\n'}{zh ? 'Foxglove 地址：' : 'Foxglove: '}{hotspot.endpoint}</Text>}
    </ProductCard> : <ProductCard>
      <Text style={{ color: theme.colors.textPrimary, fontWeight: '600', fontSize: 15 }}>{zh ? '关闭热点，连接外部 Wi-Fi' : 'Close hotspot and join Wi-Fi'}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginVertical: 10 }}>{zh ? '先通过蓝牙连接狗子，再选择网络并输入密码。狗子和手机将切换到同一个 Wi-Fi，连接地址自动填写。仅在狗子静止、任务结束后操作。' : 'Connect Bluetooth, select a network and enter its password. Robot and phone join the same Wi-Fi; the address is filled automatically. Switch only while idle.'}</Text>
      {!ble && <BluetoothConnect navigateOnConnect={false} />}
      <View style={{ gap: 8 }}>
        <ProductButton compact label={zh ? '扫描附近 Wi-Fi' : 'Scan nearby Wi-Fi'} variant="secondary" disabled={!ble || pending} onPress={() => void request('scan')} />
        {networks.map(name => <ProductButton compact key={name} label={name} variant={ssid === name ? 'secondary' : 'ghost'} disabled={pending} onPress={() => setSsid(name)} />)}
        <TextInput accessibilityLabel="Wi-Fi SSID" placeholder={zh ? 'Wi-Fi 名称' : 'Wi-Fi name'} placeholderTextColor={theme.colors.textMuted} style={inputStyle} value={ssid} onChangeText={setSsid} editable={!pending} autoCapitalize="none" />
        <TextInput accessibilityLabel={zh ? 'Wi-Fi 密码' : 'Wi-Fi password'} placeholder={zh ? 'Wi-Fi 密码' : 'Wi-Fi password'} placeholderTextColor={theme.colors.textMuted} style={inputStyle} value={password} onChangeText={setPassword} secureTextEntry editable={!pending} autoCapitalize="none" />
        <ProductButton label={pending ? (stage || (zh ? '正在切换…' : 'Switching…')) : (zh ? '关闭热点并连接此 Wi-Fi' : 'Close hotspot and connect')} icon="wifi-outline" disabled={!ble || pending || !ssid || password.length < 8} onPress={apply} />
      </View>
    </ProductCard>}
    {!!notice && <Text selectable style={{ color: ready ? theme.colors.statusConnected : theme.colors.textSecondary, fontSize: 13 }}>{notice}</Text>}
    {ready && connected && onConnected && <ProductButton label={zh ? '进入控制' : 'Open controls'} icon="game-controller-outline" onPress={onConnected} />}
    <ProductButton compact label={advanced ? (zh ? '收起手动连接' : 'Hide manual connection') : (zh ? '手动连接 / 远程网络' : 'Manual / remote connection')} variant="ghost" disabled={pending} onPress={() => setAdvanced(!advanced)} />
    {advanced && <ProductCard>
      <View style={{ gap: 10 }}>
        {snapshot && <Text style={{ color: theme.colors.textSecondary }}>{snapshot.connection} · {snapshot.addresses?.wlan0?.join(', ') || '—'}</Text>}
        <ProductButton compact label={zh ? '打开手机 Wi-Fi 设置' : 'Open phone Wi-Fi settings'} variant="secondary" onPress={() => void (Platform.OS === 'android' ? Linking.sendIntent('android.settings.WIFI_SETTINGS') : Linking.openSettings()).catch(e => setNotice(String(e)))} />
        <Text style={{ color: theme.colors.textSecondary }}>{zh ? 'Wi-Fi / 远程 VPN 地址' : 'Wi-Fi / remote VPN address'}</Text>
        <TextInput accessibilityLabel="Robot network endpoint" style={inputStyle} value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} />
        <ProductButton label={zh ? '连接数据通道' : 'Connect data channel'} icon="link-outline" disabled={pending} onPress={async () => {
          setPending(true); setReady(false); setNotice('');
          try { await connectData(endpoint); }
          catch (error) { setNotice((error as Error).message); }
          finally { setPending(false); setStage(''); }
        }} />
        <Text style={{ color: theme.colors.textMuted }}>{zh ? 'SIM 远程连接需手机、电脑和狗子加入同一 VPN。此处填写狗子的 VPN 地址:8765；SIM 套餐余量以运营商为准。' : 'For cellular access, join the same VPN on phone, PC and robot. Enter robot VPN address:8765. Carrier quota is provided by your operator.'}</Text>
      </View>
    </ProductCard>}
    <TransmissionSettings />
    <TrafficPanel />
  </>;
}

export function TransmissionSettings() {
  const theme = useAppTheme();
  const zh = useSettingsStore(s => s.language) === 'zh';
  const video = useSettingsStore(s => s.videoEnabled);
  const cloud = useSettingsStore(s => s.cloudEnabled);
  return <ProductCard>
    {([
      [zh ? '接收视频' : 'Receive video', video, useSettingsStore.getState().setVideoEnabled],
      [zh ? '接收点云' : 'Receive point cloud', cloud, useSettingsStore.getState().setCloudEnabled],
    ] as const).map(([label, value, change]) => <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 }}>
      <Text style={{ color: theme.colors.textPrimary }}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={change} trackColor={{ true: theme.colors.accentPrimary }} />
    </View>)}
    <Text style={{ color: theme.colors.textMuted }}>{zh ? '只影响当前客户端；不影响狗子建图、避障和录包。' : 'This client only. Robot mapping, obstacle avoidance and bag recording continue.'}</Text>
  </ProductCard>;
}
