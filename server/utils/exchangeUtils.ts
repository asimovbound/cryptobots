/**
 * Utility functions for working with cryptocurrency exchanges
 */
import * as ccxt from 'ccxt';
import { Exchange, SupportedExchange } from "@shared/schema";
import { storage } from "../storage";

/**
 * Interface for data returned when checking exchange support
 */
export interface ExchangeSupportCheck {
  id: string;
  name: string;
  hasPublicAPI: boolean;
  hasFetchOHLCV: boolean;
  hasFetchTicker: boolean;
  hasFetchOrderBook: boolean;
  supportsMarketOrders: boolean;
  supportsLimitOrders: boolean;
  supportsMarginTrading: boolean;
  supportedTimeframes: string[];
  notes?: string;
}

/**
 * Structure for CCXT exchange instance cache
 */
interface ExchangeCacheEntry {
  instance: ccxt.Exchange;
  lastUsed: number;
  isPublicOnly: boolean;
}

/**
 * Manage CCXT exchange instances with caching and proper resource handling
 */
export class ExchangeInstanceManager {
  // Cache of CCXT exchange instances with composite keys (exchangeId + apiKey hash)
  private exchangeInstances: Map<string, ExchangeCacheEntry> = new Map();
  private maxCacheAge: number = 1000 * 60 * 30; // 30 minutes
  private lastCleanup: number = Date.now();
  private cleanupInterval: number = 1000 * 60 * 5; // 5 minutes
  
  /**
   * Get a CCXT exchange instance, either from cache or by creating a new one
   * @param exchange The exchange configuration
   * @returns A configured CCXT exchange instance
   */
  async getExchangeInstance(exchange: Exchange): Promise<ccxt.Exchange> {
    // First check if we need to clean up old instances
    this.cleanupStaleInstances();
    
    // Generate a composite cache key for this exchange
    const cacheKey = this.createCacheKey(exchange);
    
    // Check if we already have an instance for this exchange with these API keys
    if (this.exchangeInstances.has(cacheKey)) {
      const entry = this.exchangeInstances.get(cacheKey)!;
      
      // Update last used timestamp
      entry.lastUsed = Date.now();
      
      // Check if credentials changed for non-public instances
      if (!entry.isPublicOnly && exchange.apiKey && entry.instance.apiKey !== exchange.apiKey) {
        console.log(`API credentials changed for ${exchange.name}, creating new instance`);
      } else {
        console.log(`Using cached CCXT instance for ${exchange.name} [${cacheKey}]`);
        return entry.instance;
      }
    }
    
    console.log(`Creating new CCXT instance for ${exchange.name} [${cacheKey}]`);
    
    // Create a new exchange instance
    const exchangeId = exchange.name.toLowerCase();
    
    // Check if this exchange is supported by CCXT
    if (!(exchangeId in ccxt)) {
      throw new Error(`Exchange ${exchangeId} is not supported by CCXT`);
    }
    
    let exchangeOptions: any = { 
      enableRateLimit: true,
      timeout: 30000,
      // Add rate limiting options to avoid hitting API limits
      rateLimit: 1000, // milliseconds between requests
      retry: {
        enabled: true,
        maxRetries: 3
      }
    };
    
    // Add API credentials if available
    const isPublicOnly = !exchange.apiKey || !exchange.apiSecret;
    if (!isPublicOnly) {
      exchangeOptions.apiKey = exchange.apiKey;
      exchangeOptions.secret = exchange.apiSecret;
      
      // Add additional credentials if needed for specific exchanges
      if (exchangeId === 'kucoin' && exchange.apiKeyLabel) {
        exchangeOptions.password = exchange.apiKeyLabel;
      }
      
      if ((exchangeId === 'okx' || exchangeId === 'bitget') && exchange.apiKeyLabel) {
        exchangeOptions.password = exchange.apiKeyLabel;
      }
      
      // If the credentials are supposed to be for a testnet/sandbox and the
      // exchange supports it, configure it here
      if (exchange.isDemo === true) {
        if (['binance', 'binanceus', 'kucoin', 'bybit', 'bitmex'].includes(exchangeId)) {
          console.log(`Configuring ${exchangeId} for testnet/sandbox mode`);
          exchangeOptions.testnet = true;
        }
      }
    }
    
    try {
      // Create and configure the exchange instance
      const instance = new (ccxt as any)[exchangeId](exchangeOptions);
      
      // Set up proxy if needed (for some exchanges that might be blocked)
      if (process.env.HTTP_PROXY) {
        instance.proxy = process.env.HTTP_PROXY;
      }
      
      // Cache the instance
      this.exchangeInstances.set(cacheKey, {
        instance,
        lastUsed: Date.now(),
        isPublicOnly
      });
      
      return instance;
    } catch (error) {
      const formattedError = handleCcxtError(error, exchange.name, 'initialization');
      console.error(`Error creating exchange instance for ${exchange.name}:`, formattedError);
      throw new Error(`Failed to initialize ${exchange.name} exchange: ${formattedError.message}`);
    }
  }
  
