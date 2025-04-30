import { storage } from "./storage";
import { Exchange, TradingPair } from "@shared/schema";
import * as ccxt from 'ccxt';
import { exchangeManager, handleCcxtError } from './utils/exchangeUtils';

interface CCXTMarket {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  type: string;
  active: boolean;
  [key: string]: any;
}

interface CCXTTicker {
  symbol: string;
  last?: number;
  close?: number;
  bid?: number;
  ask?: number;
  percentage?: number;
  quoteVolume?: number;
  volume?: number;
  [key: string]: any;
}

interface ExchangeInfo {
  id: number;
  name: string;
  displayName: string;
}

interface MarketSearchResult {
  symbol: string;
  exchange: ExchangeInfo;
  baseAsset: string;
  quoteAsset: string;
  price?: number;
  priceChange24h?: number;
  volume?: number;
}

/**
 * Service for interacting with cryptocurrency exchanges
 */
export class ExchangeService {
  // Cache of CCXT exchange instances with composite keys (exchangeId + apiKey hash)
  private exchangeInstances: Map<string, ccxt.Exchange> = new Map();
  
  // Simple helper to create a composite cache key
  private createCacheKey(exchange: Exchange): string {
    // Create a composite key using exchange ID and a hash of the API key
    // This allows us to have different instances for the same exchange with different API keys
    const apiKeyPart = exchange.apiKey ? this.hashString(exchange.apiKey) : 'no-key';
    return `${exchange.id}-${exchange.name}-${apiKeyPart}`;
  }
  
