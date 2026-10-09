import { create } from 'zustand';
import { CONTROL_CLIENT_ID, requestControlAuthority } from './control-authority';
import { ensureLocoMode, resetLocomotionModeState } from './locomotion-mode';
import { pauseMission, resumeMission } from './mission/api';
import { ACTIVE_MISSION_STATES, MISSION_STATE } from './mission/types';
import type { Subscription, Transport } from './transport';
import { useRosStore } from '../stores/useRosStore';
import { useMissionStore } from '../stores/useMissionStore';
import { useControlAuthorityStore } from '../stores/useControlAuthorityStore';
import { useCmdVelStore } from '../stores/useCmdVelStore';
import { stopAllTeleop } from '../hooks/useCmdVelPublisher';

export const POSTURE_COMMAND_TOPIC = '/rosdeck/posture_command';
export const POSTURE_STATUS_TOPIC = '/rosdeck/posture_status';
export const POSTURE_MESSAGE_TYPE = 'std_msgs/msg/String';
export const POSTURE_COMMANDS = { stand: { data: 'stand' }, lieDown: { data: 'lie_down' } } as const;
export type PostureCommand = keyof typeof POSTURE_COMMANDS;
export const buildPostureCommand = (command: PostureCommand) =>
  ({ data: `${POSTURE_COMMANDS[command].data}:${CONTROL_CLIENT_ID}` });
export function parsePostureStatus(message: any) {
  if (typeof message?.data !== 'string') return null;
  const [result, command, ...details] = message.data.split(':');
  return (result === 'success' || result === 'error') && command
    ? { result, command, details: details.join(':') } : null;
}

// Shared by both posture buttons and the user-labelled 急停 toggle.
export const usePostureStore = create<{
  posture: 'unknown' | 'standing' | 'lying'; pending: PostureCommand | null;
  pausedMission: string | null; error: string | null;
}>(() => ({ posture: 'unknown', pending: null, pausedMission: null, error: null }));

let session = 0;
useRosStore.subscribe((current, previous) => {
  if (current.transport !== previous.transport || current.connection.status !== previous.connection.status) {
    ++session;
    usePostureStore.setState({ posture: 'unknown', pending: null, pausedMission: null, error: null });
    useCmdVelStore.getState().setPostureInhibited(false);
    useCmdVelStore.getState().clearAll();
  }
});
useMissionStore.subscribe((current) => {
  const saved = usePostureStore.getState().pausedMission;
  if (saved && !current.missionStatusStale && current.status &&
    (current.status.mission_id !== saved || current.status.state !== MISSION_STATE.PAUSED)) {
    usePostureStore.setState({ pausedMission: null });
  }
});

function checkSession(transport: Transport, expected: number) {
  if (session !== expected || useRosStore.getState().transport !== transport || transport.getStatus() !== 'connected')
    throw new Error('连接已变化，请重新操作 / Connection changed');
}
async function waitFor(transport: Transport, expected: number, predicate: () => boolean, error: string) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    checkSession(transport, expected);
    if (Date.now() >= deadline) throw new Error(error);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  checkSession(transport, expected);
}
function postureAck(transport: Transport, command: PostureCommand, expected: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let subscription: Subscription | null = null;
    let sent = false, done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true; clearTimeout(timer); offStatus(); subscription?.unsubscribe();
      error ? reject(error) : resolve();
    };
    let offStatus = () => {};
    const timer = setTimeout(() => finish(new Error('姿态动作确认超时 / Posture confirmation timed out')), 10000);
    offStatus = transport.onStatus((state) => { if (state !== 'connected') finish(new Error('连接中断 / Disconnected')); });
    try {
      subscription = transport.subscribe(POSTURE_STATUS_TOPIC, POSTURE_MESSAGE_TYPE, (message) => {
        const status = parsePostureStatus(message);
        if (!sent || !status || status.command !== POSTURE_COMMANDS[command].data) return;
        try { checkSession(transport, expected); } catch (e) { finish(e as Error); return; }
        finish(status.result === 'success' ? undefined : new Error(status.details || '姿态动作失败'));
      });
      if (done) { subscription.unsubscribe(); return; }
      checkSession(transport, expected);
      sent = true;
      transport.publish(POSTURE_COMMAND_TOPIC, POSTURE_MESSAGE_TYPE, buildPostureCommand(command));
    } catch (error) { finish(error as Error); }
  });
}