  /**
   * Create a cache key from an exchange object
   * @param exchange Exchange object
   * @returns Cache key string that uniquely identifies this exchange instance
   */
  private createCacheKey(exchange: Exchange): string {
    // Create a composite key using several factors:
    // 1. Exchange ID (name) - allows for different exchange types
    // 2. API key hash - allows for different API credentials for same exchange
    // 3. User ID - ensures different users with the same API key get different instances
    // 4. Demo flag - differentiates between demo and live exchanges
    
    const components = {
      id: exchange.name.toLowerCase(),
      apiKey: exchange.apiKey ? this.hashString(exchange.apiKey) : 'no-key',
      userId: exchange.userId || 0,
      isDemo: !!exchange.isDemo
    };
    
    return `${components.id}-${components.apiKey}-user${components.userId}-${components.isDemo ? 'demo' : 'live'}`;
  }
  
  /**
   * Simple string hashing function
   * @param str String to hash
   * @returns Hashed string
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16); // Convert to hex string
  }
  
  /**
   * Clean up stale exchange instances
   */
  private cleanupStaleInstances(): void {
    const now = Date.now();
    
    // Only run cleanup at the specified interval
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }
    
    console.log('Cleaning up stale exchange instances...');
    let removedCount = 0;
    
    // Use Array.from to convert MapIterator to array to avoid TypeScript issues
    Array.from(this.exchangeInstances.entries()).forEach(([key, entry]) => {
      if (now - entry.lastUsed > this.maxCacheAge) {
        this.exchangeInstances.delete(key);
        removedCount++;
      }
    });
    
    console.log(`Removed ${removedCount} stale exchange instances. Remaining: ${this.exchangeInstances.size}`);
    this.lastCleanup = now;
  }
  
  /**
   * Get all cached exchange instances
   * @returns Map of cache keys to exchange instances
   */
  getInstancesCache(): Map<string, ExchangeCacheEntry> {
    return this.exchangeInstances;
  }
  
  /**
   * Clear all cached exchange instances
   */
  clearCache(): void {
    this.exchangeInstances.clear();
    console.log('Exchange instance cache cleared');
  }
}

// Singleton instance
export const exchangeManager = new ExchangeInstanceManager();

/**
 * Get list of supported exchanges
 * @param enabledOnly Only return enabled exchanges
 * @returns Array of exchange IDs
 */
