jest.mock('../../hooks/useCmdVelPublisher', () => ({ stopAllTeleop: jest.fn() }));
import { requestPosture, togglePostureStop, usePostureStore } from '../../lib/posture-actions';
import { useRosStore } from '../../stores/useRosStore';
import { useMissionStore } from '../../stores/useMissionStore';
import { useControlAuthorityStore } from '../../stores/useControlAuthorityStore';
import { useCmdVelStore } from '../../stores/useCmdVelStore';
import { CONTROL_CLIENT_ID } from '../../lib/control-authority';
import { MISSION_STATE } from '../../lib/mission/types';
import { resetLocomotionModeState } from '../../lib/locomotion-mode';
import type { Transport } from '../../lib/transport';

describe('shared posture and patrol transaction (mock transport, no robot)', () => {
  let transport: Transport;
  let events: string[];
  let beforeLocoAck: (() => void) | undefined;
  let beforePostureAck: (() => void) | undefined;
  let failPosture: boolean;
  const mission = (state: number, id = 'patrol-1') => useMissionStore.setState({
    status: { state, mission_id: id } as any, missionStatusStale: false,
  });
  beforeEach(() => {
    events = []; beforeLocoAck = undefined; beforePostureAck = undefined; failPosture = false;
    const callbacks = new Map<string, (message: any) => void>();
    transport = {
      getStatus: () => 'connected', connect: jest.fn(), disconnect: jest.fn(),
      onStatus: () => () => {},
      subscribe: (topic, _type, cb) => { callbacks.set(topic, cb); return { unsubscribe: () => callbacks.delete(topic) }; },
      publish: (topic, _type, msg) => {
        if (topic === '/rosdeck/posture_command') {
          const command = msg.data.split(':')[0]; events.push(command); beforePostureAck?.();
          callbacks.get('/rosdeck/posture_status')?.({ data: `${failPosture ? 'error' : 'success'}:${command}:test` });
        } else if (topic === '/rosdeck/locomotion_command') {
          events.push('loco'); beforeLocoAck?.();
          callbacks.get('/rosdeck/locomotion_status')?.({ data: 'success:loco' });
        } else throw new Error(`Unexpected hardware topic ${topic}`);
      },
      getTopics: async () => [{ name: '/rosdeck/locomotion_status', type: 'std_msgs/msg/String' }],
      callService: jest.fn(async (_service, _type, request) => {
        events.push(request.command === 0 ? 'pause' : 'resume');
        if (request.command === 0) mission(MISSION_STATE.PAUSED);
        return { accepted: true, reason_text: '', reason_code: 0 };
      }),
    };
    useRosStore.setState({ transport, connection: { url: 'ws://test:8765', status: 'connected', error: null, ros: null } });
    usePostureStore.setState({ posture: 'unknown', pending: null, pausedMission: null, error: null });
    useControlAuthorityStore.setState({ status: 'acquired', ownerId: CONTROL_CLIENT_ID });
    mission(MISSION_STATE.NONE, ''); resetLocomotionModeState();
  });

  it('shares lie/stand state between the separate buttons and 急停', async () => {
    await requestPosture('lieDown');
    expect(useCmdVelStore.getState().postureInhibited).toBe(true);
    await togglePostureStop();
    expect(events).toEqual(['lie_down', 'stand']);
    expect(usePostureStore.getState().posture).toBe('standing');
    expect(useCmdVelStore.getState().postureInhibited).toBe(false);
  });
  it('pauses first, then lies down; confirms stand and LOCO before resuming the same task', async () => {
    mission(MISSION_STATE.EXECUTING);
    await togglePostureStop(); await togglePostureStop();
    expect(events).toEqual(['pause', 'lie_down', 'stand', 'loco', 'resume']);
    const call = (transport.callService as jest.Mock).mock.calls.at(-1);
    expect(call[2].mission_id).toBe('patrol-1');
  });
  it('does not resurrect a task canceled while stand/LOCO is being confirmed', async () => {
    mission(MISSION_STATE.EXECUTING); await togglePostureStop();
    beforeLocoAck = () => mission(MISSION_STATE.CANCELED);
    await togglePostureStop();
    expect(events).not.toContain('resume');
    expect(usePostureStore.getState().pausedMission).toBeNull();
  });
  it('does not resume after a failed posture confirmation', async () => {
    mission(MISSION_STATE.EXECUTING); await togglePostureStop(); failPosture = true;
    await expect(togglePostureStop()).rejects.toThrow('test');
    expect(events).toEqual(['pause', 'lie_down', 'stand']);
    expect(useCmdVelStore.getState().postureInhibited).toBe(true);
  });
  it('invalidates a pending stand on connection replacement', async () => {
    mission(MISSION_STATE.EXECUTING); await togglePostureStop();
    beforePostureAck = () => useRosStore.setState({ transport: { ...transport } });
    await expect(togglePostureStop()).rejects.toThrow('Connection changed');
    expect(events).not.toContain('resume');
    expect(usePostureStore.getState().pausedMission).toBeNull();
  });
  it('does not infer a posture command while task state is stale', async () => {
    useMissionStore.setState({ missionStatusStale: true });
    await expect(togglePostureStop()).rejects.toThrow('Mission status is stale');
    expect(events).toEqual([]);
  });
});
