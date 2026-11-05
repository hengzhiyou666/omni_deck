import React, { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '../hooks/useAppTheme';
import type { AppTheme } from '../constants/theme';
import { useRosStore } from '../stores/useRosStore';
import { generateAutonomyRequestId } from '../lib/autonomy-runtime';
import { cancelHarnessTest, HARNESS_MESSAGE_TYPE, HARNESS_STATUS_TOPIC, HARNESS_TEST_PROMPT,
  parseHarnessStatus, requestHarnessTask, type HarnessStatus } from '../lib/harness';
import { cancelRobotCommandRecognition, recognizeRobotCommand } from '../lib/robot-speech';

export function HarnessTestControl({ zh, canStart }: { zh: boolean; canStart: boolean }) {
  const { theme, styles } = useThemeStyles(createStyles);
  const transport = useRosStore(s => s.transport);
  const connection = useRosStore(s => s.connection);
  const [status, setStatus] = useState<HarnessStatus | null>(null);
  const [received, setReceived] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [speechText, setSpeechText] = useState('');
  const [listening, setListening] = useState(false);
  const request = useRef('');
  const busy = useRef(false);
  const cancelBusy = useRef(false);
  const voiceBusy = useRef(false);
  const session = useRef(0);
  const mounted = useRef(true);
  const latest = useRef({ transport, connection, canStart, status, received });
  latest.current = { transport, connection, canStart, status, received };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    session.current += 1;
    setStatus(null); setReceived(0); setPending(false); setCancelPending(false);
    setListening(false); voiceBusy.current = false;
    request.current = ''; busy.current = false; cancelBusy.current = false;
    if (!transport || connection.status !== 'connected' || connection.url.startsWith('demo://')) return;
    let active = true;
    const subscription = transport.subscribe(HARNESS_STATUS_TOPIC, HARNESS_MESSAGE_TYPE, message => {
      const value = parseHarnessStatus(message);
      if (!active || !value) return;
      setStatus(value); setReceived(Date.now());
      if (value.request_id === request.current && ['completed', 'failed', 'cancelled'].includes(value.state)) {
        request.current = ''; busy.current = false; cancelBusy.current = false;
        setPending(false); setCancelPending(false);
      }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      session.current += 1; active = false; clearInterval(timer); subscription.unsubscribe();
      if (voiceBusy.current) {
        voiceBusy.current = false;
        void cancelRobotCommandRecognition().catch(() => {});
      }
    };
  }, [transport, connection.status, connection.url]);

  const fresh = connection.status === 'connected' && received > 0 && now - received < 4000;
  const running = status?.state === 'running';
  const cancelling = cancelPending || status?.state === 'cancelling';
  const canCancel = (pending || running) && !cancelling;
  const disabled = !fresh || cancelling || (!canCancel && (!canStart || pending || running || listening));
  const inputDisabled = disabled || canCancel || listening;
  const steps: Record<string, string> = {
    stand_up: zh ? '起立中' : 'Standing',
    move_forward: zh ? '前进中' : 'Moving',
    lie_down: zh ? '卧下中' : 'Lying down',
  };
  const label = !fresh ? (zh ? '测试服务未就绪' : 'Test service offline')
    : cancelling ? (zh ? '停止中' : 'Stopping')
    : canCancel ? (zh ? '停止任务' : 'Stop task')
    : (zh ? '前进1m测试' : 'Forward 1m test');
  const outcome = status?.state === 'completed' ? (zh ? '任务完成' : 'Task completed')
    : status?.state === 'failed' ? (zh ? '任务失败' : 'Task failed')
    : status?.state === 'cancelled' ? (zh ? '任务已停止' : 'Task stopped') : '';
  const readyToSubmit = () => {
    const value = latest.current;
    const ros = useRosStore.getState();
    return Boolean(value.transport && ros.transport === value.transport &&
      ros.connection.status === 'connected' && ros.connection.url === value.connection.url &&
      !ros.connection.url.startsWith('demo://') && value.canStart &&
      value.received > 0 && Date.now() - value.received < 4000 &&
      value.status?.state !== 'running' && value.status?.state !== 'cancelling' &&
      !busy.current && !cancelBusy.current && !voiceBusy.current);
  };
  const submit = (text: string) => {
    if (!readyToSubmit() || !text.trim() || text.trim().length > 2000) return;
    const id = generateAutonomyRequestId('harness');
    request.current = id; busy.current = true; setPending(true);
    Keyboard.dismiss();
    try { requestHarnessTask(latest.current.transport!, text, id); }
    catch (error) {
      // Delivery may be unknown. Wait for matching status instead of resending.
      Alert.alert(zh ? '任务请求结果未知' : 'Task request outcome unknown', String(error));
    }
  };
  const command = () => {
    if (!transport || disabled) return;
    if (canCancel) {
      if (cancelBusy.current) return;
      const id = request.current || status?.request_id;
      if (!id) return;
      request.current = id; cancelBusy.current = true; setCancelPending(true);
      try { cancelHarnessTest(transport, id); }
      catch (error) { Alert.alert(zh ? '停止请求结果未知' : 'Stop request outcome unknown', String(error)); }
      return;
    }
    submit(HARNESS_TEST_PROMPT);
  };
  const recognize = async () => {
    if (voiceBusy.current) {
      const cancelledSession = ++session.current;
      try { await cancelRobotCommandRecognition(); }
      catch { /* The cancelled recognition result must never submit a task. */ }
      finally {
        if (mounted.current && session.current === cancelledSession) {
          voiceBusy.current = false; setListening(false);
        }
      }
      return;
    }
    if (!readyToSubmit()) return;
    const currentSession = session.current;
    voiceBusy.current = true; setListening(true); setSpeechText('');
    Keyboard.dismiss();
    try {
      const text = await recognizeRobotCommand();
      if (!mounted.current) return;
      if (text !== null) setSpeechText(text);
      if (session.current !== currentSession) return;
      voiceBusy.current = false; setListening(false);
      if (text === null) return;
      submit(text);
    } catch (error) {
      if (session.current === currentSession) {
        Alert.alert(zh ? '语音识别失败' : 'Speech recognition failed', String(error));
      }
    } finally {
      if (session.current === currentSession) {
        voiceBusy.current = false; setListening(false);
      }
    }
  };
  const detail = !fresh && pending ? (zh ? '状态中断，任务结果未知；不会自动重发' : 'Status lost; outcome unknown. No automatic retry.')
    : !canStart && !pending && !running && !cancelling ? (zh ? '需机器狗空闲，并释放手机控制权' : 'Robot must be idle with phone control released')
    : running ? steps[status?.step ?? ''] || status?.message : status?.message || outcome;

  return <View style={styles.container}>
    <View style={styles.row}>
      <TextInput accessibilityLabel={zh ? '文字任务' : 'Text task'} style={styles.input}
        placeholder={zh ? '站起来，向前走1.5m，然后卧下' : 'Stand, move forward 1.5m, lie down'}
        placeholderTextColor={theme.colors.textSecondary} value={prompt} onChangeText={setPrompt}
        maxLength={2000} editable={!inputDisabled} returnKeyType="send" onSubmitEditing={() => submit(prompt)} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={zh ? '发送任务' : 'Send task'}
        disabled={inputDisabled || !prompt.trim()} onPress={() => submit(prompt)}
        style={[styles.button, (inputDisabled || !prompt.trim()) && styles.disabled]}>
        <Text style={styles.text}>{zh ? '发送' : 'Send'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
        style={[styles.button, disabled && styles.disabled]} onPress={command}>
        <Ionicons name={canCancel || cancelling ? 'stop-circle-outline' : 'footsteps-outline'} size={15} color={theme.colors.accentPrimary} />
        <Text style={styles.text}>{label}</Text>
      </TouchableOpacity>
    </View>
    <View style={styles.row}>
      <TextInput accessibilityLabel={zh ? '语音识别结果' : 'Speech transcript'} style={styles.input}
        value={speechText} editable={false} placeholder={zh ? '语音识别文字显示在这里' : 'Recognized speech appears here'}
        placeholderTextColor={theme.colors.textSecondary} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={listening ? (zh ? '取消语音' : 'Cancel voice') : (zh ? '语音输入' : 'Voice input')}
        disabled={!listening && inputDisabled} onPress={recognize} style={[styles.button, !listening && inputDisabled && styles.disabled]}>
        <Ionicons name="mic-outline" size={17} color={theme.colors.accentPrimary} />
        <Text style={styles.text}>{listening ? (zh ? '取消语音' : 'Cancel voice') : (zh ? '语音' : 'Voice')}</Text>
      </TouchableOpacity>
    </View>
    <Text style={styles.detail}>{zh ? '语音识别完成后自动执行' : 'Voice commands run after recognition'}</Text>
    {detail ? <Text numberOfLines={2} style={styles.detail}>{detail}</Text> : null}
  </View>;
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  container: { flex: 1, minWidth: 0, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  input: { flex: 1, minWidth: 0, height: 36, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.accentPrimary, color: theme.colors.textPrimary, backgroundColor: theme.colors.bgSurface, fontSize: 12 },
  button: { minHeight: 36, paddingHorizontal: 8, gap: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: theme.colors.accentPrimary, backgroundColor: theme.colors.bgSurface },
  disabled: { opacity: 0.5 },
  text: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '700' },
  detail: { color: theme.colors.textSecondary, fontSize: 10, textAlign: 'center' },
});
