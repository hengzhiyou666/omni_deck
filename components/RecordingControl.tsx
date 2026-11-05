import { useThemeStyles } from '../hooks/useAppTheme';
import type { AppTheme } from '../constants/theme';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRosStore } from '../stores/useRosStore';
import { parseRecordingStatus, recordingDuration, RECORDING_STATUS, requestRecording, type RecordingStatus, type RecordingTopic } from '../lib/recording';

const TOPIC_LABELS: Record<string, [string, string]> = {
  '/omni/sensors/lidar/points': ['雷达点云', 'Lidar'],
  '/omni/sensors/imu/data': ['IMU', 'IMU'],
  '/image_left_raw/h265_undistort': ['图像（去畸变后）', 'Undistorted video'],
  '/image_left_raw/h265': ['图像(未去畸变)', 'Raw video'],
  '/tf': ['TF', 'TF'],
  '/tf_static': ['静态TF', 'Static TF'],
  '/omni/tf_manager/body_odom_global': ['定位全局里程计', 'Global odometry'],
  '/omni/tf_manager/body_odom': ['定位机体里程计', 'Body odometry'],
  '/grid_map/occupancy': ['三维占据地图', '3D occupancy'],
  '/grid_map/occupancy_inflate': ['膨胀地图', 'Inflated map'],
  '/omni/mission/global_path': ['全局路径', 'Global path'],
  '/planning/local_path': ['局部路径', 'Local path'],
  '/cloud_registered_global': ['全局配准点云', 'Registered cloud'],
  '/Laser_map': ['地图点云', 'Map cloud'],
  '/omni/mission/runtime/status': ['运行状态', 'Runtime'],
  '/omni/slam/status': ['SLAM状态', 'SLAM'],
  '/omni/mission/status': ['任务状态', 'Mission'],
  '/omni/control/authority/status': ['控制权状态', 'Control authority'],
  '/scan_planner/cmd_vel': ['规划速度', 'Planned velocity'],
  '/vel_cmd': ['机体速度指令', 'Velocity command'],
};