export async function getSupportedExchanges(enabledOnly: boolean = false): Promise<string[]> {
  try {
    // Try to fetch from database first
    const exchanges = await storage.getSupportedExchanges();
    
    if (exchanges && exchanges.length > 0) {
      // Filter by enabled status if requested
      const filteredExchanges = enabledOnly 
        ? exchanges.filter(exchange => exchange.isEnabled)
        : exchanges;
        
      return filteredExchanges.map(exchange => exchange.name);
    }
    
    // Fallback to hardcoded list if database doesn't have any
    const defaultExchanges = [
      { 
        name: 'kraken',
        supportsMargin: true,
        supportsFutures: false,
        sortOrder: 1
      },
      { 
        name: 'binanceus',
        supportsMargin: false,
        supportsFutures: false, 
        sortOrder: 2
      },
      { 
        name: 'bybit',
        supportsMargin: true,
        supportsFutures: true,
        sortOrder: 3
      },
      { 
        name: 'coinex',
        supportsMargin: true,
        supportsFutures: false,
        sortOrder: 4
      },
      { 
        name: 'kucoin',
        supportsMargin: true,
        supportsFutures: true,
        sortOrder: 5
      },
      { 
        name: 'mexc',
        supportsMargin: true,
        supportsFutures: false,
        sortOrder: 6
      },
      { 
        name: 'bydfi',
        supportsMargin: true,
        supportsFutures: true,
        sortOrder: 7
      }
    ];
    
    // Store the default exchanges in the database
    console.log('Initializing database with default supported exchanges...');
    
    const promises = defaultExchanges.map(async (exchange) => {
      return storage.addSupportedExchange({
        name: exchange.name,
        displayName: formatExchangeName(exchange.name),
        isEnabled: true,
        supportsSpot: true,
        supportsMargin: exchange.supportsMargin,
        supportsFutures: exchange.supportsFutures,
        requiresCredentials: true,
        sortOrder: exchange.sortOrder,
        notes: `Default ${formatExchangeName(exchange.name)} configuration`
      });
    });
    
    await Promise.all(promises);
    console.log('Successfully initialized supported exchanges database');
    
    // Return the list of exchange names
    return defaultExchanges.map(exchange => exchange.name);
  } catch (error) {
    console.error('Error fetching supported exchanges:', error);
    return [];
  }
}

/**
 * Get detailed information about supported exchanges
 * @param enabledOnly Only return enabled exchanges
 * @returns Array of supported exchange objects
 */
export async function getSupportedExchangesDetails(enabledOnly: boolean = false): Promise<SupportedExchange[]> {
  try {
    const exchanges = await storage.getSupportedExchanges();
    
    if (exchanges && exchanges.length > 0) {
      return enabledOnly 
        ? exchanges.filter(exchange => exchange.isEnabled)
        : exchanges;
    }
    
    // If no exchanges in database, initialize them
    await getSupportedExchanges(false);
    
    // Now try again
    const initializedExchanges = await storage.getSupportedExchanges();
    return enabledOnly 
      ? initializedExchanges.filter(exchange => exchange.isEnabled)
      : initializedExchanges;
      
  } catch (error) {
    console.error('Error fetching supported exchanges details:', error);
    return [];
  }
}

/**
 * Check CCXT support for exchanges stored in the database
 * @param onlyEnabled If true, only check enabled exchanges
 * @param specificExchangeIds Optional list of exchange IDs to check (otherwise check all)
 * @returns Support information for each exchange
 */
