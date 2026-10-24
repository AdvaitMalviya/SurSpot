import { useCallback, useEffect, useRef, useState } from 'react';
import type { Problem, RoomState, ToClient, ToServer } from '../lib/room';
import { load, save } from '../lib/storage';

// Where the room server is. A build for a real host sets VITE_ROOMS_URL; `npm run dev` runs one on port 8787.
export const ROOMS_URL: string | null =
  import.meta.env.VITE_ROOMS_URL || (import.meta.env.DEV ? `ws://${location.hostname}:8787` : null);
const PING_MS = 20000; // keeps the connection open through proxies that drop quiet ones

export interface Me { pid: string; name: string }
// A random id kept in this browser, so a reload or a dropped connection rejoins as the same player.
export function loadMe(): Me {
  const me = load<Me>('me', { pid: '', name: '' });
  if (!me.pid) {
    me.pid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    save('me', me);
  }
  return me;
}

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'refused';

// One live connection to a room, reconnecting with backoff when it drops. `create` makes the room if it doesn't
// exist yet; it only applies until the first state arrives.
export function useRoom(code: string, me: Me, create: boolean) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [problem, setProblem] = useState<{ problem: Problem; message: string } | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const offset = useRef(0); // server clock minus this one
  const hello = useRef({ me, create });

  useEffect(() => {
    if (!ROOMS_URL) return;
    let finished = false, retries = 0, timer = 0, creating = hello.current.create;
    const connect = () => {
      const ws = new WebSocket(`${ROOMS_URL}/rooms/${code}`);
      socket.current = ws;
      ws.onopen = () => {
        const { pid, name } = hello.current.me;
        ws.send(JSON.stringify({ type: 'hello', pid, name, create: creating } satisfies ToServer));
      };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        const msg = JSON.parse(e.data) as ToClient;
        if (msg.type === 'state') {
          creating = false; retries = 0;
          offset.current = msg.room.now - Date.now();
          setRoom(msg.room); setStatus('open');
        } else {
          finished = true;
          setProblem(msg); setStatus('refused');
        }
      };
      ws.onclose = () => {
        if (finished) return;
        setStatus('reconnecting');
        timer = window.setTimeout(connect, Math.min(8000, 500 * 2 ** retries++));
      };
    };
    connect();
    const ping = window.setInterval(() => socket.current?.readyState === WebSocket.OPEN && socket.current.send('ping'), PING_MS);
    // Back on the page or back online (a phone unlocked, a tunnel passed): reconnect now rather than after the backoff.
    const wake = () => {
      if (finished || document.hidden || socket.current?.readyState !== WebSocket.CLOSED) return;
      clearTimeout(timer); retries = 0;
      connect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      finished = true;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      clearTimeout(timer); clearInterval(ping);
      socket.current?.close();
      socket.current = null;
    };
  }, [code]);

  const send = useCallback((msg: ToServer) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(msg));
  }, []);
  const serverNow = useCallback(() => Date.now() + offset.current, []);
  return { room, status, problem, send, serverNow };
}
