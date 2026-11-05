import { parseHotspotConnection, waitForRobotControl } from '../../lib/robot-hotspot';
import type { Transport } from '../../lib/transport';

describe('hotspot handoff', () => {
  it('uses the endpoint and credentials returned by the selected robot', () => {
    expect(parseHotspotConnection({ mode: 'hotspot', ssid: 'robot', password: 'password', endpoint: 'ws://192.168.50.1:8765' }).endpoint)
      .toBe('ws://192.168.50.1:8765');
    expect(() => parseHotspotConnection({ mode: 'hotspot', ssid: 'robot', endpoint: 'ws://192.168.50.1:8765' })).toThrow('配网服务需更新');
  });

  it('does not report ready from socket connection or malformed status', async () => {
    jest.useFakeTimers();
    let callback!: (message: any) => void;
    const unsubscribe = jest.fn();
    const transport = { subscribe: jest.fn((_topic, _type, cb) => {
      callback = cb; return { unsubscribe };
    }) } as unknown as Transport;
    try {
      const ready = jest.fn();
      const result = waitForRobotControl(transport, 1000).then(ready);
      callback({});
      expect(ready).not.toHaveBeenCalled();
      callback({ state: 1 });
      await result;
      expect(ready).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('reports missing robot services and removes the temporary subscription', async () => {
    jest.useFakeTimers();
    const unsubscribe = jest.fn();
    const transport = { subscribe: () => ({ unsubscribe }) } as unknown as Transport;
    try {
      const result = waitForRobotControl(transport, 1000);
      const error = expect(result).rejects.toThrow('未收到狗端控制服务状态');
      await jest.advanceTimersByTimeAsync(1000);
      await error;
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
});