export function RecordingControl({ zh }: { zh: boolean }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const { width } = useWindowDimensions();
  const transport = useRosStore((s) => s.transport);
  const connection = useRosStore((s) => s.connection);
  const [status, setStatus] = useState<RecordingStatus | null>(null);
  const [received, setReceived] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const busy = useRef(false);
  useEffect(() => {
    setStatus(null); setReceived(0); setPending(false); setSetupOpen(false); setSelected([]); busy.current = false;
    if (!transport || connection.status !== 'connected' || connection.url?.startsWith('demo://')) return;
    let active = true;
    const sub = transport.subscribe(RECORDING_STATUS, 'std_msgs/msg/String', (message) => {
      const value = parseRecordingStatus(message);
      if (active && value) { setStatus(value); setReceived(Date.now()); }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); sub.unsubscribe(); };
  }, [transport, connection.status, connection.url]);
  useEffect(() => {
    if (!setupOpen) return;
    const required = (status?.topics ?? []).filter(topic => topic.required).map(topic => topic.name);
    setSelected(current => {
      const missing = required.filter(name => !current.includes(name));
      return missing.length ? [...current, ...missing] : current;
    });
  }, [setupOpen, status?.topics]);
  const fresh = connection.status === 'connected' && received > 0 && now - received < 4000;
  const recording = status?.state === 'recording';
  const disabled = !fresh || pending || status?.state === 'starting' || status?.state === 'stopping';
  const label = !fresh ? (zh ? '录包未就绪' : 'Recorder offline')
    : pending || status?.state === 'starting' ? (zh ? '请求处理中' : 'Starting…')
    : status?.state === 'stopping' ? (zh ? '正在保存' : 'Saving…')
    : recording ? (zh ? '停止录包' : 'Stop recording') : (zh ? '开始录包' : 'Record bag');
  const command = async (action: 'start' | 'stop') => {
    if (!transport || disabled || busy.current || (action === 'start' && !canConfirm)) return;
    busy.current = true; setPending(true);
    try {
      await requestRecording(transport, action, action === 'start' ? selected : undefined);
      if (useRosStore.getState().transport === transport) setSetupOpen(false);
    }
    catch (e) {
      if (useRosStore.getState().transport === transport) Alert.alert(zh ? '录包请求异常' : 'Recording request failed', String(e));
    } finally {
      if (useRosStore.getState().transport === transport) { busy.current = false; setPending(false); }
    }
  };
  const detail = status?.error || (status?.missing_topics.length
    ? (zh ? `缺少 ${status.missing_topics.length} 个话题，点此查看` : `${status.missing_topics.length} missing topics; details`)
    : status?.state === 'saved' ? (zh ? '已保存，点此查看' : 'Saved; details') : '');
  const topics = status?.topics ?? [];
  const topicLabel = (name: string) => TOPIC_LABELS[name]?.[zh ? 0 : 1] || name.split('/').pop() || name;
  const age = (topic: RecordingTopic) => topic.last_message_age_sec === null ? null
    : topic.last_message_age_sec + Math.max(0, now - received) / 1000;
  const isPublished = (topic: RecordingTopic) => {
    const lastAge = age(topic);
    return topic.publisher_count > 0 && topic.received &&
      (topic.transient_local || (lastAge !== null && lastAge <= 2));
  };
  const orderedTopics = topics.filter(isPublished).concat(topics.filter(topic => !isPublished(topic)));
  const requiredUnavailable = topics.filter(topic => {
    const lastAge = age(topic);
    return topic.required && (topic.publisher_count === 0 || !topic.received || lastAge === null || lastAge > 2);
  });
  const missingSelected = topics.filter(topic => selected.includes(topic.name) && !topic.received).length;
  const canConfirm = !disabled && !recording && topics.length > 0 && selected.length > 0 && requiredUnavailable.length === 0 &&
    topics.every(topic => !topic.required || selected.includes(topic.name));
  return <View style={styles.container}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={() => {
        if (recording) void command('stop');
        else { setSelected(topics.filter(topic => topic.name !== '/image_left_raw/h265').map(topic => topic.name)); setSetupOpen(true); }
      }} style={[styles.button, recording && styles.recording, disabled && styles.disabled]}>
      <Ionicons name={recording ? 'stop-circle-outline' : 'radio-button-on'} size={17} color={theme.colors.statusError} />
      <Text style={styles.text}>{label}</Text>
      {fresh && status && ['recording', 'stopping'].includes(status.state)
        ? <Text style={styles.time}>{recordingDuration(status.duration_sec)} · {(status.size_bytes / 1048576).toFixed(0)} MB</Text> : null}
    </TouchableOpacity>
    {fresh && detail ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={zh ? '录包详情' : 'Recording details'}
      onPress={() => Alert.alert(zh ? '录包详情' : 'Recording details', [status?.directory, status?.error,
        status?.missing_topics.length ? `${zh ? '未录到话题' : 'Missing topics'}:\n${status.missing_topics.join('\n')}` : '',
        `${recordingDuration(status?.duration_sec ?? 0)} · ${((status?.size_bytes ?? 0) / 1048576).toFixed(1)} MB`].filter(Boolean).join('\n\n'))}>
      <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
    </TouchableOpacity> : null}
    <Modal visible={setupOpen} transparent animationType="fade" onRequestClose={() => { if (!pending) setSetupOpen(false); }}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{zh ? '录包话题检查' : 'Recording topics'}</Text>
          <Text style={styles.hint}>{zh
            ? '必录：雷达、IMU、图像（去畸变后）；图像(未去畸变)默认不录，其他项可选。'
            : 'Required: lidar, IMU, undistorted video. Raw video is off by default; other topics are optional.'}</Text>
          {!fresh ? <Text style={styles.warning}>{zh ? '录包状态已中断，暂不能开始' : 'Recorder status lost; cannot start'}</Text> : null}
          {!topics.length ? <Text style={styles.warning}>{zh
            ? '狗端未提供话题检查列表，请升级录包服务'
            : 'Topic checks unavailable. Update the robot recording service.'}</Text> : null}
          {requiredUnavailable.length > 0 ? <Text style={styles.warning}>{zh
            ? `必录未就绪：${requiredUnavailable.map(topic => topicLabel(topic.name)).join('、')}`
            : `Required not ready: ${requiredUnavailable.map(topic => topicLabel(topic.name)).join(', ')}`}</Text> : null}
          <ScrollView style={styles.topicList} contentContainerStyle={styles.topicGrid}>
            {orderedTopics.map(topic => {
              const checked = selected.includes(topic.name);
              const lastAge = age(topic);
              const published = isPublished(topic);
              return <TouchableOpacity key={topic.name} accessibilityRole="checkbox" accessibilityLabel={topic.name}
                accessibilityState={{ checked, disabled: topic.required || pending }} disabled={topic.required || pending}
                style={[styles.topicRow, width >= 720 && styles.topicRowWide,
                  published ? checked ? styles.publishedSelected : styles.publishedUnselected : styles.unpublished]}
                onPress={() => setSelected(current => current.includes(topic.name) ? current.filter(name => name !== topic.name) : [...current, topic.name])}>
                <View style={styles.topicBody}>
                  <View style={styles.topicLine}>
                    <Text numberOfLines={1} style={styles.topicName}>{topicLabel(topic.name)}</Text>
                    {topic.required ? <Text style={styles.required}>{zh ? '必录' : 'REQ'}</Text> : null}
                    <Text style={[styles.topicState, !published && styles.inactiveText]}>{published
                      ? (zh ? '发布中' : 'Live') : (zh ? '未发布' : 'Offline')}</Text>
                    <Text numberOfLines={1} style={styles.frequency}>{topic.frequency_hz === undefined ? '--Hz' : `${topic.frequency_hz.toFixed(1)}Hz`}</Text>
                  </View>
                  <View style={styles.topicLine}>
                    <Text numberOfLines={1} style={styles.topicPath}>{topic.name}</Text>
                    <Text style={styles.topicMeta}>{zh ? `源${topic.publisher_count}` : `Pub ${topic.publisher_count}`}
                      {lastAge !== null ? ` · ${lastAge.toFixed(1)}s` : ''}</Text>
                  </View>
                </View>
                <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={18} color={theme.colors.accentPrimary} />
              </TouchableOpacity>;
            })}
          </ScrollView>
          <View style={styles.actions}>
            <Text style={styles.summary}>{zh
              ? `已选 ${selected.length}/${topics.length} · 未收样 ${missingSelected}`
              : `${selected.length}/${topics.length} selected · ${missingSelected} no sample`}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={zh ? '取消录包' : 'Cancel recording'}
              disabled={pending} onPress={() => setSetupOpen(false)} style={styles.secondaryButton}>
              <Text style={styles.text}>{zh ? '取消' : 'Cancel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={zh ? '确认开始录包' : 'Confirm recording'}
              disabled={!canConfirm} onPress={() => void command('start')}
              style={[styles.primaryButton, !canConfirm && styles.disabled]}>
              <Text style={styles.primaryText}>{pending ? (zh ? '正在开始…' : 'Starting…') : (zh ? '确认开始录包' : 'Start recording')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}
const createStyles = (theme: AppTheme) => StyleSheet.create({
  container: { flex: 1, minWidth: 0, gap: 2 },
  button: { minHeight: 44, paddingHorizontal: 9, gap: 5, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: theme.colors.statusError + '66', backgroundColor: theme.colors.bgSurface },
  recording: { backgroundColor: theme.colors.statusErrorGlow, borderColor: theme.colors.statusError },
  disabled: { opacity: 0.5 }, text: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '700' },
  time: { color: theme.colors.textSecondary, fontSize: 10 }, detail: { fontSize: 10, color: theme.colors.statusConnecting, textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 4, backgroundColor: '#00000088' },
  dialog: { width: '98%', height: '96%', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: theme.colors.borderDefault, backgroundColor: theme.colors.bgElevated },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700' },
  hint: { color: theme.colors.textSecondary, fontSize: 10, lineHeight: 13, marginVertical: 3 },
  warning: { color: theme.colors.statusConnecting, fontSize: 9 },
  topicList: { flex: 1, marginVertical: 3 },
  topicGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  topicRow: { width: '49%', height: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 3, marginBottom: 2, borderWidth: 1.5, borderRadius: 4 },
  topicRowWide: { width: '32.5%' },
  publishedUnselected: { backgroundColor: '#E5F3E8', borderColor: '#CEE2D4' },
  publishedSelected: { backgroundColor: '#CFEBD6', borderColor: '#E3AFC7' },
  unpublished: { backgroundColor: '#ECEFEE', borderColor: '#D3D9D6' },
  topicBody: { flex: 1, minWidth: 0 },
  topicLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  topicName: { flex: 1, color: '#294736', fontSize: 11, lineHeight: 14, fontWeight: '600' },
  topicPath: { flex: 1, color: '#5C7265', fontSize: 9, lineHeight: 12 },
  topicMeta: { color: '#5C7265', fontSize: 9, lineHeight: 12 },
  required: { width: 18, color: '#425D4C', fontSize: 8, lineHeight: 12 },
  topicState: { width: 36, color: '#2E6B42', textAlign: 'center', fontSize: 9, lineHeight: 12 },
  inactiveText: { color: '#6B7470' },
  frequency: { width: 42, color: '#425D4C', textAlign: 'right', fontSize: 9, lineHeight: 12 },
  summary: { flex: 1, color: theme.colors.textSecondary, fontSize: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  secondaryButton: { minHeight: 34, minWidth: 60, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.borderDefault, borderRadius: 8 },
  primaryButton: { minHeight: 34, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.colors.accentPrimary },
  primaryText: { color: theme.colors.onAccent, fontSize: 12, fontWeight: '700' },
});
