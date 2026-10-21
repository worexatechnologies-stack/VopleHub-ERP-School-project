/**
 * Production-ready WebSocket client for real-time school messaging platform.
 * Supports auto-reconnect with backoff, authentication, event deduplication,
 * typing indicators, presence, read receipts, and connection status subscriptions.
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

export interface ChatSocketTypingEvent {
  conversationId: number;
  userId: number;
  userName?: string;
  isTyping: boolean;
}

export interface ChatSocketPresenceEvent {
  userId: number;
  isOnline: boolean;
  lastSeenAt?: string;
}

export interface ChatSocketUnreadEvent {
  totalUnread: number;
  conversationId?: number;
  conversationUnread?: number;
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
  private processedEventIds: Set<string> = new Set();
  private processedEventTimestamps: Array<{ key: string; time: number }> = [];

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

  private isDuplicateEvent(eventType: string, data: any): boolean {
    const rawId = data?.eventId || (data?.data && data.data.eventId) || (eventType === 'message.created' && (data?.id || (data?.data && data.data.id)));
    if (!rawId) return false;

    const dedupeKey = `${eventType}:${rawId}`;
    if (this.processedEventIds.has(dedupeKey)) {
      return true;
    }

    const now = Date.now();
    this.processedEventIds.add(dedupeKey);
    this.processedEventTimestamps.push({ key: dedupeKey, time: now });

    // Clean up events older than 30 seconds (keep memory lean)
    if (this.processedEventTimestamps.length > 200) {
      const cutoff = now - 30000;
      while (this.processedEventTimestamps.length > 0 && this.processedEventTimestamps[0].time < cutoff) {
        const oldest = this.processedEventTimestamps.shift();
        if (oldest) {
          this.processedEventIds.delete(oldest.key);
        }
      }
    }

    return false;
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

    const customWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
    let wsUrl: string;

    if (customWsUrl) {
      const sep = customWsUrl.includes('?') ? '&' : '?';
      wsUrl = `${customWsUrl}${sep}token=${encodeURIComponent(token)}`;
    } else if (apiBaseUrl.startsWith('http')) {
      const urlObj = new URL(apiBaseUrl);
      const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${wsProtocol}//${urlObj.host}/ws/chat/?token=${encodeURIComponent(token)}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // In local dev without reverse proxy, port 3000/5173 points to backend 8000
      const isDevPort = ['3000', '5173'].includes(window.location.port);
      const host = isDevPort ? `${window.location.hostname}:8000` : window.location.host;
      wsUrl = `${protocol}//${host}/ws/chat/?token=${encodeURIComponent(token)}`;
    }

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeat();

        // Automatically rejoin active conversation if set
        if (this.activeConversationId) {
          this.joinConversation(this.activeConversationId);
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventType = data.type;
          if (eventType) {
            if (this.isDuplicateEvent(eventType, data)) {
              return;
            }
            const payload = data.data !== undefined ? data.data : data;
            this.emit(eventType, payload);
            // Universal wildcard listener
            this.emit('*', data);
          }
        } catch (err) {
          console.warn('[ChatSocket] Failed to parse message', err);
        }
      };

      this.socket.onclose = (event: CloseEvent) => {
        this.stopHeartbeat();
        this.setStatus('disconnected');
        // Do not auto-reconnect if rejected for authorization or permission
        if (event && (event.code === 4001 || event.code === 4003)) {
          this.isIntentionallyClosed = true;
          return;
        }
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

  public sendTyping(conversationId: number, isTyping: boolean) {
    this.sendAction('typing', { conversationId, isTyping });
  }
}

export const chatSocket = new ChatSocketClient();
