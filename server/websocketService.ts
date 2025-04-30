import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { exchangeService } from './exchangeService';

/**
 * WebSocket service for real-time market data
 */
export class WebSocketService {
  private wss: WebSocketServer;
  private clients: Map<string, Set<WebSocket>> = new Map();
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(server: HttpServer) {
    // Initialize WebSocket server on a dedicated path to avoid conflicts with Vite's HMR
    this.wss = new WebSocketServer({ server, path: '/ws' });
    
    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('WebSocket server initialized');
  }
  
  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket) {
    console.log('New WebSocket connection established');
    
    // Handle client messages
    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'subscribe') {
          await this.handleSubscription(ws, data);
        } else if (data.type === 'unsubscribe') {
          this.handleUnsubscription(ws, data);
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        this.sendError(ws, 'Invalid message format');
      }
    });
    
    // Handle disconnection
    ws.on('close', () => {
      console.log('WebSocket connection closed');
      this.removeClientFromAllChannels(ws);
    });
    
    // Send welcome message
    this.sendMessage(ws, {
      type: 'info',
      message: 'Connected to trading platform WebSocket server'
    });
  }
  
  /**
   * Handle market data subscription request
   */
  private async handleSubscription(ws: WebSocket, data: any) {
    const { symbol, exchange, timeframe, userId } = data;
    
    if (!symbol || !exchange || !timeframe) {
      return this.sendError(ws, 'Missing required parameters');
    }
    
    const channelId = this.getChannelId(symbol, exchange, timeframe);
    
    try {
      // Add client to subscribers for this channel
      if (!this.clients.has(channelId)) {
        this.clients.set(channelId, new Set());
        
        // Start data updates for this channel
        await this.startMarketDataUpdates(channelId, symbol, exchange, timeframe, userId);
      }
      
      // Add this client to the channel subscribers
      this.clients.get(channelId)?.add(ws);
      
      // Store channel info on the websocket object for cleanup
      if (!ws.hasOwnProperty('subscribedChannels')) {
        (ws as any).subscribedChannels = new Set<string>();
      }
      (ws as any).subscribedChannels.add(channelId);
      
      console.log(`Client subscribed to ${channelId}`);
      
      // Send initial data
      const initialData = await exchangeService.getMarketData(symbol, exchange, timeframe, userId);
      
      this.sendMessage(ws, {
        type: 'subscription_success',
        channel: channelId,
        data: initialData
      });
    } catch (error) {
      console.error(`Error subscribing to ${channelId}:`, error);
      this.sendError(ws, `Failed to subscribe to ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Handle unsubscription request
   */
  private handleUnsubscription(ws: WebSocket, data: any) {
    const { symbol, exchange, timeframe } = data;
    
    if (!symbol || !exchange || !timeframe) {
      return this.sendError(ws, 'Missing required parameters');
    }
    
    const channelId = this.getChannelId(symbol, exchange, timeframe);
    this.removeClientFromChannel(ws, channelId);
    
    this.sendMessage(ws, {
      type: 'unsubscription_success',
      channel: channelId
    });
  }
  
  /**
   * Start periodic market data updates for a channel
   */
  private async startMarketDataUpdates(
    channelId: string, 
    symbol: string, 
    exchange: string, 
    timeframe: string,
    userId: number | null
  ) {
    // Stop existing interval if any
    if (this.updateIntervals.has(channelId)) {
      clearInterval(this.updateIntervals.get(channelId)!);
    }
    
    // Determine update interval based on timeframe
    const updateInterval = this.getUpdateIntervalFromTimeframe(timeframe);
    
    // Start new update interval
    const interval = setInterval(async () => {
      try {
        // Only fetch updates if we have subscribers
        if (this.clients.has(channelId) && this.clients.get(channelId)!.size > 0) {
          const marketData = await exchangeService.getMarketData(symbol, exchange, timeframe, userId);
          
          // Broadcast to all subscribers
          this.broadcastToChannel(channelId, {
            type: 'market_data_update',
            channel: channelId,
            data: marketData
          });
        } else {
          // No subscribers left, stop updates
          this.stopMarketDataUpdates(channelId);
        }
      } catch (error) {
        console.error(`Error updating market data for ${channelId}:`, error);
      }
    }, updateInterval);
    
    this.updateIntervals.set(channelId, interval);
    console.log(`Started market data updates for ${channelId} (${updateInterval}ms interval)`);
  }
  
  /**
   * Stop market data updates for a channel
   */
  private stopMarketDataUpdates(channelId: string) {
    if (this.updateIntervals.has(channelId)) {
      clearInterval(this.updateIntervals.get(channelId)!);
      this.updateIntervals.delete(channelId);
      console.log(`Stopped market data updates for ${channelId}`);
    }
  }
  
  /**
   * Remove client from a specific channel
   */
  private removeClientFromChannel(ws: WebSocket, channelId: string) {
    if (this.clients.has(channelId)) {
      this.clients.get(channelId)!.delete(ws);
      
      // Remove from client's subscribed channels list
      if (ws.hasOwnProperty('subscribedChannels')) {
        (ws as any).subscribedChannels.delete(channelId);
      }
      
      // If no more clients for this channel, stop updates
      if (this.clients.get(channelId)!.size === 0) {
        this.clients.delete(channelId);
        this.stopMarketDataUpdates(channelId);
      }
    }
  }
  
  /**
   * Remove client from all subscribed channels
   */
  private removeClientFromAllChannels(ws: WebSocket) {
    if (ws.hasOwnProperty('subscribedChannels')) {
      for (const channelId of (ws as any).subscribedChannels) {
        this.removeClientFromChannel(ws, channelId);
      }
      (ws as any).subscribedChannels.clear();
    }
  }
  
  /**
   * Broadcast message to all clients subscribed to a channel
   */
  private broadcastToChannel(channelId: string, message: any) {
    if (this.clients.has(channelId)) {
      const subscribers = this.clients.get(channelId)!;
      
      for (const client of subscribers) {
        if (client.readyState === WebSocket.OPEN) {
          this.sendMessage(client, message);
        }
      }
    }
  }
  
  /**
   * Get channel ID from symbol, exchange and timeframe
   */
  private getChannelId(symbol: string, exchange: string, timeframe: string): string {
    return `${exchange.toLowerCase()}_${symbol.replace('/', '_')}_${timeframe.toLowerCase()}`;
  }
  
  /**
   * Send a message to a client
   */
  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
  
  /**
   * Send an error message to a client
   */
  private sendError(ws: WebSocket, errorMessage: string) {
    this.sendMessage(ws, {
      type: 'error',
      message: errorMessage
    });
  }
  
  /**
   * Determine appropriate update interval based on timeframe
   */
  private getUpdateIntervalFromTimeframe(timeframe: string): number {
    // Set update frequency based on timeframe
    // Lower timeframes need more frequent updates
    switch (timeframe.toLowerCase()) {
      case '1m':
        return 5000; // 5 seconds
      case '5m':
        return 15000; // 15 seconds
      case '15m':
        return 30000; // 30 seconds
      case '30m':
        return 60000; // 1 minute
      case '1h':
        return 120000; // 2 minutes
      case '4h':
      case '1d':
        return 300000; // 5 minutes
      default:
        return 60000; // 1 minute default
    }
  }
}

export let websocketService: WebSocketService;

/**
 * Initialize the WebSocket service with the HTTP server
 */
export function initWebSocketService(server: HttpServer) {
  websocketService = new WebSocketService(server);
  return websocketService;
}