  // Simple string hashing function
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16); // Convert to hex string
  }
  
  // List of available exchanges for the Markets feature
  private supportedExchanges = [
    'kraken',
    'binance',
    'bybit',
    'coinbasepro',
    'kucoin',
    'bydfi'
  ];
  
  /**
   * Get list of available exchanges for the Markets feature
   * @returns List of exchange names
   */
  async getAvailableExchanges(): Promise<string[]> {
    return this.supportedExchanges.map(id => {
      // Capitalize first letter and format name
      return id.charAt(0).toUpperCase() + id.slice(1);
    });
  }
  
  /**
   * Search for assets across connected exchanges
   * @param query Search query (symbol or name)
   * @param userId User ID to filter for connected exchanges
   * @param specificExchange Optional name of a specific exchange to search in
   * @returns List of matching assets
   */
  async searchAssets(query: string, userId?: number, specificExchange?: string): Promise<MarketSearchResult[]> {
    try {
      console.log(`Searching assets for query: ${query}`);
      
      const results: MarketSearchResult[] = [];
      const lowerQuery = query.toLowerCase();
      const maxResults = 25; // Limit total number of results
      
      // Get user's connected exchanges if userId is provided
      let connectedExchanges: Exchange[] = [];
      if (userId) {
        connectedExchanges = await storage.getExchangesByUserId(userId);
        console.log(`Found ${connectedExchanges.length} connected exchanges for user ${userId}`);
      }
      
      // If user has connected exchanges, only use those that are marked as connected status
      // Otherwise, use our default supported exchanges (for demo/non-logged-in users)
      let exchangesToSearch: string[] = [];
      
      if (userId && connectedExchanges.length > 0) {
        // Only include exchanges with 'connected' status
        const connectedExchangesOnly = connectedExchanges.filter(ex => ex.status === 'connected');
        
        // If a specific exchange was requested, only search that one
        if (specificExchange) {
          const specificExchangeLower = specificExchange.toLowerCase();
          // Check if the specified exchange exists and is connected
          const exchangeExists = connectedExchangesOnly.some(
            ex => ex.name.toLowerCase() === specificExchangeLower
          );
          
          if (exchangeExists) {
            exchangesToSearch = [specificExchangeLower];
            console.log(`Searching only in specific exchange: ${specificExchangeLower}`);
          } else {
            console.log(`Specified exchange ${specificExchangeLower} not found or not connected, falling back to all exchanges`);
            exchangesToSearch = connectedExchangesOnly.map(ex => ex.name.toLowerCase());
          }
        } else {
          // No specific exchange requested, search all connected exchanges
          exchangesToSearch = connectedExchangesOnly.map(ex => ex.name.toLowerCase());
        }
        
        console.log(`Using only connected exchanges: ${exchangesToSearch.join(', ')}`);
      } else {
        // For demo mode, use only Kraken instead of all supported exchanges
        // This prevents testing multiple exchanges on login
        exchangesToSearch = ['kraken'];
        console.log(`Using demo mode with Kraken only`);
      }
      
      console.log(`Searching across exchanges: ${exchangesToSearch.join(', ')}`);
      
      // Use exchanges that are available in CCXT
      for (const exchangeId of exchangesToSearch) {
        try {
          // Import exchange utilities if not already imported
          const { exchangeManager, handleCcxtError } = await import('./utils/exchangeUtils');
          
          // Check if exchange is supported
          try {
            if (!(exchangeId in ccxt)) {
              console.log(`Exchange ${exchangeId} not supported by CCXT, skipping`);
              continue;
            }
          } catch (error) {
            console.warn(`Error checking CCXT support for ${exchangeId}:`, error);
            continue;
          }
          
          const exchangeName = exchangeId.charAt(0).toUpperCase() + exchangeId.slice(1);
          
          // Create an Exchange object for the exchangeManager
          let exchangeObj: Exchange = {
            id: 0, // We'll set this below if available
            name: exchangeId,
            displayName: null,
            apiKey: '', // Use empty strings instead of null to satisfy type constraints
            apiSecret: '',
            apiKeyLabel: null,
            canWithdraw: null,
            isDemo: null,
            status: 'connected',
            createdAt: new Date(),
            userId: userId || 0
          };

          if (userId) {
            const connectedExchange = connectedExchanges.find(
              ex => ex.name.toLowerCase() === exchangeId.toLowerCase()
            );
            
            if (connectedExchange && connectedExchange.status === 'connected') {
              console.log(`Using credentials for connected exchange: ${exchangeId}`);
              exchangeObj = {
                ...connectedExchange
              };
            } else if (connectedExchange) {
              console.log(`Exchange ${exchangeId} is available but not connected, using public API only`);
              exchangeObj = {
                ...connectedExchange,
                apiKey: '', // Use empty strings instead of null
                apiSecret: ''
              };
            }
          }
          
          // Get a CCXT exchange instance from the cache or create a new one
          console.log(`Getting CCXT instance for ${exchangeId} from exchangeManager`);
          const exchange = await exchangeManager.getExchangeInstance(exchangeObj);
          
          // Load markets
          console.log(`Loading markets for ${exchangeName}...`);
          const markets = await exchange.loadMarkets();
          
          // Filter markets based on query
          const marketsArray = Object.values(markets) as CCXTMarket[];
          
          // First priority: exact BTC/USDT matches if query contains "btc"
          let btcUsdtMatches: CCXTMarket[] = [];
          if (lowerQuery === "btc" || lowerQuery === "bitcoin") {
            btcUsdtMatches = marketsArray.filter((market: CCXTMarket) => {
              return market.type === 'spot' && 
                market.base === 'BTC' && 
                (market.quote === 'USDT' || market.quote === 'USD');
            });
          }
          
          // Second priority: other matches by base currency or symbol
          const otherMatches = marketsArray
            .filter((market: CCXTMarket) => {
              // Check if it's a spot market and the base currency or symbol matches the query
              return market.type === 'spot' && 
                (market.base && market.base.toLowerCase().includes(lowerQuery) || 
                 market.symbol && market.symbol.toLowerCase().includes(lowerQuery));
            })
            // Filter out any that are already in btcUsdtMatches
            .filter(market => !btcUsdtMatches.some(btcMarket => btcMarket.symbol === market.symbol));
          
          // Combine matches with BTC/USDT pairs first
          const combinedMatches = [...btcUsdtMatches, ...otherMatches];
          
          // Limit to 10 results per exchange
          const matchingMarkets = combinedMatches.slice(0, 10);
          
          console.log(`Found ${matchingMarkets.length} matching markets on ${exchangeName}`);
          
          // Fetch prices for matching markets
          for (const market of matchingMarkets) {
            try {
              // Try to fetch ticker for market
              const ticker = await exchange.fetchTicker(market.symbol) as CCXTTicker;
              
              results.push({
                symbol: market.symbol,
                baseAsset: market.base,
                quoteAsset: market.quote,
                exchange: {
                  id: 0,
                  name: exchangeName,
                  displayName: this.formatExchangeName(exchangeName)
                },
                price: ticker.last || ticker.close,
                priceChange24h: ticker.percentage ? ticker.percentage : 0,
                volume: ticker.quoteVolume || ticker.volume || 0
              });
              
              // Exit early if we've reached our maximum results
              if (results.length >= maxResults) {
                console.log(`Reached maximum results limit of ${maxResults}`);
                break;
              }
            } catch (tickerError) {
              console.warn(`Could not fetch ticker for ${market.symbol} on ${exchangeName}:`, tickerError);
              
              // Try to get price using getCurrentPrice if the exchange is connected
              if (userId) {
                try {
                  const currentPrice = await this.getCurrentPrice(market.symbol);
                  if (currentPrice) {
                    console.log(`Got price for ${market.symbol} using getCurrentPrice: ${currentPrice}`);
                    results.push({
                      symbol: market.symbol,
                      baseAsset: market.base,
                      quoteAsset: market.quote,
                      exchange: {
                        id: 0, // We don't have the exchange ID here
                        name: exchangeName,
                        displayName: this.formatExchangeName(exchangeName)
                      },
                      price: currentPrice,
                      priceChange24h: 0,
                      volume: 0
                    });
                  } else {
                    // Still add to results but without price data
                    results.push({
                      symbol: market.symbol,
                      baseAsset: market.base,
                      quoteAsset: market.quote,
                      exchange: {
                        id: 0,
                        name: exchangeName,
                        displayName: this.formatExchangeName(exchangeName)
                      }
                    });
                  }
                } catch (priceError) {
                  console.warn(`Could not get price for ${market.symbol}:`, priceError);
                  results.push({
                    symbol: market.symbol,
                    baseAsset: market.base,
                    quoteAsset: market.quote,
                    exchange: {
                      id: 0,
                      name: exchangeName,
                      displayName: this.formatExchangeName(exchangeName)
                    }
                  });
                }
              }
            }
          }
          
          // Exit the loop if we've reached our maximum results
          if (results.length >= maxResults) {
            break;
          }
        } catch (exchangeError) {
          console.error(`Error fetching data from ${exchangeId}:`, exchangeError);
          // Continue to next exchange
        }
      }
      
      // If we couldn't get any live data and this is not a logged-in user with connected exchanges,
      // return an empty result to encourage connecting exchanges
      if (results.length === 0 && userId) {
        return [];
      }
      
      // If this is demo mode/no user and we couldn't get results, use demo data
      if (results.length === 0 && !userId) {
        console.log('No live results found in demo mode, using sample data');
        
        // Demo/sample assets for non-logged in users
        const demoAssets = [
          { 
            symbol: 'BTC/USD', 
            baseAsset: 'BTC', 
            quoteAsset: 'USD', 
            exchange: {
              id: 0,
              name: 'kraken',
              displayName: 'Kraken'
            }, 
            price: 63250.5, 
            priceChange24h: 1.25, 
            volume: 1250000000 
          },
          { 
            symbol: 'ETH/USD', 
            baseAsset: 'ETH', 
            quoteAsset: 'USD', 
            exchange: {
              id: 0,
              name: 'kraken',
              displayName: 'Kraken'
            }, 
            price: 3070.25, 
            priceChange24h: 0.75, 
            volume: 750000000 
          },
          { 
            symbol: 'SOL/USD', 
            baseAsset: 'SOL', 
            quoteAsset: 'USD', 
            exchange: {
              id: 0,
              name: 'kraken',
              displayName: 'Kraken'
            }, 
            price: 142.30, 
            priceChange24h: 3.15, 
            volume: 520000000 
          },
        ];
        
        // Filter demo assets based on query
        return demoAssets.filter(asset => 
          asset.symbol.toLowerCase().includes(lowerQuery) || 
          asset.baseAsset.toLowerCase().includes(lowerQuery)
        );
      }
      
      console.log(`Returning ${results.length} search results`);
      return results;
    } catch (error) {
      console.error('Error searching assets:', error);
      return [];
    }
  }
  
  /**
   * Get market data for a symbol on an exchange
   * @param symbol Trading pair symbol (e.g., BTC/USD)
   * @param exchange Exchange name (e.g., Kraken)
   * @param timeframe Candlestick timeframe (e.g., 1h, 1d)
   * @returns Market data including OHLCV candles
   */
  /**
   * Normalize symbol format to ensure it has a quote currency
   * @param symbol Symbol to normalize (e.g., 'BTC', 'BTC/USDT', 'BTCUSDT')
   * @returns Normalized symbol in format 'BTC/USDT'
   */
  private normalizeSymbol(symbol: any): string {
    // Make sure symbol is a string
    if (typeof symbol !== 'string') {
      console.warn(`Received non-string symbol: ${symbol}, converting to string`);
      symbol = String(symbol);
    }
    
    // If symbol already contains a slash, assume it's already formatted correctly
    if (symbol.includes('/')) {
      return symbol;
    }
    
    // For symbols that contain USDT without a slash, add the slash
    if (symbol.includes('USDT')) {
      return symbol.replace('USDT', '/USDT');
    }
    
    // For bare currency symbols, append /USDT
    return `${symbol}/USDT`;
  }
  
  async getMarketData(symbol: string, exchange: string, timeframe: string = '1h', userId: number | null = null): Promise<any> {
    try {
      // Normalize the symbol format
      const normalizedSymbol = this.normalizeSymbol(symbol);
      console.log(`Fetching market data for ${normalizedSymbol} on ${exchange} with timeframe ${timeframe}`);
      
      // Get the exchanges for the user that are in "connected" status
      const exchanges = userId 
        ? (await storage.getExchangesByUserId(userId)).filter(ex => ex.status === 'connected')
        : (await storage.getExchangesByUserId(1)).filter(ex => ex.status === 'connected'); // Use only connected demo exchanges
      
      console.log(`Found ${exchanges.length} connected exchanges for user ID: ${userId || 'demo'}`);
      
      const targetExchange = exchanges.find(ex => ex.name.toLowerCase() === exchange.toLowerCase());
      
      if (targetExchange) {
        // Use existing method with exchange ID
        return this.getMarketDataByExchangeId(targetExchange.id, normalizedSymbol, timeframe);
      } else {
        // Create a synthetic exchange for public data
        const currentTime = Math.floor(Date.now() / 1000);
        const timeframeInSeconds = this.getTimeframeInSeconds(timeframe);
        const limit = 100; // Default number of candles
        
        // Generate realistic-looking OHLCV data based on the symbol
        // First try to get a real-time price, then fall back to static price
        let basePrice: number | null = null;
        
        try {
          basePrice = await this.getCurrentPrice(symbol);
          if (basePrice) {
            console.log(`Using real-time price for ${symbol}: ${basePrice}`);
          } else {
            console.log(`Could not get real-time price for ${symbol}, using fallback price`);
            basePrice = this.getBasePrice(symbol);
          }
          
          if (!basePrice) {
            throw new Error(`Unsupported symbol: ${symbol}`);
          }
        } catch (error) {
          console.error(`Price lookup failed for ${symbol}:`, error);
          throw new Error(`Unsupported symbol: ${symbol}`);
        }
        
        // Generate candles
        const candles = [];
        
        for (let i = 0; i < limit; i++) {
          const timestamp = currentTime - (timeframeInSeconds * (limit - i - 1));
          const volatility = basePrice * 0.02; // 2% volatility
          
          // Create some price movement
          const open = basePrice + (Math.sin(i/10) * volatility);
          const close = open + ((Math.random() - 0.5) * volatility);
          const high = Math.max(open, close) + (Math.random() * volatility * 0.5);
          const low = Math.min(open, close) - (Math.random() * volatility * 0.5);
          const volume = basePrice * 100 * (0.8 + Math.random() * 0.4);
          
          candles.push([
            timestamp * 1000, // timestamp in milliseconds
            open,
            high,
            low,
            close,
            volume
          ]);
        }
        
        return {
          candles,
          symbol,
          exchange,
          timeframe
        };
      }
    } catch (error) {
      console.error(`Failed to fetch market data for ${symbol} on ${exchange}:`, error);
      throw new Error(`Failed to fetch market data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get market data for a trading pair by exchange ID
   * @param exchangeId The ID of the exchange
   * @param symbol The trading pair symbol (e.g., BTC/USDT)
   * @param timeframe The timeframe for candlestick data (e.g., 1h, 4h, 1d)
   * @param limit The maximum number of candles to retrieve
   */
  async getMarketDataByExchangeId(exchangeId: number, symbol: string, timeframe: string = '1h', limit: number = 100): Promise<any> {
    try {
      console.log(`Fetching market data for ${symbol} on exchange ID: ${exchangeId}`);
      
      // Import exchange utilities
      const { exchangeManager, handleCcxtError, normalizeTimeframe } = await import('./utils/exchangeUtils');
      
      const exchange = await storage.getExchange(exchangeId);
      if (!exchange) {
        throw new Error(`Exchange with ID ${exchangeId} not found`);
      }
      
      try {
        // Initialize CCXT exchange using the manager for better caching and error handling
        const ccxtExchange = await exchangeManager.getExchangeInstance(exchange);
        
        // Verify the exchange supports OHLCV data
        if (!ccxtExchange.has['fetchOHLCV']) {
          throw new Error(`Exchange ${exchange.name} does not support OHLCV data`);
        }
        
        // Normalize timeframe using the utility function that checks for exchange compatibility
        const ccxtTimeframe = normalizeTimeframe(timeframe, ccxtExchange);
        
        // Make sure the timeframe is supported
        const supportedTimeframes = Object.keys(ccxtExchange.timeframes || {});
        if (!supportedTimeframes.includes(ccxtTimeframe)) {
          console.warn(`Timeframe ${ccxtTimeframe} not supported by ${exchange.name}, using default timeframe`);
          // Use the first available timeframe as default
          const defaultTimeframe = supportedTimeframes[0] || '1h';
          console.log(`Using default timeframe: ${defaultTimeframe}`);
        }
        
        // Fetch OHLCV data from exchange with retry logic
        console.log(`Fetching OHLCV data for ${symbol} with timeframe ${ccxtTimeframe} from ${exchange.name}...`);
        
        // Some exchanges require pagination for larger limit requests
        const maxCandles = limit > 1000 ? 1000 : limit; // Many exchanges have a max limit of 1000
        let allCandles = [];
        let since = undefined;
        
        // Paginate the results if needed
        while (allCandles.length < limit) {
          try {
            const candles = await ccxtExchange.fetchOHLCV(symbol, ccxtTimeframe, since, maxCandles);
            
            if (candles.length === 0) {
              // No more data available
              break;
            }
            
            allCandles = [...allCandles, ...candles];
            
            // Update since for next page if needed
            if (allCandles.length < limit) {
              // Get timestamp of the last candle for next page
              since = allCandles[allCandles.length - 1][0] + 1; // +1 to avoid duplicate
            } else {
              // We've reached the requested limit
              break;
            }
          } catch (paginationError) {
            const formattedError = handleCcxtError(paginationError, exchange.name, 'fetchOHLCV');
            console.warn(`Error during OHLCV pagination: ${formattedError.message}`);
            break; // Stop pagination and return what we have
          }
        }
        
        // If we need to return exactly the requested number of candles
        const candles = allCandles.slice(0, limit);
        
        console.log(`Fetched ${candles.length} candles for ${symbol} from ${exchange.name}`);
        return {
          candles,
          symbol,
          exchange: exchange.name,
          timeframe
        };
        
      } catch (error) {
        console.error(`Error fetching OHLCV data from exchange API:`, error);
        console.log(`Using generated data for market data...`);
        
        // Fallback to generated data if API call fails or during demo
        const currentTime = Math.floor(Date.now() / 1000);
        const timeframeInSeconds = this.getTimeframeInSeconds(timeframe);
        
        // Generate realistic-looking OHLCV data based on the symbol
        // First try to get a real-time price, then fall back to static price
        let basePrice: number | null = null;
        
        try {
          basePrice = await this.getCurrentPrice(symbol);
          if (basePrice) {
            console.log(`Using real-time price for ${symbol}: ${basePrice}`);
          } else {
            console.log(`Could not get real-time price for ${symbol}, using fallback price`);
            basePrice = this.getBasePrice(symbol);
          }
          
          if (!basePrice) {
            throw new Error(`Unsupported symbol: ${symbol}`);
          }
        } catch (error) {
          console.error(`Price lookup failed for ${symbol}:`, error);
          throw new Error(`Unsupported symbol: ${symbol}`);
        }
        
        // Generate candles
        const candles = [];
        
        for (let i = 0; i < limit; i++) {
          const timestamp = currentTime - (timeframeInSeconds * (limit - i - 1));
          const volatility = basePrice * 0.02; // 2% volatility
          
          // Create some price movement
          const open = basePrice + (Math.sin(i/10) * volatility);
          const close = open + ((Math.random() - 0.5) * volatility);
          const high = Math.max(open, close) + (Math.random() * volatility * 0.5);
          const low = Math.min(open, close) - (Math.random() * volatility * 0.5);
          const volume = basePrice * 100 * (0.8 + Math.random() * 0.4);
          
          candles.push([
            timestamp * 1000, // timestamp in milliseconds
            open,
            high,
            low,
            close,
            volume
          ]);
        }
        
        return {
          candles,
          symbol,
          exchange: exchange.name,
          timeframe
        };
      }
    } catch (error) {
      console.error(`Failed to fetch market data for ${symbol}:`, error);
      throw new Error(`Failed to fetch market data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize a CCXT exchange instance
   * @param exchange Our exchange model
   * @returns CCXT exchange instance
   */
  private async initCcxtExchange(exchange: Exchange): Promise<ccxt.Exchange> {
    try {
      // Import the exchange manager for better caching and error handling
      const { exchangeManager } = await import('./utils/exchangeUtils');
      
      // Special handling for demo exchange - use kraken as the underlying exchange
      let modifiedExchange = {...exchange};
      
      if (modifiedExchange.name.toLowerCase() === 'demo' || modifiedExchange.isDemo) {
        console.log(`Using Kraken as the backend for demo exchange`);
        modifiedExchange.name = 'kraken';
        modifiedExchange.isDemo = true;
      }
      
      // Use the centralized exchange manager to get a properly configured instance
      return await exchangeManager.getExchangeInstance(modifiedExchange);
    } catch (error) {
      console.error(`Error initializing CCXT exchange ${exchange.name}:`, error);
      throw new Error(`Failed to initialize exchange ${exchange.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Connect to an exchange API
   * @param exchange The exchange to connect to
   */
  async connect(exchange: Exchange): Promise<void> {
    try {
      console.log(`Connecting to ${exchange.name} exchange...`);
      
      // Special handling for demo exchanges
      if (exchange.name.toLowerCase() === 'demo' || exchange.isDemo) {
        console.log(`Setting up demo exchange using Kraken as the backend`);
        // For demo exchanges, we don't need to validate API credentials
        // Just set it as connected
        await storage.updateExchangeStatus(exchange.id, true);
        // Ensure isDemo flag is set
        if (!exchange.isDemo) {
          await storage.updateExchange(exchange.id, { isDemo: true });
        }
        console.log(`Demo exchange setup successfully`);
        return;
      }
      
      // Initialize the CCXT exchange for regular exchanges
      const ccxtExchange = await this.initCcxtExchange(exchange);
      
      try {
        // Test the connection by fetching the balance
        // This will throw an error if the API keys are invalid
        if (exchange.apiKey && exchange.apiSecret) {
          // Only fetch balance if we have API credentials
          await ccxtExchange.fetchBalance();
          console.log(`Validated API credentials for ${exchange.name}`);
        } else {
          // For public API access only (no keys provided)
          // Just test a simple API call like fetchTicker
          await ccxtExchange.fetchTicker('BTC/USDT');
          console.log(`Connected to ${exchange.name} public API`);
        }
        
        // Update exchange status to connected
        await storage.updateExchangeStatus(exchange.id, true);
        console.log(`Connected to ${exchange.name} exchange successfully`);
      } catch (fetchError) {
        console.error(`API validation failed for ${exchange.name}:`, fetchError);
        
        // Check if this is an API key error
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        // Special handling for Probit's token expiration
        if (exchange.name.toLowerCase() === 'probit' && errorMessage.includes('probit access token expired')) {
          console.log('Detected Probit token expiration issue - this requires re-authentication');
          await storage.updateExchangeStatus(exchange.id, false);
          throw new Error(`Probit access token expired. Please reconnect your Probit exchange with fresh API credentials.`);
        }
        
        // More comprehensive check for auth errors
        const authErrorPatterns = [
          'auth', 'key', 'permission', 'Access denied', 'denied', 'expired', 'invalid',
          'unauthorized', 'not authorized', 'token', 'credential', 'login'
        ];
        
        // Check if error message contains any auth error keywords
        const isAuthError = authErrorPatterns.some(pattern => 
          errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );
        
        if (isAuthError) {
          await storage.updateExchangeStatus(exchange.id, false);
          throw new Error(`Authentication failed for ${exchange.name}: ${errorMessage}`);
        }
        
        // For less critical errors, still mark as disconnected to be safe
        await storage.updateExchangeStatus(exchange.id, false);
        throw new Error(`Connection issue with ${exchange.name}: ${errorMessage}`);
      }
    } catch (error) {
      console.error(`Failed to connect to ${exchange.name} exchange:`, error);
      await storage.updateExchangeStatus(exchange.id, false);
      throw new Error(`Failed to connect to ${exchange.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Fetch trading pairs from an exchange
   * @param exchangeId The ID of the exchange to fetch pairs from
   */
  async fetchTradingPairs(exchangeId: number | Exchange): Promise<TradingPair[]> {
    try {
      // Ensure exchangeId is a number, not an Exchange object
      const exchangeIdNum = typeof exchangeId === 'object' && exchangeId !== null && 'id' in exchangeId 
        ? exchangeId.id 
        : exchangeId as number;
          
      console.log(`Fetching trading pairs for exchange ID: ${exchangeIdNum}`);
      
      const exchange = await storage.getExchange(exchangeIdNum);
      if (!exchange) {
        throw new Error(`Exchange with ID ${exchangeIdNum} not found`);
      }
      
      // Check if we already have pairs for this exchange
      const existingPairs = await storage.getTradingPairsByExchangeId(exchangeIdNum);
      if (existingPairs.length > 0) {
        return existingPairs;
      }
      
      try {
        // Initialize CCXT exchange
        const ccxtExchange = await this.initCcxtExchange(exchange);
        
        // Load markets from exchange
        await ccxtExchange.loadMarkets();
        
        // Filter for USDT pairs for cleaner UI in demo (can be expanded later)
        const markets = Object.values(ccxtExchange.markets || {})
          .filter(market => 
            // Filter for spot markets (not futures/options)
            market.type === 'spot' && 
            // Only include USD or USDT pairs for demo
            (market.quote === 'USDT' || market.quote === 'USD') && 
            // Only include active markets
            market.active === true
          )
          // Limit to top 20 pairs for demo (avoid too many in UI)
          .slice(0, 20);
        
        console.log(`Found ${markets.length} markets on ${exchange.name}`);
        
        const savedPairs: TradingPair[] = [];
        
        for (const market of markets) {
          const pair = {
            symbol: market.symbol,
            baseAsset: market.base,
            quoteAsset: market.quote,
            exchangeId: exchangeIdNum
          };
          
          const savedPair = await storage.createTradingPair(pair);
          savedPairs.push(savedPair);
        }
        
        console.log(`Saved ${savedPairs.length} trading pairs from ${exchange.name}`);
        return savedPairs;
        
      } catch (error) {
        console.error(`Error fetching markets from exchange API:`, error);
        console.log(`Using fallback data for trading pairs...`);
        
        // Fallback: Use predefined common pairs if API call fails
        const pairsToAdd = [
          { symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", exchangeId: exchangeIdNum },
          { symbol: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT", exchangeId: exchangeIdNum },
          { symbol: "SOL/USDT", baseAsset: "SOL", quoteAsset: "USDT", exchangeId: exchangeIdNum },
          { symbol: "ADA/USDT", baseAsset: "ADA", quoteAsset: "USDT", exchangeId: exchangeIdNum },
          { symbol: "DOT/USDT", baseAsset: "DOT", quoteAsset: "USDT", exchangeId: exchangeIdNum },
          { symbol: "DOGE/USDT", baseAsset: "DOGE", quoteAsset: "USDT", exchangeId: exchangeIdNum },
          { symbol: "XRP/USDT", baseAsset: "XRP", quoteAsset: "USDT", exchangeId: exchangeIdNum },
          { symbol: "AVAX/USDT", baseAsset: "AVAX", quoteAsset: "USDT", exchangeId: exchangeIdNum }
        ];
        
        const savedPairs: TradingPair[] = [];
        
        for (const pair of pairsToAdd) {
          const savedPair = await storage.createTradingPair(pair);
          savedPairs.push(savedPair);
        }
        
        console.log(`Saved ${savedPairs.length} fallback trading pairs for exchange ID: ${exchangeId instanceof Object ? (exchangeId as Exchange).id : exchangeId}`);
        return savedPairs;
      }
    } catch (error) {
      console.error(`Failed to fetch trading pairs for exchange ID ${exchangeId instanceof Object ? (exchangeId as Exchange).id : exchangeId}:`, error);
      throw new Error(`Failed to fetch trading pairs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Convert timeframe string to seconds
   * @param timeframe Timeframe string (e.g., 1m, 1h, 1d)
   */
  private getTimeframeInSeconds(timeframe: string): number {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));
    
    switch (unit) {
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 60 * 60 * 24;
      case 'w': return value * 60 * 60 * 24 * 7;
      default: return 3600; // Default to 1h
    }
  }
  
  /**
   * Get base price for a cryptocurrency symbol
   * @param symbol Trading pair symbol
   */
  private async fetchCurrentPrice(symbol: string): Promise<number | null> {
    try {
      // Import exchange manager
      const { exchangeManager, handleCcxtError } = await import('./utils/exchangeUtils');
      
      // Try to get the current price from multiple exchanges in order of reliability
      const exchangeIds = ['kraken', 'kucoin', 'bybit'];
      
      // Try each exchange in order until we get a price
      for (const exchangeId of exchangeIds) {
        if (exchangeId in ccxt) {
          try {
            // Create a dummy exchange object for public API access
            const dummyExchange = {
              id: 0,
              name: exchangeId,
              displayName: null,
              apiKey: '',
              apiSecret: '',
              apiKeyLabel: null,
              canWithdraw: false,
              isDemo: true,
              status: 'connected',
              createdAt: new Date(),
              userId: 0
            };
            
            // Use the exchange manager to get a properly configured instance
            const exchange = await exchangeManager.getExchangeInstance(dummyExchange);
            
            try {
              // Fetch ticker with proper error handling
              const ticker = await exchange.fetchTicker(symbol);
              if (ticker && ticker.last) {
                console.log(`Found real-time price for ${symbol} from ${exchangeId}: ${ticker.last}`);
                return ticker.last;
              }
            } catch (tickerError) {
              const formattedError = handleCcxtError(tickerError, exchangeId, 'fetchTicker');
              console.warn(`Could not fetch price for ${symbol} from ${exchangeId}: ${formattedError.message}`);
              // Continue to next exchange
            }
          } catch (exchangeError) {
            const formattedError = handleCcxtError(exchangeError, exchangeId, 'initialization');
            console.warn(`Error initializing ${exchangeId} exchange: ${formattedError.message}`);
            // Continue to next exchange
          }
        }
      }
      
      // If we couldn't get a price from any exchange, try alternative symbol formats
      if (symbol.includes('/')) {
        const [base, quote] = symbol.split('/');
        
        // Try alternative quote currencies if original failed
        if (quote === 'USD') {
          const altSymbol = `${base}/USDT`;
          const altPrice = await this.fetchCurrentPrice(altSymbol);
          if (altPrice) return altPrice;
        } else if (quote === 'USDT') {
          const altSymbol = `${base}/USD`;
          const altPrice = await this.fetchCurrentPrice(altSymbol);
          if (altPrice) return altPrice;
        }
      }
      
      // If all else fails, fall back to static prices
      return null;
    } catch (error) {
      console.error(`Error fetching current price for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Get base price for a cryptocurrency symbol
   * This is a synchronous fallback function for when fetchCurrentPrice can't be used
   * @param symbol Trading pair symbol
   */
  private getBasePrice(symbol: string): number | null {
    // Fallback base prices for common cryptocurrencies if we can't fetch current prices
    const basePrices: Record<string, number> = {
      // Updated baseline prices as of April 2025
      'BTC/USD': 63000,
      'ETH/USD': 3000,
      'SOL/USD': 140,
      'ADA/USD': 0.45,
      'DOT/USD': 7.2,
      'DOGE/USD': 0.15,
      'XRP/USD': 0.51,
      'AVAX/USD': 30,
      
      // USDT pairs
      'BTC/USDT': 63000,
      'ETH/USDT': 3000,
      'SOL/USDT': 140,
      'ADA/USDT': 0.45,
      'DOT/USDT': 7.2,
      'DOGE/USDT': 0.15,
      'XRP/USDT': 0.51,
      'AVAX/USDT': 30,
      
      // Add more pairs as needed
    };
    
    // If the specific symbol isn't in our map, extract the base asset and try to find a match
    if (!basePrices[symbol]) {
      const parts = symbol.split('/');
      if (parts.length === 2) {
        const baseAsset = parts[0];
        // Try USD pair first
        const usdSymbol = `${baseAsset}/USD`;
        const usdtSymbol = `${baseAsset}/USDT`;
        
        if (basePrices[usdSymbol]) {
          return basePrices[usdSymbol];
        } else if (basePrices[usdtSymbol]) {
          return basePrices[usdtSymbol];
        }
      }
    }
    
    return basePrices[symbol] || null;
  }
  
  /**
   * Get current price for a cryptocurrency symbol
   * This is an async wrapper that tries live data first, then falls back to static values
   * @param symbol Trading pair symbol
   */
  public async getCurrentPrice(symbol: string): Promise<number | null> {
    // Normalize the symbol format
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    // First try to get real-time price data
    const livePrice = await this.fetchCurrentPrice(normalizedSymbol);
    if (livePrice !== null) {
      return livePrice;
    }
    
    // Fall back to static prices if live data unavailable
    return this.getBasePrice(normalizedSymbol);
  }
  
  /**
   * Execute a trade on an exchange
   * @param exchangeId The ID of the exchange
   * @param symbol Trading pair symbol
   * @param type Trade type (buy or sell)
   * @param amount Amount to trade
   * @param price Price to trade at (optional, for limit orders)
   */
  async executeTrade(
    exchangeId: number, 
    symbol: string, 
    type: 'buy' | 'sell', 
    amount: number, 
    price?: number
  ): Promise<any> {
    try {
      console.log(`Executing ${type} trade for ${amount} ${symbol} on exchange ID: ${exchangeId}`);
      
      const exchange = await storage.getExchange(exchangeId);
      if (!exchange) {
        throw new Error(`Exchange with ID ${exchangeId} not found`);
      }
      
      // Create a demo/paper trade or use real exchange with API keys
      try {
        // Import exchange utilities
        const { exchangeManager, handleCcxtError } = await import('./utils/exchangeUtils');
        
        // Initialize CCXT exchange using the manager for better caching and error handling
        const ccxtExchange = await exchangeManager.getExchangeInstance(exchange);
        
        // Create order params
        const orderType = price ? 'limit' : 'market';
        
        // Check if we have API keys and exchange supports trading
        if (exchange.apiKey && exchange.apiSecret && ccxtExchange.has['createOrder']) {
          console.log(`Executing ${orderType} ${type} order on ${exchange.name}...`);
          
          // Determine if this is testnet/paper trading or real
          const isTestMode = ccxtExchange.options?.test || exchange.isDemo || false;
          if (!isTestMode) {
            // Show confirmation message for real trading
            console.warn(`WARNING: Executing REAL trade on ${exchange.name}. This is not a test/paper trade.`);
            // In a real app, we would ask for confirmation here
          }
          
          try {
            // Execute the trade
            const order = await ccxtExchange.createOrder(
              symbol,         // Symbol
              orderType,      // Type of order (market or limit)
              type,           // Side (buy or sell)
              amount,         // Amount to trade
              price,          // Price (optional for market orders)
              {
                // Additional params if needed
                test: exchange.isDemo || false // Use test parameter if available
              }
            );
            
            console.log(`Order executed on ${exchange.name}: ${JSON.stringify(order)}`);
            return order;
          } catch (tradeError) {
            // Use dedicated error handler for better error messages
            const formattedError = handleCcxtError(tradeError, exchange.name, 'createOrder');
            console.error(`Trade execution failed: ${formattedError.message}`);
            
            // Special handling for specific error types
            if (formattedError.type === 'AuthenticationError' || 
                formattedError.type === 'PermissionDenied') {
              throw new Error(`Trading not allowed: ${formattedError.message}`);
            }
            
            // For other errors, fall back to simulation
            throw new Error(`Exchange error: ${formattedError.message}`);
          }
        } else {
          // If no API keys or exchange doesn't support trading
          // Fall back to simulation
          console.log(`Demo mode: Simulating ${type} trade for ${amount} ${symbol}...`);
          throw new Error('Using trade simulation');
        }
      } catch (error) {
        // Fallback to simulated trade
        console.log(`Using simulated trade execution`);
        
        // Get current price from the exchange ticker if possible
        let executionPrice = price;
        if (!executionPrice) {
          try {
            const currentPrice = await this.getCurrentPrice(symbol);
            if (currentPrice) {
              executionPrice = currentPrice;
              console.log(`Got price from current price API: ${executionPrice}`);
            } else {
              const { exchangeManager } = await import('./utils/exchangeUtils');
              const ccxtExchange = await exchangeManager.getExchangeInstance(exchange);
              if (ccxtExchange.has['fetchTicker']) {
                const ticker = await ccxtExchange.fetchTicker(symbol);
                executionPrice = type === 'buy' ? ticker.ask : ticker.bid;
                console.log(`Got price from ticker: ${executionPrice}`);
              }
            }
          } catch (priceError) {
            // If we can't get the real price, use our base price
            console.error('Error getting price from exchange:', priceError);
          }
        }
        
        // Use base price as fallback
        executionPrice = executionPrice || this.getBasePrice(symbol) || 0;
        
        // Generate a simulated trade result
        const tradeResult = {
          id: `demo-order-${Date.now()}`,
          symbol,
          type: price ? 'limit' : 'market',
          side: type,
          amount,
          price: executionPrice,
          cost: amount * executionPrice,
          fee: (amount * executionPrice) * 0.001, // 0.1% fee
          timestamp: Date.now(),
          status: 'closed',
          info: {
            isSimulated: true,
            message: 'This is a simulated trade for demonstration purposes'
          }
        };
        
        console.log(`Simulated trade executed: ${JSON.stringify(tradeResult)}`);
        return tradeResult;
      }
    } catch (error) {
      console.error(`Failed to execute trade:`, error);
      throw new Error(`Failed to execute trade: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Format exchange name for display
   * @param exchangeName Raw exchange name (typically lowercase)
   * @returns Formatted exchange name for display
   */
  formatExchangeName(exchangeName: string): string {
    if (!exchangeName) return "";
    
    // Common exchange name transformations
    const nameMap: Record<string, string> = {
      'binanceus': 'Binance US',
      'binance': 'Binance',
      'kraken': 'Kraken',
      'kraken1': 'Kraken',
      'kucoin': 'KuCoin',
      'kucoin1': 'KuCoin',
      'bitfinex': 'Bitfinex',
      'bitfinex1': 'Bitfinex',
      'bitfinex2': 'Bitfinex v2',
      'coinbase': 'Coinbase',
      'coinbasepro': 'Coinbase Pro',
      'coinex': 'CoinEx',
      'ftx': 'FTX',
      'ftxus': 'FTX US',
      'gateio': 'Gate.io',
      'gate': 'Gate.io',
      'huobi': 'Huobi',
      'huobipro': 'Huobi Pro',
      'okcoin': 'OKCoin',
      'okx': 'OKX',
      'bitflyer': 'bitFlyer',
      'bitstamp': 'Bitstamp',
      'bittrex': 'Bittrex',
      'currencycom': 'Currency.com',
      'cryptocom': 'Crypto.com',
      'gemini': 'Gemini',
      'mexc': 'MEXC',
      'bybit': 'Bybit',
      'phemex': 'Phemex',
      'poloniex': 'Poloniex',
      'upbit': 'Upbit',
      'whitebit': 'WhiteBIT',
      'woo': 'WOO X',
      'bydfi': 'BYDFi',
      'bitget': 'Bitget',
      'demo': 'Demo'
    };

    // Check if the exchange name is in our map
    if (nameMap[exchangeName.toLowerCase()]) {
      return nameMap[exchangeName.toLowerCase()];
    }

    // Default formatting: capitalize first letter and split by non-alphanumeric characters
    return exchangeName
      .split(/(?=[A-Z])|[^a-zA-Z0-9]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ')
      .trim();
  }
}

export const exchangeService = new ExchangeService();