/**
 * Production-ready WebSocket client for real-time school messaging platform.
 * Supports auto-reconnect with backoff, authentication, group event handling,
 * and connection status subscriptions.
 */
import { ACCESS_TOKEN_STORAGE_KEY } from '../utils/auth';

export type ChatSocketStatus = 'connected' | 'connecting' | 'disconnected';

export interface ChatSocketMessageEvent {
  id: number;
  uuid?: string;
  conversationId: number;
  senderId: number;
  senderName: string;
  recipientId: number;
  recipientName: string;
  isMe: boolean;
  body: string;
  messageType?: string;
  clientKey?: string;
  replyToId?: number;
  editedAt?: string;
  isDeleted?: boolean;
  attachments?: Array<{
    id: string;
    originalName: string;
    contentType: string;
    fileSize: number;
    downloadUrl: string;
  }>;
  createdAt: string;
  readAt?: string | null;
}

export interface ChatSocketReadEvent {
  conversationId: number;
  userId: number;
  readAt: string;
}

type EventListener = (payload: any) => void;
type StatusListener = (status: ChatSocketStatus) => void;

class ChatSocketClient {
  private socket: WebSocket | null = null;
  private status: ChatSocketStatus = 'disconnected';
  public activeConversationId: number | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private eventListeners: Map<string, Set<EventListener>> = new Map();
  private statusListeners: Set<StatusListener> = new Set();
  private isIntentionallyClosed = false;

  public getStatus(): ChatSocketStatus {
    return this.status;
  }

  private setStatus(status: ChatSocketStatus) {
    if (this.status !== status) {
      this.status = status;
      this.statusListeners.forEach((listener) => listener(status));
    }
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  public on(event: string, listener: EventListener): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
    return () => {
      this.eventListeners.get(event)?.delete(listener);
    };
  }

  private emit(event: string, payload: any) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((fn) => fn(payload));
    }
  }

  public connect() {
    if (typeof window === 'undefined') return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (!token) {
      this.setStatus('disconnected');
      return;
    }

    this.isIntentionallyClosed = false;
    this.setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use backend host (port 8000 in dev, or current host)
    const host = window.location.port === '3000' || window.location.port === '5173'
      ? `${window.location.hostname}:8000`
      : window.location.host;

    const wsUrl = `${protocol}//${host}/ws/chat/?token=${encodeURIComponent(token)}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeat();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventType = data.type;
          if (eventType) {
            this.emit(eventType, data.data || data);
            // Universal wildcard listener
            this.emit('*', data);
          }
        } catch (err) {
          console.warn('[ChatSocket] Failed to parse message', err);
        }
      };

      this.socket.onclose = () => {
        this.stopHeartbeat();
        this.setStatus('disconnected');
        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = () => {
        if (this.socket) {
          this.socket.close();
        }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ action: 'ping' }));
      }
    }, 25000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public disconnect() {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  public sendAction(action: string, payload: Record<string, any> = {}) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ action, ...payload }));
    }
  }

  public markConversationRead(conversationId: number) {
    this.sendAction('mark_read', { conversationId });
  }

  public joinConversation(conversationId: number) {
    this.sendAction('join_conversation', { conversationId });
  }
}

export const chatSocket = new ChatSocketClient();
