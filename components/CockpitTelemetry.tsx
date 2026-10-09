import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { OMNI_BASE_FRAME, OMNI_MAP_FRAME, OMNI_ODOM_FRAME } from '../lib/frames';
import { useRosStore } from '../stores/useRosStore';
import { useMissionStore } from '../stores/useMissionStore';
import { useControlAuthorityStore } from '../stores/useControlAuthorityStore';
import { useAutonomyRuntimeStore } from '../stores/useAutonomyRuntimeStore';

const SLAM_NAMES = [
  ['未启动定位', 'Inactive'], ['建图启动中', 'Starting mapping'],
  ['建图中', 'Mapping'], ['保存地图中', 'Saving map'],
  ['地图已保存', 'Map saved'], ['定位启动中', 'Starting localization'],
  ['重定位中', 'Relocalizing'], ['定位正常', 'Localized'],
  ['定位退化', 'Degraded'], ['定位丢失', 'Localization lost'],
  ['停止中', 'Stopping'], ['建图／定位错误', 'SLAM error'],
];
type BodyPosition = { x: number; y: number; z: number; frame: string; received: number };

export function CockpitTelemetry({ zh }: { zh: boolean }) {
  const transport = useRosStore((s) => s.transport);
  const connection = useRosStore((s) => s.connection.status);
  const battery = useMissionStore((s) => s.robotStrip?.battery_percentage);
  const robotStale = useMissionStore((s) => s.robotStateStale);
  const authority = useControlAuthorityStore((s) => s.status);
  const runtimeError = useAutonomyRuntimeStore((s) => s.lastError);
  const runtime = useAutonomyRuntimeStore((s) => s.status);
  const [slam, setSlam] = useState<{ state: number; reason: string; received: number } | null>(null);
  const [global, setGlobal] = useState<BodyPosition | null>(null);
  const [local, setLocal] = useState<BodyPosition | null>(null);
  const [now, setNow] = useState(Date.now());
  const [slamError, setSlamError] = useState('');
  useEffect(() => {
    if (runtimeError) Alert.alert(zh ? '建图／路线任务异常' : 'Mapping / route error', runtimeError);
  }, [runtimeError]);
  useEffect(() => {
    if (slamError && slamError !== runtimeError)
      Alert.alert(zh ? '建图／定位异常' : 'SLAM error', slamError);
  }, [slamError]);

  useEffect(() => {
    setSlam(null); setGlobal(null); setLocal(null); setSlamError('');
    let active = true;
    if (!transport || connection !== 'connected') return;
    const subscribePose = (topic: string, frame: string, update: (p: BodyPosition) => void) =>
      transport.subscribe(topic, 'nav_msgs/msg/Odometry', (message: any) => {
        if (!active) return;
        const p = message?.pose?.pose?.position;
        if (message?.header?.frame_id !== frame || message?.child_frame_id !== OMNI_BASE_FRAME ||
          !p || ![p.x, p.y, p.z].every(Number.isFinite)) return;
        if (frame === OMNI_MAP_FRAME && useAutonomyRuntimeStore.getState().status?.mode === 1) return;
        update({ ...p, frame, received: Date.now() });
      });
    const subscriptions = [
      transport.subscribe('/omni/slam/mapping_body_path', 'nav_msgs/msg/Path', (message: any) => {
        if (!active || useAutonomyRuntimeStore.getState().status?.mode !== 1 || message?.header?.frame_id !== OMNI_MAP_FRAME) return;
        const poses = message.poses;
        const p = Array.isArray(poses) ? poses[poses.length - 1]?.pose?.position : null;
        if (p && [p.x, p.y, p.z].every(Number.isFinite)) setGlobal({ ...p, frame: OMNI_MAP_FRAME, received: Date.now() });
      }),
      subscribePose('/omni/tf_manager/body_odom_global', OMNI_MAP_FRAME, setGlobal),
      subscribePose('/omni/tf_manager/body_odom', OMNI_ODOM_FRAME, setLocal),
      transport.subscribe('/omni/slam/status', 'omni_tf_manager/msg/SlamStatus', (message: any) => {
        if (!active || !Number.isInteger(message?.state)) return;
        if (message.state === 2 && message.initialized === false)
          setSlamError(zh ? '建图数据未更新，请检查雷达、IMU 和定位输出' : 'Mapping data is stale; check LiDAR, IMU and odometry');
        else if ([8, 9, 11].includes(message.state))
          setSlamError(message.reason_text || (zh ? '建图／定位异常' : 'SLAM error'));
        else if ([1, 5].includes(message.state)) setSlamError('');
        setSlam({ state: message.state, reason: message.reason_text || '', received: Date.now() });
      }),
    ];
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => { active = false; subscriptions.forEach((s) => s.unsubscribe()); clearInterval(timer); };
  }, [transport, connection]);

  const connected = connection === 'connected';
  const slamFresh = connected && slam && now - slam.received < 3500;
  // Local coordinates are explicitly identified; never substitute odom for map silently.
  const position = connected && global && now - global.received < 1500 ? global
    : connected && local && now - local.received < 1500 ? local : null;
  const stateText = slamFresh ? (SLAM_NAMES[slam.state]?.[zh ? 0 : 1] || (zh ? '状态未知' : 'Unknown'))
    : (zh ? '定位状态未更新' : 'SLAM status stale');
  const authorityText: Record<string, string> = zh ? {
    acquired: '手动控制', override_acquired: '人工覆盖', available: '可接管',
    override_available: '自动控制', stale: '控制权已过期', detecting: '检测中',
    owned_by_other: '其他终端控制', acquiring: '接管中', releasing: '释放中',
    cooldown: '等待释放', error: '控制权异常', disconnected: '未连接', unsupported: '不支持控制权',
  } : {};
  const error = runtimeError || slamError;
  const batteryText = connected && !robotStale && Number.isFinite(battery) && battery! >= 0 && battery! <= 100
    ? `${Math.round(battery!)}%` : '—';
  return (
    <View style={styles.panel} pointerEvents="none">
      <Text style={[styles.text, (!slamFresh || [8, 9, 11].includes(slam?.state ?? 0)) && styles.error]}>
        {stateText} · {zh ? '电量' : 'Battery'} {batteryText} · {authorityText[authority] || authority}
      </Text>
      <Text style={styles.text}>
        {position ? `X ${position.x.toFixed(2)}  Y ${position.y.toFixed(2)}  Z ${position.z.toFixed(2)} m (${position.frame})`
          : (zh ? 'X —  Y —  Z —（位姿未更新）' : 'X —  Y —  Z — (pose stale)')}
      </Text>
      {runtime && [1, 3, 4].includes(runtime.phase) && runtime.reason_text
        ? <Text style={styles.text}>{runtime.reason_text}</Text> : null}
      {error ? <Text style={styles.error} numberOfLines={2}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#071116C0', gap: 3 },
  text: { color: '#E7F0F1', fontSize: 11, textAlign: 'left' },
  error: { color: '#FF8D83', fontSize: 11, textAlign: 'left' },
});
