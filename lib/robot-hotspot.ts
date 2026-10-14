import type { Transport } from './transport';
import { CONTROL_AUTHORITY_STATUS_TOPIC, CONTROL_AUTHORITY_STATUS_TYPE, parseTypedControlStatus } from './control-authority';

export interface HotspotConnection { ssid: string; password: string; endpoint: string }

export function parseHotspotConnection(value: any): HotspotConnection {
  if (value?.mode !== 'hotspot' || typeof value.ssid !== 'string' || !value.ssid
    || typeof value.password !== 'string' || value.password.length < 8
    || typeof value.endpoint !== 'string') {
    throw new Error('狗端配网服务需更新，未返回热点连接信息 / Update robot provisioning service');
  }
  const url = new URL(value.endpoint);
  if (url.protocol !== 'ws:' || !url.hostname || !url.port || url.username || url.password) {
    throw new Error('狗端返回的连接地址无效 / Invalid robot endpoint');
  }
  return { ssid: value.ssid, password: value.password, endpoint: value.endpoint };
}

/** A socket handshake is not enough: confirm real typed Bridge telemetry.
 * This never acquires control or sends motion commands. */
export function waitForRobotControl(transport: Transport, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: ReturnType<Transport['subscribe']> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.unsubscribe();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error(
      '网络已连接，但未收到狗端控制服务状态。请检查狗端 bringup，无需重新填写密码或 IP。 / Connected, but robot control service is not responding',
    )), timeoutMs);
    try {
      subscription = transport.subscribe(CONTROL_AUTHORITY_STATUS_TOPIC, CONTROL_AUTHORITY_STATUS_TYPE, message => {
        const status = parseTypedControlStatus(message);
        if (!status) return;
        finish(status.state === 'unsupported'
          ? new Error('狗端报告不支持控制权，请检查 Bridge 配置 / Robot reports control unsupported') : undefined);
      });
      if (settled) subscription.unsubscribe();
    } catch (error) { finish(error as Error); }
  });
}
