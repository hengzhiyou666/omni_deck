jest.mock('../../hooks/useCmdVelPublisher', () => ({ stopAllTeleop: jest.fn() }));
import { observePostureStatus, requestPosture, togglePostureStop, usePostureStore } from '../../lib/posture-actions';
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
  let callbacks: Map<string, Set<(message: any) => void>>;
  const receive = (topic: string, message: any) => {
    for (const callback of [...callbacks.get(topic) ?? []]) callback(message);
  };
  const mission = (state: number, id = 'patrol-1') => useMissionStore.setState({
    status: { state, mission_id: id } as any, missionStatusStale: false,
  });
  beforeEach(() => {
    events = []; beforeLocoAck = undefined; beforePostureAck = undefined; failPosture = false;
    callbacks = new Map();
    transport = {
      getStatus: () => 'connected', connect: jest.fn(), disconnect: jest.fn(),
      onStatus: () => () => {},
      subscribe: jest.fn((topic, _type, cb) => {
        const subscribers = callbacks.get(topic) ?? new Set();
        subscribers.add(cb); callbacks.set(topic, subscribers);
        return { unsubscribe: () => subscribers.delete(cb) };
      }),
      publish: (topic, _type, msg) => {
        if (topic === '/rosdeck/posture_command') {
          const command = msg.data.split(':')[0]; events.push(command); beforePostureAck?.();
          receive('/rosdeck/posture_status', { data: `${failPosture ? 'error' : 'success'}:${command}:test` });
        } else if (topic === '/rosdeck/locomotion_command') {
          events.push('loco'); beforeLocoAck?.();
          receive('/rosdeck/locomotion_status', { data: 'success:loco' });
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
  it('allows manual BLE posture with confirmed APP authority without Mission Manager', async () => {
    useRosStore.setState({ connection: { url: 'ble://2C:F8:EC:7C:22:95', status: 'connected', error: null, ros: null } });
    useMissionStore.setState({ status: null, missionStatusStale: true });
    await requestPosture('stand');
    await togglePostureStop();
    await togglePostureStop();
    expect(events).toEqual(['stand', 'lie_down', 'stand']);
    expect(transport.callService).not.toHaveBeenCalled();
  });
  it('pauses and resumes an active patrol through the full-stack BLE gateway', async () => {
    useRosStore.setState({ connection: { url: 'ble://dog4', status: 'connected', error: null, ros: null } });
    transport.getTopics = async () => [{ name: '/omni/mission/status', type: 'omni_robot_interfaces/msg/MissionStatus' }, { name: '/rosdeck/locomotion_status', type: 'std_msgs/msg/String' }];
    mission(MISSION_STATE.EXECUTING);
    await togglePostureStop(); await togglePostureStop();
    expect(events).toEqual(['pause', 'lie_down', 'stand', 'loco', 'resume']);
  });
  it('rejects posture on full-stack BLE when mission status is stale', async () => {
    useRosStore.setState({ connection: { url: 'ble://dog4', status: 'connected', error: null, ros: null } });
    transport.getTopics = async () => [{ name: '/omni/mission/status', type: 'omni_robot_interfaces/msg/MissionStatus' }, { name: '/rosdeck/locomotion_status', type: 'std_msgs/msg/String' }];
    useMissionStore.setState({ status: null, missionStatusStale: true });
    await expect(requestPosture('stand')).rejects.toThrow('Mission status is stale');
    expect(events).toEqual([]);
  });

  it('syncs harness posture receipts without replaying old joystick input', () => {
    const stop = observePostureStatus(transport);
    try {
      useCmdVelStore.getState().setAxes('/omni/control/teleop', { 'linear.x': 0.4 });
      useCmdVelStore.getState().setPostureInhibited(true);
      receive('/rosdeck/posture_status', { data: 'success:stand' });
      expect(usePostureStore.getState().posture).toBe('standing');
      expect(useCmdVelStore.getState().postureInhibited).toBe(false);
      expect(useCmdVelStore.getState().topics['/omni/control/teleop']['linear.x']).toBe(0);
      useCmdVelStore.getState().setAxes('/omni/control/teleop', { 'linear.x': 0.2 });
      receive('/rosdeck/posture_status', { data: 'success:lie_down' });
      expect(usePostureStore.getState().posture).toBe('lying');
      expect(useCmdVelStore.getState().postureInhibited).toBe(true);
      expect(useCmdVelStore.getState().topics['/omni/control/teleop']['linear.x']).toBe(0);
      expect(events).toEqual([]);
    } finally { stop(); }
  });

  it('keeps another cached control subscribed when one control unmounts', () => {
    const first = observePostureStatus(transport);
    const second = observePostureStatus(transport);
    expect(transport.subscribe).toHaveBeenCalledTimes(2);
    first();
    receive('/rosdeck/posture_status', { data: 'success:stand' });
    expect(usePostureStore.getState().posture).toBe('standing');
    second();
    receive('/rosdeck/posture_status', { data: 'success:lie_down' });
    expect(usePostureStore.getState().posture).toBe('standing');
    const next = observePostureStatus(transport);
    expect(transport.subscribe).toHaveBeenCalledTimes(3);
    next();
  });

  it.each(['error:stand:rejected', 'started:stand', 'success:unknown', 'success:loco'])(
    'does not release the posture gate for %s', message => {
      const stop = observePostureStatus(transport);
      try {
        usePostureStore.setState({ posture: 'lying' });
        useCmdVelStore.getState().setPostureInhibited(true);
        receive('/rosdeck/posture_status', { data: message });
        expect(usePostureStore.getState().posture).toBe('lying');
        expect(useCmdVelStore.getState().postureInhibited).toBe(true);
      } finally { stop(); }
    });

  it('keeps a local stand transaction inhibited until its LOCO confirmation and patrol handling finish', async () => {
    const stop = observePostureStatus(transport);
    try {
      mission(MISSION_STATE.EXECUTING);
      await requestPosture('lieDown');
      beforeLocoAck = () => {
        expect(usePostureStore.getState().pending).toBe('stand');
        expect(useCmdVelStore.getState().postureInhibited).toBe(true);
      };
      await requestPosture('stand');
      expect(events).toEqual(['pause', 'lie_down', 'stand', 'loco', 'resume']);
      expect(useCmdVelStore.getState().postureInhibited).toBe(false);
    } finally { stop(); }
  });

  it.each(['replacement', 'disconnected', 'transport_closed'])(
    'ignores receipts after %s', change => {
      const stop = observePostureStatus(transport);
      try {
        if (change === 'replacement') useRosStore.setState({ transport: { ...transport } });
        if (change === 'disconnected') useRosStore.setState({
          connection: { ...useRosStore.getState().connection, status: 'disconnected' },
        });
        if (change === 'transport_closed') transport.getStatus = () => 'disconnected';
        usePostureStore.setState({ posture: 'lying' });
        useCmdVelStore.getState().setPostureInhibited(true);
        receive('/rosdeck/posture_status', { data: 'success:stand' });
        expect(usePostureStore.getState().posture).toBe('lying');
        expect(useCmdVelStore.getState().postureInhibited).toBe(true);
      } finally { stop(); }
    });
});
