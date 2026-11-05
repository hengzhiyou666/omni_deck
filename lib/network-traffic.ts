/** Application payload bytes, not TCP/IP overhead or carrier billing. */
let tx = 0, rx = 0;
export function payloadSize(data: unknown): number {
  if (typeof data === 'string') {
    let bytes = 0;
    for (const char of data) { const cp = char.codePointAt(0)!; bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4; }
    return bytes;
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  return 0;
}
export function countPayload(direction: 'tx' | 'rx', data: unknown) {
  if (direction === 'tx') tx += payloadSize(data); else rx += payloadSize(data);
}
export function trafficSnapshot() { return { tx, rx, time: Date.now() }; }
export function sendPayload(socket: WebSocket, data: Parameters<WebSocket['send']>[0]) {
  socket.send(data); countPayload('tx', data);
}
export function meterSocket(socket: WebSocket) {
  const original = socket.send.bind(socket);
  socket.send = data => { original(data); countPayload('tx', data); };
  socket.addEventListener('message', event => countPayload('rx', event.data));
}
export function formatBytes(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}
