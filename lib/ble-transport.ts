import { robotBle, requestBlePermission } from '../modules/expo-robot-ble/src';
import type { Subscription, TopicInfo, Transport, TransportStatus } from './transport';

/** Same cockpit APIs, carried over GATT instead of WebSocket. */
export class BleTransport implements Transport {
  private status: TransportStatus = 'disconnected';
  private topics: TopicInfo[] = [];
  private listeners = new Set<(status: TransportStatus, error?: string) => void>();
  private subscriptions = new Map<string, Set<(message: any) => void>>();
  private nativeSubscriptions: Array<{ remove(): void }> = [];
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private hello: (() => void) | null = null;
  private readonly = false;
  private teleopSending = false;
  private latestTeleop: Record<string, unknown> | null = null;

  private state(status: TransportStatus, error?: string) {
    this.status = status;
    this.listeners.forEach((listener) => listener(status, error));
  }
  getStatus() { return this.status; }
  onStatus(listener: (status: TransportStatus, error?: string) => void) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  async connect(url: string) {
    await requestBlePermission();
    this.state('connecting');
    this.nativeSubscriptions = [
      robotBle!.addListener('message', ({ data }: { data: string }) => this.receive(data)),
      robotBle!.addListener('connection', ({ connected }: { connected: boolean }) => {
        if (!connected && this.status === 'connected') {
          this.rejectPending(); this.state('disconnected');
        }
      }),
    ];
    try {
      await robotBle!.connect(url.replace(/^ble:\/\//, ''));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.hello = null; reject(new Error('蓝牙服务未回应 / BLE handshake timed out')); }, 5000);
        this.hello = () => { clearTimeout(timer); resolve(); };
        robotBle!.write(JSON.stringify({ op: 'hello' })).catch((error: Error) => {
          clearTimeout(timer); this.hello = null; reject(error);
        });
      });
      this.state('connected');
    } catch (error) { this.disconnect(); throw error; }
  }
  private receive(data: string) {
    let message: any;
    try { message = JSON.parse(data); } catch { return; }
    if (message.op === 'hello') {
      this.topics = message.topics ?? []; this.readonly = !!message.readonly;
      this.hello?.(); this.hello = null;
    } else if (message.op === 'publish') {
      this.subscriptions.get(message.topic)?.forEach((cb) => cb(message.msg));
    } else if (message.op === 'service_response' || message.op === 'error') {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(message.id);
        message.op === 'error' ? pending.reject(new Error(message.error)) : pending.resolve(message.values);
      }
    }
  }
  private send(message: Record<string, unknown>) {
    if (this.status !== 'connected') return Promise.reject(new Error('Bluetooth disconnected'));
    return robotBle!.write(JSON.stringify(message)) as Promise<void>;
  }
  subscribe(topic: string, _type: string, callback: (msg: any) => void): Subscription {
    // Unsupported large-data topics are absent; never transfer video/cloud over BLE.
    if (!this.topics.some((item) => item.name === topic)) return { unsubscribe() {} };
    let callbacks = this.subscriptions.get(topic);
    if (!callbacks) {
      callbacks = new Set(); this.subscriptions.set(topic, callbacks);
      void this.send({ op: 'subscribe', topic }).catch(() => this.disconnect());
    }
    callbacks.add(callback);
    return { unsubscribe: () => {
      callbacks!.delete(callback);
      if (!callbacks!.size) {
        this.subscriptions.delete(topic);
        if (this.status === 'connected') void this.send({ op: 'unsubscribe', topic }).catch(() => {});
      }
    } };
  }
  publish(topic: string, _type: string, msg: any) {
    if (this.readonly) throw new Error('只读验证中，控制未启用 / Read-only verification');
    const message = { op: 'publish', topic, msg };
    if (topic === '/omni/control/teleop') {
      // Acknowledged BLE writes can be slower than the cockpit update loop.
      // Keep only the newest unsent velocity, including release-to-zero.
      this.latestTeleop = message;
      void this.flushTeleop();
    } else {
      void this.send(message).catch(() => this.disconnect());
    }
  }
  private async flushTeleop() {
    if (this.teleopSending) return;
    this.teleopSending = true;
    try {
      while (this.latestTeleop && this.status === 'connected') {
        const message = this.latestTeleop;
        this.latestTeleop = null;
        await this.send(message);
      }
    } catch { this.disconnect(); }
    finally { this.teleopSending = false; }
  }
  callService(service: string, _type: string, args: Record<string, unknown>, options?: { timeoutMs: number }): Promise<any> {
    if (this.readonly) return Promise.reject(new Error('只读验证中，控制未启用 / Read-only verification'));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Bluetooth service timed out')); }, options?.timeoutMs ?? 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ op: 'call_service', id, service, args }).catch((error: Error) => {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }
  async getTopics() { return this.topics; }
  private rejectPending() {
    this.pending.forEach(({ reject, timer }) => { clearTimeout(timer); reject(new Error('Bluetooth disconnected')); });
    this.pending.clear();
  }
  disconnect() {
    this.latestTeleop = null;
    this.nativeSubscriptions.forEach((s) => s.remove()); this.nativeSubscriptions = [];
    this.rejectPending(); this.subscriptions.clear();
    void robotBle?.disconnect(); this.state('disconnected');
  }
}
