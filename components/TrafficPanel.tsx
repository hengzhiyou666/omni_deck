import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useAppTheme } from '../hooks/useAppTheme';
import { formatBytes, trafficSnapshot } from '../lib/network-traffic';
import { useRosStore } from '../stores/useRosStore';
import { useSettingsStore } from '../stores/useSettingsStore';
export function TrafficPanel({ compact = false }: { compact?: boolean }) {
  const theme = useAppTheme();
  const zh = useSettingsStore(s => s.language) === 'zh';
  const transport = useRosStore(s => s.transport);
  const connected = useRosStore(s => s.connection.status) === 'connected';
  const [app, setApp] = useState({ tx: 0, rx: 0, up: 0, down: 0 });
  const [cell, setCell] = useState<any>(null);
  useEffect(() => {
    let last = trafficSnapshot();
    const timer = setInterval(() => {
      const next = trafficSnapshot(), seconds = Math.max(.001, (next.time-last.time)/1000);
      setApp({ tx: next.tx, rx: next.rx, up: (next.tx-last.tx)/seconds, down: (next.rx-last.rx)/seconds }); last = next;
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setCell(null);
    if (!transport || !connected || compact) return;
    const sub = transport.subscribe('/omni/network/status', 'std_msgs/msg/String', msg => {
      try { setCell({ ...JSON.parse(msg.data), received: Date.now() }); } catch {}
    });
    return sub.unsubscribe;
  }, [transport, connected, compact]);
  const cells = cell?.ready && Date.now()-cell.received < 6000 ? cell.cellular : null;
  const sum = (key: string) => (cells || []).reduce((n: number, c: any) => n + (Number(c[key]) || 0), 0);
  return <View style={{ gap: 5, paddingVertical: compact ? 0 : 12 }}>
    <Text style={{ color: theme.colors.textSecondary, fontSize: compact ? 9 : 12 }}>App ↑ {formatBytes(app.up)}/s · ↓ {formatBytes(app.down)}/s</Text>
    {!compact && <>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{zh ? '本次打开 App 累计' : 'Since App opened'} ↑ {formatBytes(app.tx)} · ↓ {formatBytes(app.rx)}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{zh ? '狗子蜂窝接口' : 'Robot cellular'} {cells ? `↑ ${formatBytes(sum('tx_bps'))}/s · ↓ ${formatBytes(sum('rx_bps'))}/s` : '—'}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{zh ? '蜂窝监测累计' : 'Cellular monitored total'} {cells ? `↑ ${formatBytes(sum('tx_bytes'))} · ↓ ${formatBytes(sum('rx_bytes'))}` : '—'}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{zh ? '↑ 上传，↓ 下载，各自以 App / 狗子为准。App 统计 ROS 和蓝牙载荷，不含 MJPEG/协议开销；蜂窝累计含狗子其他应用流量。不是套餐账单。' : 'Arrows are from App / robot respectively. App counts ROS & BLE payloads, excluding MJPEG and protocol overhead. Cellular totals include other robot apps; not carrier billing.'}</Text>
    </>}
  </View>;
}
