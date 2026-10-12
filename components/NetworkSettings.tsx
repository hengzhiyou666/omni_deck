import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Switch, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../hooks/useAppTheme';
import { BleTransport } from '../lib/ble-transport';
import { useRosStore } from '../stores/useRosStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ProductButton, ProductCard, SectionHeader } from './ProductUI';
import { TrafficPanel } from './TrafficPanel';

export function NetworkSettings() {
  const theme = useAppTheme();
  const zh = useSettingsStore(s => s.language) === 'zh';
  const transport = useRosStore(s => s.transport);
  const connected = useRosStore(s => s.connection.status) === 'connected';
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
      const result = await transport.requestNetwork({ action, ...(action === 'scan' ? {} : { ssid, password }) });
      if (result.networks) setNetworks(result.networks);
      else {
        setPassword('');
        if (result.endpoint) setEndpoint(result.endpoint);
        setNotice(zh ? '配置成功。手机或电脑连接该 Wi-Fi 后，再连接下方地址。' : 'Configured. Join this Wi-Fi on your phone or PC, then connect below.');
      }
    } catch (e) { setNotice((e as Error).message); }
    finally { setPending(false); }
  };
  const apply = () => Alert.alert(zh ? '切换狗子网络' : 'Switch robot network',
    zh ? '切换会断开狗子当前 Wi-Fi 连接。请先结束遥控与任务；蓝牙连接可用于继续配网。' : 'This disconnects the current robot Wi-Fi. Finish controls and tasks first; BLE remains available for provisioning.', [
      { text: zh ? '取消' : 'Cancel', style: 'cancel' },
      { text: zh ? '应用' : 'Apply', onPress: () => void request(mode) },
    ]);
  const inputStyle = { borderWidth: 1, borderColor: theme.colors.borderDefault, borderRadius: 10,
    padding: 12, color: theme.colors.textPrimary, backgroundColor: theme.colors.bgInset };
  return <>
    <SectionHeader title={zh ? '网络与传输' : 'Network & streaming'} />
    <ProductCard>
      <Text style={{ color: theme.colors.textSecondary }}>{zh ? '蓝牙负责配网；视频、点云和遥控通过 Wi-Fi 或安全远程网络传输。' : 'Provision over BLE; use Wi-Fi or a private remote network for video, clouds and control.'}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
        <ProductButton compact label={zh ? '狗子热点' : 'Robot hotspot'} variant={mode === 'hotspot' ? 'primary' : 'secondary'} onPress={() => { setMode('hotspot'); setSsid('dog4-0008'); setPassword(''); }} />
        <ProductButton compact label={zh ? '外部 Wi-Fi' : 'External Wi-Fi'} variant={mode === 'wifi' ? 'primary' : 'secondary'} onPress={() => { setMode('wifi'); setSsid(''); setPassword(''); }} />
      </View>
      <View style={{ gap: 10 }}>
        <TextInput accessibilityLabel="Wi-Fi SSID" placeholder="Wi-Fi SSID" placeholderTextColor={theme.colors.textMuted} style={inputStyle} value={ssid} onChangeText={setSsid} editable={!pending} autoCapitalize="none" />
        <TextInput accessibilityLabel={zh ? 'Wi-Fi 密码' : 'Wi-Fi password'} placeholder={zh ? 'Wi-Fi 密码（热点至少 8 位）' : 'Wi-Fi password (hotspot: at least 8 characters)'} placeholderTextColor={theme.colors.textMuted} style={inputStyle} value={password} onChangeText={setPassword} secureTextEntry editable={!pending} autoCapitalize="none" />
        {mode === 'wifi' && <ProductButton compact label={zh ? '扫描狗子附近 Wi-Fi' : 'Scan nearby Wi-Fi'} variant="secondary" disabled={!ble || pending} onPress={() => void request('scan')} />}
        {mode === 'wifi' && networks.map(name => <ProductButton compact key={name} label={name} variant="ghost" onPress={() => setSsid(name)} />)}
        <ProductButton label={pending ? (zh ? '正在配置…' : 'Configuring…') : (zh ? '通过蓝牙应用配置' : 'Apply over Bluetooth')} icon="wifi-outline" disabled={!ble || pending || !ssid || (mode === 'hotspot' && password.length < 8)} onPress={apply} />
        {!ble && <Text style={{ color: theme.colors.textMuted }}>{zh ? '请先在上方扫描并连接狗子蓝牙。' : 'Scan and connect robot Bluetooth above first.'}</Text>}
        {!!notice && <Text selectable style={{ color: theme.colors.textSecondary }}>{notice}</Text>}
        {snapshot && <Text style={{ color: theme.colors.textSecondary }}>{snapshot.connection} · {snapshot.addresses?.wlan0?.join(', ') || '—'}</Text>}
        <ProductButton compact label={zh ? '打开手机 Wi-Fi 设置' : 'Open phone Wi-Fi settings'} variant="secondary" onPress={() => void (Platform.OS === 'android' ? Linking.sendIntent('android.settings.WIFI_SETTINGS') : Linking.openSettings()).catch(e => setNotice(String(e)))} />
        <Text style={{ color: theme.colors.textSecondary }}>{zh ? 'Wi-Fi / 远程 VPN 地址' : 'Wi-Fi / remote VPN address'}</Text>
        <TextInput accessibilityLabel="Robot network endpoint" style={inputStyle} value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} />
        <ProductButton label={zh ? '连接数据通道' : 'Connect data channel'} icon="link-outline" disabled={pending} onPress={() => {
          useRosStore.getState().setTransportType('foxglove');
          void useRosStore.getState().connectToUrl(endpoint);
        }} />
        <Text style={{ color: theme.colors.textMuted }}>{zh ? 'SIM 远程连接需手机、电脑和狗子加入同一 VPN。此处填写狗子的 VPN 地址:8765；SIM 套餐余量以运营商为准。' : 'For cellular access, join the same VPN on phone, PC and robot. Enter robot VPN address:8765. Carrier quota is provided by your operator.'}</Text>
      </View>
    </ProductCard>
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
