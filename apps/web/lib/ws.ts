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
      if (closed || signal.aborted || socket !== ws) return;
      timer = window.setTimeout(connect, delay);
      delay = Math.min(delay * 2, 8000);
    };
    ws.onerror = () => {
      ws.close();
    };
  };

  /* Phones drop the socket while the tab is in the background, and the backoff
     may be most of a minute by the time the user looks again. Reconnect at once
     when the tab comes back or the network returns. */
  const resume = () => {
    if (closed || signal.aborted || document.hidden) return;
    if (socket && socket.readyState !== WebSocket.CLOSED) return;
    window.clearTimeout(timer);
    delay = 500;
    connect();
  };

  const abort = () => {
    closed = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
    socket?.close();
  };
  signal.addEventListener('abort', abort);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  connect();
}