export async function checkExchangesSupport(
  onlyEnabled: boolean = false,
  specificExchangeIds?: string[]
): Promise<ExchangeSupportCheck[]> {
  const results: ExchangeSupportCheck[] = [];
  
  try {
    // Get exchange details from our database
    const supportedExchanges = await getSupportedExchangesDetails(onlyEnabled);
    
    // Filter to specific exchanges if provided
    const exchangesToCheck = specificExchangeIds 
      ? supportedExchanges.filter(exchange => 
          specificExchangeIds.includes(exchange.name.toLowerCase()))
      : supportedExchanges;
      
    // Process each exchange
    await Promise.all(exchangesToCheck.map(async (dbExchange) => {
      try {
        const exchangeId = dbExchange.name.toLowerCase();
        if (!(exchangeId in ccxt)) {
          results.push({
            id: exchangeId,
            name: dbExchange.displayName || formatExchangeName(exchangeId),
            hasPublicAPI: false,
            hasFetchOHLCV: false,
            hasFetchTicker: false,
            hasFetchOrderBook: false,
            supportsMarketOrders: false,
            supportsLimitOrders: false,
            supportsMarginTrading: dbExchange.supportsMargin === true,
            supportedTimeframes: [],
            notes: 'Not supported by CCXT'
          });
          return;
        }
        
        // Create a public instance to check capabilities using our exchangeManager
        const emptyExchange: Exchange = {
          id: 0,
          name: exchangeId,
          apiKey: '',
          apiSecret: '',
          status: 'disconnected',
          userId: 0,
          displayName: null,
          apiKeyLabel: null,
          canWithdraw: null,
          isDemo: null,
          createdAt: new Date()
        };
        const exchange = await exchangeManager.getExchangeInstance(emptyExchange);
        
        const result: ExchangeSupportCheck = {
          id: exchangeId,
          name: dbExchange.displayName || formatExchangeName(exchangeId),
          hasPublicAPI: true,
          hasFetchOHLCV: exchange.has['fetchOHLCV'] === true,
          hasFetchTicker: exchange.has['fetchTicker'] === true,
          hasFetchOrderBook: exchange.has['fetchOrderBook'] === true,
          supportsMarketOrders: exchange.has['createMarketOrder'] === true,
          supportsLimitOrders: exchange.has['createLimitOrder'] === true,
          supportsMarginTrading: exchange.has['createMarginOrder'] === true || dbExchange.supportsMargin === true,
          supportedTimeframes: exchange.timeframes ? Object.keys(exchange.timeframes) : []
        };
        
        // Update database with new information if needed
        if (result.supportedTimeframes.length > 0 && !dbExchange.supportedTimeframes) {
          await storage.updateSupportedExchange(dbExchange.id, {
            supportedTimeframes: result.supportedTimeframes
          });
        }
        
        results.push(result);
      } catch (error) {
        console.error(`Error checking support for exchange ${dbExchange.name}:`, error);
        results.push({
          id: dbExchange.name.toLowerCase(),
          name: dbExchange.displayName || formatExchangeName(dbExchange.name),
          hasPublicAPI: false,
          hasFetchOHLCV: false,
          hasFetchTicker: false,
          hasFetchOrderBook: false,
          supportsMarketOrders: false,
          supportsLimitOrders: false,
          supportsMarginTrading: dbExchange.supportsMargin === true,
          supportedTimeframes: [],
          notes: `Error checking support: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }));
    
    return results.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Failed to check exchange support:', error);
    return [];
  }
}

/**
 * Format exchange name for display
 * @param name Raw exchange name
 * @returns Formatted exchange name
 */
export function formatExchangeName(name: string): string {
  // Special case for exchange names
  if (name.toLowerCase() === 'coinbasepro') return 'Coinbase Pro';
  if (name.toLowerCase() === 'binanceus') return 'Binance US';
  if (name.toLowerCase() === 'binance') return 'Binance';
  if (name.toLowerCase() === 'bydfi') return 'BYDFi';
  if (name.toLowerCase() === 'bybit') return 'Bybit';
  if (name.toLowerCase() === 'kucoin') return 'KuCoin';
  if (name.toLowerCase() === 'okx') return 'OKX';
  if (name.toLowerCase() === 'coinex') return 'CoinEx';
  if (name.toLowerCase() === 'mexc') return 'MEXC';
  
  // Generic case: capitalize first letter of each word
  return name
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalize timeframe to CCXT format
 * @param timeframe Timeframe string (e.g., '1h', '1d')
 * @param exchange Exchange to check supported timeframes
 * @returns Normalized timeframe string
 */
export function normalizeTimeframe(timeframe: string, exchange: ccxt.Exchange): string {
  // Convert to lowercase
  const normalizedTimeframe = timeframe.toLowerCase();
  
  // Check if the exchange supports this timeframe
  if (exchange.timeframes && !exchange.timeframes[normalizedTimeframe]) {
    // Find the closest supported timeframe
    const supportedTimeframes = Object.keys(exchange.timeframes);
    if (supportedTimeframes.length === 0) {
      // Fallback to common timeframes if none are specified
      return '1h';
    }
    
    // Try to find the closest timeframe
    // This is a very simplistic approach, can be improved
    const commonTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    
    for (const tf of commonTimeframes) {
      if (supportedTimeframes.includes(tf)) {
        console.log(`Timeframe ${normalizedTimeframe} not supported, using ${tf} instead`);
        return tf;
      }
    }
    
    // If no common timeframe is supported, use the first one
    console.log(`Timeframe ${normalizedTimeframe} not supported, using ${supportedTimeframes[0]} instead`);
    return supportedTimeframes[0];
  }
  
  return normalizedTimeframe;
}

/**
 * Normalize symbol format to ensure it has a quote currency
 * @param symbol Symbol to normalize (e.g., 'BTC', 'BTC/USDT', 'BTCUSDT')
 * @returns Normalized symbol in format 'BTC/USDT'
 */
export function normalizeSymbol(symbol: string): string {
  // If symbol already contains a slash, assume it's already formatted correctly
  if (symbol.includes('/')) {
    return symbol;
  }
  
  // For symbols that contain USDT without a slash, add the slash
  if (symbol.includes('USDT')) {
    return symbol.replace('USDT', '/USDT');
  }
  
  // For symbols that contain USD without a slash, add the slash
  if (symbol.includes('USD') && !symbol.includes('USDT')) {
    return symbol.replace('USD', '/USD');
  }
  
  // For bare currency symbols, append /USDT
  return `${symbol}/USDT`;
}

/**
 * Handle CCXT errors more gracefully
 * @param error Error object from CCXT
 * @param exchange Exchange name
 * @param operation Operation being performed
 * @returns Formatted error object
 */
export function handleCcxtError(
  error: any, 
  exchange: string, 
  operation: string
): { 
  message: string, 
  type: string, 
  code?: string, 
  httpCode?: number 
} {
  let errorType = 'ExchangeError';
  let errorCode = '';
  let httpCode = 0;
  let message = `Error with ${exchange} during ${operation}`;
  
  if (error instanceof ccxt.NetworkError) {
    errorType = 'NetworkError';
    message = `Network error connecting to ${exchange}: ${error.message}`;
  } 
  else if (error instanceof ccxt.ExchangeError) {
    errorType = 'ExchangeError';
    message = `${exchange} exchange error: ${error.message}`;
  }
  else if (error instanceof ccxt.AuthenticationError) {
    errorType = 'AuthenticationError';
    message = `Authentication failed with ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.PermissionDenied) {
    errorType = 'PermissionDenied';
    message = `Permission denied on ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.ArgumentsRequired) {
    errorType = 'ArgumentsRequired';
    message = `Missing arguments for ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.BadRequest) {
    errorType = 'BadRequest';
    message = `Bad request to ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.BadResponse) {
    errorType = 'BadResponse';
    message = `Bad response from ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.NullResponse) {
    errorType = 'NullResponse';
    message = `Null response from ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.OrderNotFound) {
    errorType = 'OrderNotFound';
    message = `Order not found on ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.InsufficientFunds) {
    errorType = 'InsufficientFunds';
    message = `Insufficient funds on ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.InvalidOrder) {
    errorType = 'InvalidOrder';
    message = `Invalid order on ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.RequestTimeout) {
    errorType = 'RequestTimeout';
    message = `Request timeout with ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.RateLimitExceeded) {
    errorType = 'RateLimitExceeded';
    message = `Rate limit exceeded on ${exchange}: ${error.message}`;
  }
  else if (error instanceof ccxt.ExchangeNotAvailable) {
    errorType = 'ExchangeNotAvailable';
    message = `${exchange} exchange not available: ${error.message}`;
  }
  else if (error instanceof ccxt.OnMaintenance) {
    errorType = 'OnMaintenance';
    message = `${exchange} is on maintenance: ${error.message}`;
  }
  else if (error instanceof ccxt.NotSupported) {
    errorType = 'NotSupported';
    message = `Operation not supported by ${exchange}: ${error.message}`;
  }
  
  // Get more details if available
  if ('code' in error) {
    errorCode = error.code;
  }
  
  if ('httpCode' in error) {
    httpCode = error.httpCode;
  }
  
  return {
    message,
    type: errorType,
    code: errorCode || undefined,
    httpCode: httpCode || undefined
  };
}