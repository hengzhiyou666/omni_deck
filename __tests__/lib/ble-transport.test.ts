const handlers = new Map<string, (event: any) => void>();
const native = {
  addListener: jest.fn((name: string, callback: (event: any) => void) => {
    handlers.set(name, callback); return { remove: () => handlers.delete(name) };
  }),
  connect: jest.fn(async () => {}), disconnect: jest.fn(async () => {}),
  write: jest.fn(async (value: string) => {
    if (JSON.parse(value).op === 'hello') handlers.get('message')?.({ data: JSON.stringify({
      op: 'hello', topics: [{ name: '/battery_state', type: 'sensor_msgs/msg/BatteryState' }],
    }) });
  }),
};
jest.mock('../../modules/expo-robot-ble/src', () => ({
  get robotBle() { return native; }, requestBlePermission: jest.fn(async () => {}),
}));
import { BleTransport } from '../../lib/ble-transport';

describe('BLE cockpit transport', () => {
  let transport: BleTransport;
  beforeEach(async () => {
    handlers.clear(); jest.clearAllMocks(); transport = new BleTransport();
    await transport.connect('ble://2C:F8:EC:7C:22:95');
  });
  afterEach(() => { transport.disconnect(); });
  const receive = (msg: any) => handlers.get('message')?.({ data: JSON.stringify(msg) });
  it('waits for the real handshake and connects to a Bluetooth address', () => {
    expect(native.connect).toHaveBeenCalledWith('2C:F8:EC:7C:22:95');
    expect(transport.getStatus()).toBe('connected');
  });
  it('subscribes once for shared consumers and does not send cloud/video requests', () => {
    const a = jest.fn(), b = jest.fn();
    const one = transport.subscribe('/battery_state', '', a);
    const two = transport.subscribe('/battery_state', '', b);
    transport.subscribe('/cloud_registered_global', '', jest.fn());
    receive({ op: 'publish', topic: '/battery_state', msg: { percentage: 0.9 } });
    expect(a).toHaveBeenCalledWith({ percentage: 0.9 }); expect(b).toHaveBeenCalledTimes(1);
    one.unsubscribe(); expect(native.write.mock.calls.filter(([s]) => JSON.parse(s).op === 'unsubscribe')).toHaveLength(0);
    two.unsubscribe(); expect(native.write.mock.calls.filter(([s]) => JSON.parse(s).op === 'subscribe')).toHaveLength(1);
  });
  it('matches service responses and surfaces robot rejections', async () => {
    const pending = transport.callService('/omni/control/authority', '', { op: 0 });
    const sent = JSON.parse(native.write.mock.calls.at(-1)![0]);
    expect(sent.args).toEqual({ op: 0 });
    receive({ op: 'service_response', id: sent.id, values: { accepted: true } });
    await expect(pending).resolves.toEqual({ accepted: true });
    const failed = transport.callService('/unsupported', '', {});
    const rejected = expect(failed).rejects.toThrow('not available');
    receive({ op: 'error', id: JSON.parse(native.write.mock.calls.at(-1)![0]).id, error: 'not available' });
    await rejected;
  });
  it('fails pending requests on radio disconnect', async () => {
    const request = transport.callService('/omni/control/authority', '', {});
    const rejected = expect(request).rejects.toThrow('disconnected');
    handlers.get('connection')?.({ connected: false });
    await rejected; expect(transport.getStatus()).toBe('disconnected');
  });
  it('does not transmit control during read-only hardware verification', async () => {
    receive({ op: 'hello', readonly: true, topics: [] });
    expect(() => transport.publish('/rosdeck/posture_command', '', { data: 'stand' })).toThrow('只读');
    await expect(transport.callService('/omni/control/authority', '', {})).rejects.toThrow('只读');
    expect(native.write.mock.calls.map(([s]) => JSON.parse(s).op)).toEqual(['hello']);
  });
  it('coalesces slow velocity writes without delaying authority and keeps release-to-zero', async () => {
    let finish!: () => void;
    native.write.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    transport.publish('/omni/control/teleop', '', { sequence: 1, x: 0.2 });
    for (let sequence = 2; sequence <= 50; sequence++) {
      transport.publish('/omni/control/teleop', '', { sequence, x: 0.4 });
    }
    transport.publish('/omni/control/teleop', '', { sequence: 51, x: 0 });
    const renewal = transport.callService('/omni/control/authority', '', { op: 2 });
    const request = JSON.parse(native.write.mock.calls.at(-1)![0]);
    receive({ op: 'service_response', id: request.id, values: { accepted: true } });
    await renewal;
    expect(native.write.mock.calls.filter(([s]) => JSON.parse(s).op === 'publish')).toHaveLength(1);
    finish(); await Promise.resolve(); await Promise.resolve();
    const sent = native.write.mock.calls.map(([s]) => JSON.parse(s)).filter((m) => m.op === 'publish');
    expect(sent.map((m) => m.msg)).toEqual([{ sequence: 1, x: 0.2 }, { sequence: 51, x: 0 }]);
  });
});
