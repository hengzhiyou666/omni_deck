import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRosStore } from '../stores/useRosStore';
import { parseRecordingStatus, recordingDuration, RECORDING_STATUS, requestRecording, type RecordingStatus } from '../lib/recording';

export function RecordingControl({ zh }: { zh: boolean }) {
  const transport = useRosStore((s) => s.transport);
  const connection = useRosStore((s) => s.connection);
  const [status, setStatus] = useState<RecordingStatus | null>(null);
  const [received, setReceived] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    setStatus(null); setReceived(0); setPending(false); busy.current = false;
    if (!transport || connection.status !== 'connected' || connection.url?.startsWith('demo://')) return;
    let active = true;
    const sub = transport.subscribe(RECORDING_STATUS, 'std_msgs/msg/String', (message) => {
      const value = parseRecordingStatus(message);
      if (active && value) { setStatus(value); setReceived(Date.now()); }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); sub.unsubscribe(); };
  }, [transport, connection.status, connection.url]);
  const fresh = connection.status === 'connected' && received > 0 && now - received < 4000;
  const recording = status?.state === 'recording';
  const disabled = !fresh || pending || status?.state === 'starting' || status?.state === 'stopping';
  const label = !fresh ? (zh ? '录包未就绪' : 'Recorder offline')
    : pending || status?.state === 'starting' ? (zh ? '请求处理中' : 'Starting…')
    : status?.state === 'stopping' ? (zh ? '正在保存' : 'Saving…')
    : recording ? (zh ? '停止录包' : 'Stop recording') : (zh ? '开始录包' : 'Record bag');
  const command = async () => {
    if (!transport || disabled || busy.current) return;
    busy.current = true; setPending(true);
    try { await requestRecording(transport, recording ? 'stop' : 'start'); }
    catch (e) {
      if (useRosStore.getState().transport === transport) Alert.alert(zh ? '录包请求异常' : 'Recording request failed', String(e));
    } finally {
      if (useRosStore.getState().transport === transport) { busy.current = false; setPending(false); }
    }
  };
  const detail = status?.error || (status?.missing_topics.length
    ? (zh ? `缺少 ${status.missing_topics.length} 个话题，点此查看` : `${status.missing_topics.length} missing topics; details`)
    : status?.state === 'saved' ? (zh ? '已保存，点此查看' : 'Saved; details') : '');
  return <View style={styles.container}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={() => void command()} style={[styles.button, recording && styles.recording, disabled && styles.disabled]}>
      <Ionicons name={recording ? 'stop-circle-outline' : 'radio-button-on'} size={17} color="#FF7979" />
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
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, minWidth: 0, gap: 2 },
  button: { minHeight: 44, paddingHorizontal: 9, gap: 5, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#FF797955', backgroundColor: '#18262D' },
  recording: { backgroundColor: '#3B2229', borderColor: '#FF7979' },
  disabled: { opacity: 0.5 }, text: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  time: { color: '#E8CDD0', fontSize: 10 }, detail: { fontSize: 10, color: '#FFCC8A', textAlign: 'center' },
});
