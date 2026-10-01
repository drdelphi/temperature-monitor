export function liveStreamUrl(apiHttpUrl: string, deviceId: string): string {
  const base = apiHttpUrl.endsWith('/') ? apiHttpUrl : `${apiHttpUrl}/`;
  const url = new URL('/v1/stream', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', deviceId);
  return url.toString();
}

export function openLiveStream(
  url: string,
  signal: AbortSignal,
  onMessage: (data: unknown) => void,
): void {
  let closed = false;
  let socket: WebSocket | null = null;
  let timer = 0;
  let delay = 500;

  const connect = () => {
    if (closed || signal.aborted) return;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(String(ev.data)));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onopen = () => {
      delay = 500;
    };
    ws.onclose = () => {
      if (closed || signal.aborted) return;
      timer = window.setTimeout(connect, delay);
      delay = Math.min(delay * 2, 8000);
    };
    ws.onerror = () => {
      ws.close();
    };
  };

  const abort = () => {
    closed = true;
    window.clearTimeout(timer);
    socket?.close();
  };
  signal.addEventListener('abort', abort);
  connect();
}