export async function requestPosture(command: PostureCommand): Promise<void> {
  const robot = useRosStore.getState();
  const transport = robot.transport;
  if (!transport || robot.connection.status !== 'connected' || robot.connection.url.startsWith('demo://'))
    throw new Error('请先连接机器狗 / Connect to the robot first');
  if (usePostureStore.getState().pending) throw new Error('姿态动作执行中 / Posture action in progress');
  const expected = session;
  usePostureStore.setState({ pending: command, error: null });
  useCmdVelStore.getState().setPostureInhibited(true);
  stopAllTeleop();
  try {
    const mission = useMissionStore.getState();
    if (mission.missionStatusStale || !mission.status)
      throw new Error('巡检状态未更新，无法确认当前任务 / Mission status is stale');
    const active = ACTIVE_MISSION_STATES.includes(mission.status.state);
    if (command === 'lieDown' && active) {
      const id = mission.status.mission_id;
      if (mission.status.state !== MISSION_STATE.PAUSED) {
        const result = await pauseMission(transport, id);
        if (!result.accepted) throw new Error(result.reason_text || '暂停巡检失败');
        await waitFor(transport, expected, () => {
          const current = useMissionStore.getState();
          return !current.missionStatusStale && current.status?.mission_id === id && current.status.state === MISSION_STATE.PAUSED;
        }, '等待暂停巡检确认超时 / Patrol pause timed out');
      }
      usePostureStore.setState({ pausedMission: id });
    } else if (command === 'stand' && active && mission.status.state !== MISSION_STATE.PAUSED) {
      throw new Error('请先暂停巡检 / Pause patrol first');
    }
    checkSession(transport, expected);
    let authority = useControlAuthorityStore.getState();
    if (authority.status !== 'acquired' || authority.ownerId !== CONTROL_CLIENT_ID) {
      const result = await requestControlAuthority(transport, 'acquire', 'app_posture');
      if (!result.accepted) throw new Error(result.reasonText || '无法获取控制权');
      await waitFor(transport, expected, () => {
        authority = useControlAuthorityStore.getState();
        return authority.status === 'acquired' && authority.ownerId === CONTROL_CLIENT_ID;
      }, '等待控制权超时 / Control authority timed out');
    }
    resetLocomotionModeState();
    await postureAck(transport, command, expected);
    checkSession(transport, expected);
    usePostureStore.setState({ posture: command === 'stand' ? 'standing' : 'lying' });
    if (command === 'stand') {
      const saved = usePostureStore.getState().pausedMission;
      const canResume = () => {
        const current = useMissionStore.getState();
        return saved && usePostureStore.getState().pausedMission === saved && !current.missionStatusStale &&
          current.status?.mission_id === saved && current.status.state === MISSION_STATE.PAUSED;
      };
      if (canResume()) {
        // Wait for posture success and the vendor's LOCO ready response before
        // asking Mission Manager to resume its retained route progress.
        await ensureLocoMode(transport);
        checkSession(transport, expected);
        if (canResume()) {
          useCmdVelStore.getState().setPostureInhibited(false);
          const result = await resumeMission(transport, saved!);
          if (!result.accepted) throw new Error(result.reason_text || '继续巡检失败');
        }
      }
      usePostureStore.setState({ pausedMission: null });
      stopAllTeleop();
      useCmdVelStore.getState().setPostureInhibited(false);
    }
  } catch (error) {
    if (session === expected) usePostureStore.setState({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    if (session === expected) usePostureStore.setState({ pending: null });
  }
}

export function togglePostureStop(): Promise<void> {
  return requestPosture(usePostureStore.getState().posture === 'lying' ? 'stand' : 'lieDown');
}
