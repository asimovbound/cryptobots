import * as ccxt from 'ccxt';
import { storage } from './storage';
import { Bot, InsertBacktestResult, Exchange } from '@shared/schema';
import { exchangeManager, formatExchangeName } from './utils/exchangeUtils';

/**
 * Service for backtesting trading strategies
 */
export class BacktestService {
  /**
   * Run a backtest for a given trading pair, parameters, and period
   * @param pair Trading pair (e.g., 'BTC/USD')
   * @param parameters Strategy parameters
   * @param period Time period for backtest (e.g., '30d', '1h', etc.)
   * @param exchangeId Exchange ID to use for fetching data
   * @param interval Candlestick interval to use (e.g., '1m', '5m', '15m', '1h')
   * @returns Backtest result
   */
  async runBacktest(
    pair: string,
    parameters: any,
    period: string = '30d',
    exchangeId?: number,
    interval?: string,
    startDate?: string,
    endDate?: string
  ): Promise<BacktestResult> {
    try {
      // Variable to hold candles that will be used for backtesting
      let candles: Candle[];
      
      // Handle custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range: ${startDate} to ${endDate}`);
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Calculate the duration in milliseconds
        const durationMs = end.getTime() - start.getTime();
        
        // Use the provided interval or default to 1 day
        const timeframe = interval || '1d';
        const intervalMs = this.timeframeToMs(timeframe);
        
        // Calculate number of candles needed
        const candleCount = Math.ceil(durationMs / intervalMs);
        
        // Ensure we get a reasonable number of candles (between 50 and 5000)
        const adjustedCandleCount = Math.max(50, Math.min(5000, candleCount));
        
        console.log(`Custom date range from ${start.toISOString()} to ${end.toISOString()}`);
        console.log(`Using timeframe: ${timeframe} with ${adjustedCandleCount} candles`);
        
        // Fetch historical data with custom date range
        candles = await this.fetchHistoricalData(
          pair, 
          timeframe,
          adjustedCandleCount,
          exchangeId,
          start.getTime()
        );
      } else {
        // Parse period to determine timeframe and candle count
        // If interval is provided, use it as the timeframe instead of deriving from period
        const { timeframe: derivedTimeframe, candleCount: derivedCandleCount } = this.parsePeriod(period);
        const timeframe = interval || derivedTimeframe;
        
        // If interval is provided and different from derivedTimeframe, calculate appropriate candleCount
        let candleCount = derivedCandleCount;
        if (interval && interval !== derivedTimeframe) {
          // Calculate appropriate candle count based on the period and provided interval
          const periodDurationMs = this.periodToMilliseconds(period);
          const intervalMs = this.timeframeToMs(interval);
          // Calculate how many candles needed to cover the period
          const calculatedCandleCount = Math.ceil(periodDurationMs / intervalMs);
          // Ensure we get a reasonable number of candles (between 50 and 5000)
          candleCount = Math.max(50, Math.min(5000, calculatedCandleCount));
          console.log(`Recalculated candle count for interval ${interval}: ${candleCount} (covers ${(candleCount * intervalMs) / (24 * 60 * 60 * 1000)} days)`);
        }
        
        console.log(`Using timeframe: ${timeframe} (from interval parameter: ${interval ? 'yes' : 'no'}) with ${candleCount} candles`);
        
        // Fetch historical data
        candles = await this.fetchHistoricalData(pair, timeframe, candleCount, exchangeId);
      }
      
      // Run appropriate strategy based on parameters
      const strategyType = parameters.strategy || 'bollinger_bands';
      
      let result: BacktestResult;
      
      console.log(`Running backtest with strategy type: ${strategyType}`);
      console.log(`Strategy parameters:`, JSON.stringify(parameters));
      
      switch (strategyType) {
        case 'bollinger_bands':
          result = await this.runBollingerBandsStrategy(candles, parameters);
          break;
        case 'macd':
          result = await this.runMacdStrategy(candles, parameters);
          break;
        case 'ma_crossover':
          result = await this.runMovingAverageCrossoverStrategy(candles, parameters);
          break;
        case 'sma':
          // SMA strategy is a simplified version of MA crossover
          const smaParams = {...parameters, maType: 'sma'};
          result = await this.runMovingAverageCrossoverStrategy(candles, smaParams);
          break;
        case 'ema':
          // EMA strategy is a simplified version of MA crossover
          const emaParams = {...parameters, maType: 'ema'};
          result = await this.runMovingAverageCrossoverStrategy(candles, emaParams);
          break;
        case 'grid':
          result = await this.runGridStrategy(candles, parameters);
          break;
        case 'dca':
          result = await this.runDcaStrategy(candles, parameters);
          break;
        case 'rsi':
          result = await this.runRsiStrategy(candles, parameters);
          break;
        case 'signal':
          throw new Error(`Signal strategy is not fully implemented yet. Please choose another strategy.`);
        default:
          throw new Error(`Unknown strategy type '${strategyType}'. Please choose a supported strategy type.`);
      }
      
      // Set the trading pair in the result
      result.tradingPair = pair;
      
      console.log("Sanitizing backtest results before sending to client...");
      // Sanitize result to ensure no NaN values - use the consistent parameter extraction pattern
      const sanitizedResult = this.sanitizeBacktestResult(result, parseFloat(String(parameters.investment)) || 1000);
      
      return sanitizedResult;
    } catch (error) {
      console.error('Backtest error:', error);
      throw error;
    }
  }
  
  /**
   * Parse period string to timeframe and candle count
   * @param period Period string (e.g., '30d', '1h', etc.)
   * @returns Timeframe and candle count
   */
  private parsePeriod(period: string): { timeframe: string, candleCount: number } {
    console.log(`Parsing period: ${period}`);
    
    // Handle special cases first
    if (period === '1w' || period === '1W' || period === 'w' || period === 'W') {
      console.log(`Parsed special period: weekly timeframe`);
      return { timeframe: '1w', candleCount: 52 }; // One year of weekly data
    }
    
    if (period === '1M' || period === 'M') {
      console.log(`Parsed special period: monthly timeframe - using daily candles for 30 days`);
      return { timeframe: '1d', candleCount: 30 }; // 30 days of daily data
    }
    
    if (period === '1y' || period === '1Y' || period === 'y' || period === 'Y') {
      console.log(`Parsed special period: yearly timeframe using daily candles`);
      return { timeframe: '1d', candleCount: 365 }; // One year of daily data
    }
    
    // Special handling for common minute-based intervals
    if (period === '5m') {
      console.log(`Parsed special minute period: 5-minute timeframe`);
      return { timeframe: '5m', candleCount: 24 * 12 }; // One day of 5-minute data (288 candles)
    }
    
    if (period === '15m') {
      console.log(`Parsed special minute period: 15-minute timeframe`);
      return { timeframe: '15m', candleCount: 24 * 4 * 7 }; // One week of 15-minute data
    }
    
    if (period === '30m') {
      console.log(`Parsed special minute period: 30-minute timeframe`);
      return { timeframe: '30m', candleCount: 24 * 2 * 14 }; // Two weeks of 30-minute data
    }
    
    // Handle standard timeframes with a number prefix
    // We need to be careful with the case sensitivity here
    // 'm' = minutes, 'M' = months
    const match = period.match(/(\d+)([dhmswyM])/);
    
    if (!match) {
      console.log(`Invalid period format: ${period}, defaulting to 30d`);
      return { timeframe: '1d', candleCount: 30 }; // Default to 30 days
    }
    
    const value = parseInt(match[1]);
    const unit = match[2]; // Keep the original case to distinguish 'm' from 'M'
    
    let timeframe: string;
    let candleCount: number;
    
    switch (unit) {
      case 'm': // 'm' lowercase for minutes
        if (value === 1) {
          // For 1-minute data
          timeframe = '1m';
          candleCount = 60 * 24; // One day of 1-minute data
        } else if (value === 5) {
          // For 5-minute data
          timeframe = '5m';
          candleCount = 12 * 24; // One day of 5-minute data
        } else if (value === 15) {
          // For 15-minute data
          timeframe = '15m';
          candleCount = 4 * 24; // One day of 15-minute data
        } else if (value === 30) {
          // For 30-minute data
          timeframe = '30m';
          candleCount = 2 * 24; // One day of 30-minute data
        } else {
          // For other minute intervals (not commonly used), fall back to 1m
          console.log(`Non-standard minute interval ${value}m, using 1m timeframe`);
          timeframe = '1m';
          candleCount = 60 * 24; // One day of 1-minute data
        }
        break;
      case 'M': // 'M' uppercase for months
        // For X month periods, always use daily candles
        timeframe = '1d';
        candleCount = value * 30; // Exactly 30 days per month for consistency
        console.log(`Parsed ${value} month period to ${candleCount} daily candles (30 days per month)`);
        break;
      case 'h':
        if (value === 1) {
          timeframe = '1h';
          candleCount = 24 * 7; // One week of hourly data
        } else if (value === 2) {
          timeframe = '2h';
          candleCount = 12 * 7; // One week of 2-hour data
        } else if (value === 4) {
          timeframe = '4h';
          candleCount = 6 * 7; // One week of 4-hour data
        } else if (value === 6) {
          timeframe = '6h';
          candleCount = 4 * 7; // One week of 6-hour data
        } else if (value === 12) {
          timeframe = '12h';
          candleCount = 2 * 7; // One week of 12-hour data
        } else {
          // For other hour intervals, use 1h
          console.log(`Non-standard hour interval ${value}h, using 1h timeframe`);
          timeframe = '1h';
          candleCount = 24 * 7; // One week of hourly data
        }
        break;
      case 'd':
        timeframe = '1d';
        // For daily periods like 30d, get enough candles to cover the period
        candleCount = Math.max(value, 30); // At least 30 days
        break;
      case 'w':
        timeframe = '1w';
        // For weekly periods like 4w, get enough weekly candles
        candleCount = Math.max(value, 52); // At least a year of weekly data
        break;
      case 'y':
        if (value > 2) {
          // For long periods like 5y, use monthly data
          timeframe = '1M';
          candleCount = value * 12;
        } else {
          // For 1-2 year periods, use daily data for better granularity
          timeframe = '1d';
          candleCount = value * 365;
        }
        break;
      default:
        timeframe = '1d';
        candleCount = 30;
    }
    
    console.log(`Parsed period to timeframe: ${timeframe}, candleCount: ${candleCount}`);
    return { timeframe, candleCount };
  }
  
  /**
   * Fetch historical market data
   * @param pair Trading pair
   * @param timeframe Timeframe (e.g., '1m', '1h', '1d')
   * @param limit Number of candles to fetch
   * @returns Historical OHLCV data
   */
  private async fetchHistoricalData(
    pair: string,
    timeframe: string,
    limit: number,
    exchangeId?: number,
    since?: number
  ): Promise<Candle[]> {
    try {
      console.log(`===== STARTING HISTORICAL DATA FETCH =====`);
      console.log(`Pair: ${pair}, Timeframe: ${timeframe}, Limit: ${limit}, Exchange ID: ${exchangeId || 'not specified'}`);
      
      // Try to fetch real data from CCXT
      try {
        // Set default exchange in case we can't find the specific one
        let exchangeName = 'kraken'; // Default exchange if we can't find the pair
        let exchangeDisplayName = 'Kraken';
        
        try {
          if (exchangeId) {
            // If exchangeId is provided, use it directly
            const exchange = await storage.getExchange(exchangeId);
            if (exchange) {
              exchangeName = exchange.name;
              exchangeDisplayName = exchange.displayName || exchange.name;
              console.log(`Using exchange specified by ID ${exchangeId}: ${exchangeDisplayName} (${exchangeName})`);
            } else {
              console.log(`Exchange with ID ${exchangeId} not found. Using default exchange: ${exchangeDisplayName} (${exchangeName})`);
            }
          } else {
            // If no exchangeId provided, try to find it from the trading pair
            const tradingPairs = await storage.getAllTradingPairs();
            const matchingPair = tradingPairs.find(tp => tp.symbol === pair);
            
            if (matchingPair) {
              // Get the exchange information
              const exchange = await storage.getExchange(matchingPair.exchangeId);
              if (exchange) {
                exchangeName = exchange.name;
                exchangeDisplayName = exchange.displayName || exchange.name;
                console.log(`Found matching trading pair in database. Using exchange: ${exchangeDisplayName} (${exchangeName})`);
              }
            } else {
              console.log(`Trading pair ${pair} not found in database. Using default exchange: ${exchangeDisplayName} (${exchangeName})`);
            }
          }
        } catch (dbError) {
          console.error(`Error finding exchange for pair ${pair}:`, dbError);
          console.log(`Falling back to default exchange: ${exchangeDisplayName} (${exchangeName})`);
        }
        
        console.log(`Initializing CCXT ${exchangeDisplayName} connection (public API)...`);
        
        // Create the appropriate exchange instance using the exchangeManager from utils
        // Create a mock Exchange object for the exchangeManager
        const exchangeObj: Exchange = {
          id: exchangeId || 0,
          name: exchangeName,
          displayName: null,
          apiKey: '', // Empty string instead of null
          apiSecret: '', // Empty string instead of null
          apiKeyLabel: null,
          canWithdraw: null,
          isDemo: false,
          status: 'connected',
          createdAt: new Date(),
          userId: 0 // Public API usage
        };
        
        // Initialize exchange variable
        let exchange;
        
        try {
          exchange = await exchangeManager.getExchangeInstance(exchangeObj);
          console.log(`Using cached CCXT instance for ${exchangeName} from exchangeManager`);
        } catch (error) {
          console.error(`Error getting exchange instance from exchangeManager:`, error);
          // Fallback to Kraken if there was an error
          console.log(`Falling back to Kraken for backtesting due to error.`);
          exchangeObj.name = 'kraken';
          exchange = await exchangeManager.getExchangeInstance(exchangeObj);
        }
        
        console.log(`CCXT ${exchangeDisplayName} instance created:`, typeof exchange);
        console.log(`Exchange has fetchOHLCV:`, exchange.has['fetchOHLCV']);
        console.log(`Supported timeframes:`, Object.keys(exchange.timeframes || {}).join(', '));
        
        // Ensure we are using a valid timeframe that the exchange supports
        // Using let instead of const since we may need to adjust it later for monthly timeframes
        let standardTimeframe = this.normalizeTimeframe(timeframe);
        console.log(`Using normalized timeframe: ${standardTimeframe}`);
        
        // Default to BTC/USD if pair is not recognized
        let normalizedPair = pair;
        if (!normalizedPair.includes('/')) {
          console.warn(`Invalid pair format: ${pair}, should be in format BASE/QUOTE, defaulting to BTC/USD`);
          normalizedPair = 'BTC/USD';
        }
        
        // Calculate the number of candles needed based on requested limit and timeframe
        // We'll use the lower of the requested limit or the maximum safe limit for the timeframe
        const minimumCandles = Math.max(limit, 100);
        
        // Get the total candles needed based on the period requested and timeframe
        let totalCandlesNeeded = minimumCandles;
        
        // We'll adjust these values based on the timeframe
        let timeframeToUse = standardTimeframe;  // Will hold the timeframe we end up using
        let candlesToFetch = limit;              // Will hold how many candles to fetch
        
        // First, handle monthly timeframes by converting them to daily
        if (standardTimeframe.includes('M')) {
            console.log(`Converting monthly timeframe ${standardTimeframe} to daily candles`);
            timeframeToUse = '1d';
            candlesToFetch = Math.min(limit * 30, 365 * 5); // Up to 5 years of daily data
            console.log(`For monthly timeframe, using ${candlesToFetch} daily candles (${candlesToFetch / 30} months of data)`);
        } else if (standardTimeframe.includes('m')) {
            // Extract the minute value (e.g., 1m, 5m, 15m)
            const minuteValue = parseInt(standardTimeframe);
            
            // For minute data, we need to adjust based on the minute interval
            // Calculate how many candles are in a day for this timeframe
            const candlesPerDay = 24 * 60 / minuteValue;
            
            if (limit <= candlesPerDay) { // Less than a day
                candlesToFetch = limit;
            } else if (limit <= 7 * candlesPerDay) { // Less than a week
                candlesToFetch = limit;
            } else if (limit <= 30 * candlesPerDay) { // Less than a month
                candlesToFetch = limit;
            } else {
                // Cap at 1 month for minute-level data to avoid too many API requests
                candlesToFetch = Math.min(limit, 30 * candlesPerDay);
            }
            
            console.log(`For ${standardTimeframe} timeframe, using ${candlesToFetch} candles (${candlesToFetch / candlesPerDay} days of data)`);
        } else if (standardTimeframe.includes('h')) {
            // Extract the hour value (e.g., 1h, 4h)
            const hourValue = parseInt(standardTimeframe);
            
            // Calculate how many candles are in a day for this timeframe
            const candlesPerDay = 24 / hourValue;
            
            // For hourly data, get more historical data if requested
            candlesToFetch = Math.min(limit, 365 * candlesPerDay); // Up to a year for hourly data
            
            console.log(`For ${standardTimeframe} timeframe, using ${candlesToFetch} candles (${candlesToFetch / candlesPerDay} days of data)`);
        } else if (standardTimeframe.includes('d')) {
            // For daily data, get up to several years
            candlesToFetch = Math.min(limit, 365 * 5); // Up to 5 years of daily data
            
            console.log(`For ${standardTimeframe} timeframe, using ${candlesToFetch} candles (${candlesToFetch} days of data)`);
        } else if (standardTimeframe.includes('w')) {
            // For weekly data, get up to several years
            candlesToFetch = Math.min(limit, 52 * 5); // Up to 5 years of weekly data
            
            console.log(`For ${standardTimeframe} timeframe, using ${candlesToFetch} candles (${candlesToFetch} weeks of data)`);
        }
        
        // Update our variables to use the adjusted values
        standardTimeframe = timeframeToUse;
        totalCandlesNeeded = candlesToFetch;
        
        console.log(`Fetching up to ${totalCandlesNeeded} OHLCV candles for ${normalizedPair} at ${standardTimeframe} timeframe from ${exchangeDisplayName}...`);
        
        // Calculate since date based on timeframe and total candles needed
        const now = Date.now();
        const timeframeMs = this.timeframeToMs(standardTimeframe);
        // Use custom since time if provided, otherwise calculate based on candles needed
        const sinceTimestamp = since !== undefined ? since : now - (timeframeMs * totalCandlesNeeded);
        
        // Batch fetch OHLCV data to get more historical data
        // We'll make multiple requests to build a larger dataset
        let allOhlcv: any[] = [];
        let currentSince = sinceTimestamp;
        let batchSize = 500; // Most exchanges have limits on candles per request
        let maxRetries = 3;
        
        // Determine how many batches to fetch based on total candles needed
        const maxBatches = Math.ceil(totalCandlesNeeded / batchSize);
        
        // Try to fetch multiple batches
        for (let i = 0; i < maxBatches; i++) { // Get up to maxBatches
          try {
            console.log(`Fetching batch ${i+1}, since timestamp ${new Date(currentSince).toISOString()}`);
            const batchOhlcv = await exchange.fetchOHLCV(normalizedPair, standardTimeframe, currentSince, batchSize);
            
            if (batchOhlcv.length === 0) {
              console.log(`No more data available after batch ${i}`);
              break;
            }
            
            allOhlcv = [...allOhlcv, ...batchOhlcv];
            console.log(`Added ${batchOhlcv.length} candles from batch ${i+1}, total now: ${allOhlcv.length}`);
            
            // Calculate the next since timestamp based on the last candle
            if (batchOhlcv && batchOhlcv.length > 0 && batchOhlcv[batchOhlcv.length - 1]) {
              const lastCandle = batchOhlcv[batchOhlcv.length - 1];
              if (lastCandle && lastCandle[0]) {
                const lastTimestamp = lastCandle[0];
                currentSince = lastTimestamp + timeframeMs;
              } else {
                // If we can't get a valid timestamp, move forward by batch size
                currentSince += timeframeMs * batchSize;
              }
            } else {
              // If no data in batch, move forward by the batch size in time
              currentSince += timeframeMs * batchSize;
            }
            
            // Wait briefly to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (batchError: any) {
            console.warn(`Error fetching batch ${i+1}: ${batchError.message}`);
            if (--maxRetries <= 0) {
              console.error(`Max retries exceeded, stopping batch fetching`);
              break;
            }
          }
        }
        
        // If we couldn't get enough data, throw an error
        if (allOhlcv.length < 20) {
          throw new Error(`Could not fetch sufficient historical data for ${normalizedPair}, only got ${allOhlcv.length} candles`);
        }
        
        console.log(`OHLCV data received, entries: ${allOhlcv.length}`);
        
        // Show first few entries for debugging
        console.log(`Sample OHLCV data:`, JSON.stringify(allOhlcv.slice(0, 2)));
        
        // Convert CCXT format to our Candle format
        const candles: Candle[] = allOhlcv.map((candle: any) => ({
          timestamp: candle[0],
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5]
        }));
        
        // Sort candles by timestamp ascending
        candles.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`Successfully fetched ${candles.length} candles from ${exchangeDisplayName}`);
        console.log(`First candle: ${new Date(candles[0].timestamp).toISOString()}`);
        console.log(`Last candle: ${new Date(candles[candles.length-1].timestamp).toISOString()}`);
        console.log(`===== COMPLETED HISTORICAL DATA FETCH =====`);
        return candles;
      } catch (ccxtError: any) {
        console.warn(`Error fetching data from CCXT:`, ccxtError);
        console.warn(`Error message: ${ccxtError.message}`);
        console.warn(`Error stack: ${ccxtError.stack}`);
        console.error(`Failed to fetch market data from exchange for ${pair}`);
        // Return empty array - our sanitization will handle this case
        console.log(`===== MARKET DATA FETCH FAILED =====`);
        throw new Error(`Failed to fetch market data from exchange: ${ccxtError.message}`);
      }
    } catch (error) {
      console.error('Error in fetchHistoricalData:', error);
      throw error;
    }
  }
  
  /**
   * Normalize timeframe to standard CCXT format
   * @param timeframe Our internal timeframe string
   * @returns Standard CCXT timeframe
   */
  private normalizeTimeframe(timeframe: string): string {
    // Handle special cases for weekly and monthly timeframes
    if (timeframe === '1w' || timeframe === 'w' || timeframe === '1W' || timeframe === 'W') {
      return '1w';
    }
    
    if (timeframe === '1M' || timeframe === 'M') {
      console.log(`Converting monthly timeframe ${timeframe} to daily candles for consistency`);
      return '1d'; // Always use daily candles for months
    }
    
    // Map our custom timeframe format to standard CCXT format
    // Examples: 1d -> 1d, 30m -> 30m, 4h -> 4h
    const match = timeframe.match(/(\d+)([dhmswy])/i);
    
    if (!match) {
      console.log(`Could not parse timeframe ${timeframe}, returning 1d as default`);
      return '1d';
    }
    
    const value = match[1];
    const unit = match[2].toLowerCase();
    
    // CCXT uses lowercase m (minute), h (hour), d (day), w (week), M (month) as units
    return `${value}${unit}`;
  }
  
  /**
   * Generate synthetic historical data for testing
   * @param pair Trading pair
   * @param timeframe Timeframe
   * @param count Number of candles
   * @returns Synthetic OHLCV data
   */
  private generateHistoricalData(
    pair: string,
    timeframe: string,
    count: number,
    exchangeId?: number
  ): Candle[] {
    const candles: Candle[] = [];
    
    // Initial price based on trading pair
    let basePrice: number;
    if (pair.includes('BTC')) {
      basePrice = 50000;
    } else if (pair.includes('ETH')) {
      basePrice = 3000;
    } else if (pair.includes('SOL')) {
      basePrice = 100;
    } else {
      basePrice = 1;
    }
    
    // Generate random walk price data
    let currentPrice = basePrice;
    let timestamp = Date.now() - this.timeframeToMs(timeframe) * count;
    
    for (let i = 0; i < count; i++) {
      // Random price movement (random walk with drift and volatility)
      const volatility = basePrice * 0.015; // 1.5% volatility per candle on average
      const drift = basePrice * 0.0005; // Small upward drift (0.05% per candle)
      
      const change = (Math.random() - 0.5) * volatility + drift;
      
      // Calculate OHLC
      const open = currentPrice;
      const close = currentPrice + change;
      const high = Math.max(open, close) + Math.random() * Math.abs(change) * 0.5;
      const low = Math.min(open, close) - Math.random() * Math.abs(change) * 0.5;
      
      // Generate volume
      const volume = basePrice * (20 + Math.random() * 80);
      
      candles.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume
      });
      
      // Update for next candle
      currentPrice = close;
      timestamp += this.timeframeToMs(timeframe);
    }
    
    return candles;
  }
  
  /**
   * Convert timeframe string to milliseconds
   * @param timeframe Timeframe string (e.g., '1m', '1h', '1d')
   * @returns Milliseconds
   */
  private timeframeToMs(timeframe: string): number {
    // Handle special cases for weekly and monthly timeframes
    if (timeframe === '1w' || timeframe === 'w') {
      return 7 * 24 * 60 * 60 * 1000; // 1 week
    }
    
    if (timeframe === '1M' || timeframe === 'M') {
      console.log('Using daily candles (30 days) instead of monthly timeframe');
      return 30 * 24 * 60 * 60 * 1000; // Exactly 30 days
    }
    
    // Match the standard timeframe pattern (number + unit)
    // We need to preserve case sensitivity to distinguish 'm' from 'M'
    const match = timeframe.match(/(\d+)([dhmswyM])/);
    
    if (!match) {
      return 24 * 60 * 60 * 1000; // Default to 1 day
    }
    
    const value = parseInt(match[1]);
    const unit = match[2]; // Keep original case
    
    switch (unit) {
      case 's': return value * 1000;                 // seconds
      case 'm': return value * 60 * 1000;            // minutes (lowercase m)
      case 'M': return value * 30 * 24 * 60 * 60 * 1000; // months (uppercase M)
      case 'h': return value * 60 * 60 * 1000;       // hours
      case 'd': return value * 24 * 60 * 60 * 1000;  // days
      case 'w': return value * 7 * 24 * 60 * 60 * 1000; // weeks
      case 'y': return value * 365 * 24 * 60 * 60 * 1000; // years (approximate)
      default: return 24 * 60 * 60 * 1000;           // default to 1 day
    }
  }
  
  /**
   * Convert period string to milliseconds
   * @param period Period string (e.g., '30d', '1w', '1h')
   * @returns Milliseconds
   */
  private periodToMilliseconds(period: string): number {
    // Handle special cases first
    if (period === '1w' || period === '1W' || period === 'w' || period === 'W') {
      return 7 * 24 * 60 * 60 * 1000; // 1 week
    }
    
    if (period === '1M' || period === 'M') {
      return 30 * 24 * 60 * 60 * 1000; // 1 month (approximate)
    }
    
    if (period === '1y' || period === '1Y' || period === 'y' || period === 'Y') {
      return 365 * 24 * 60 * 60 * 1000; // 1 year (approximate)
    }
    
    // Handle standard timeframes with a number prefix
    // Keep case sensitivity for distinguishing 'm' vs 'M'
    const match = period.match(/(\d+)([dhmswyM])/);
    
    if (!match) {
      // Default to 30 days if format is invalid
      return 30 * 24 * 60 * 60 * 1000;
    }
    
    const value = parseInt(match[1]);
    const unit = match[2]; // Keep original case
    
    switch (unit) {
      case 'm': return value * 60 * 1000; // minutes (lowercase m)
      case 'M': return value * 30 * 24 * 60 * 60 * 1000; // months (uppercase M)
      case 'h': return value * 60 * 60 * 1000; // hours
      case 'd': return value * 24 * 60 * 60 * 1000; // days
      case 'w': return value * 7 * 24 * 60 * 60 * 1000; // weeks
      case 'y': return value * 365 * 24 * 60 * 60 * 1000; // years (approximate)
      default: return 30 * 24 * 60 * 60 * 1000; // Default to 30 days
    }
  }
  
  /**
   * Sanitize backtest result to prevent NaN values
   * @param result The backtest result to sanitize
   * @param investment Initial investment amount
   * @returns Sanitized backtest result
   */
  private sanitizeBacktestResult(result: BacktestResult, investment: number): BacktestResult {
    const sanitized = { ...result };
    
    // Ensure profit is a valid number
    if (isNaN(sanitized.profit)) {
      console.warn('Sanitized NaN profit value to 0');
      sanitized.profit = 0;
    }
    
    // Ensure profitPercentage is a valid number
    if (isNaN(sanitized.profitPercentage)) {
      console.warn('Sanitized NaN profitPercentage value to 0');
      sanitized.profitPercentage = 0;
    }
    
    // Ensure trades is a valid array
    if (!Array.isArray(sanitized.trades)) {
      console.warn('Sanitized invalid trades array');
      sanitized.trades = [];
    } else {
      // Also sanitize individual trades
      sanitized.trades = sanitized.trades.map(trade => ({
        ...trade,
        profit: isNaN(trade.profit) ? 0 : trade.profit,
        profitPercentage: isNaN(trade.profitPercentage) ? 0 : trade.profitPercentage
      }));
    }
    
    // Ensure equity is a valid array with at least one value
    if (!Array.isArray(sanitized.equity) || sanitized.equity.length === 0) {
      console.warn('Sanitized invalid equity array');
      sanitized.equity = [investment];
    } else {
      // Also sanitize individual equity points
      sanitized.equity = sanitized.equity.map(value => 
        isNaN(value) ? investment : value
      );
    }
    
    // Ensure timestamps is a valid array with at least one value
    if (!Array.isArray(sanitized.timestamps) || sanitized.timestamps.length === 0) {
      console.warn('Sanitized invalid timestamps array');
      sanitized.timestamps = [Date.now()];
    }
    
    // Ensure metrics has valid values
    if (sanitized.metrics) {
      const metrics = sanitized.metrics;
      
      // Sanitize each metric to ensure no NaN values
      metrics.totalTrades = isNaN(metrics.totalTrades) ? 0 : metrics.totalTrades;
      metrics.winningTrades = isNaN(metrics.winningTrades) ? 0 : metrics.winningTrades;
      metrics.losingTrades = isNaN(metrics.losingTrades) ? 0 : metrics.losingTrades;
      metrics.winRate = isNaN(metrics.winRate) ? 0 : metrics.winRate;
      metrics.profitFactor = isNaN(metrics.profitFactor) ? 0 : metrics.profitFactor;
      metrics.averageProfit = isNaN(metrics.averageProfit) ? 0 : metrics.averageProfit;
      metrics.averageLoss = isNaN(metrics.averageLoss) ? 0 : metrics.averageLoss;
      metrics.largestProfit = isNaN(metrics.largestProfit) ? 0 : metrics.largestProfit;
      metrics.largestLoss = isNaN(metrics.largestLoss) ? 0 : metrics.largestLoss;
      metrics.maxDrawdown = isNaN(metrics.maxDrawdown) ? 0 : metrics.maxDrawdown;
      metrics.sharpeRatio = isNaN(metrics.sharpeRatio) ? 0 : metrics.sharpeRatio;
      metrics.maxConsecutiveWins = isNaN(metrics.maxConsecutiveWins) ? 0 : metrics.maxConsecutiveWins;
      metrics.maxConsecutiveLosses = isNaN(metrics.maxConsecutiveLosses) ? 0 : metrics.maxConsecutiveLosses;
    }
    
    return sanitized;
  }
  
  /**
   * Implementation of Bollinger Bands strategy
   * @param candles Historical OHLCV data
   * @param parameters Strategy parameters
   * @returns Backtest result
   */
  private async runBollingerBandsStrategy(
    candles: Candle[],
    parameters: any
  ): Promise<BacktestResult> {
    try {
      // Extract parameters with defaults - support both new and old parameter format
      // Properly convert parameters to the right type and handle both flat and nested formats
      const period = parseInt(String(parameters.period)) || parseInt(String(parameters.bollinger?.period)) || 20;
      const deviation = parseFloat(String(parameters.stdDev)) || parseFloat(String(parameters.bollinger?.deviation)) || 2;
      const investment = parseFloat(String(parameters.investment)) || 1000;
      
      // Extract risk management parameters with proper frontend names first, then fallbacks
      let positionSize = parseFloat(String(parameters.positionSize)) || parseFloat(String(parameters.tradeSize)) || 0.1;
      // Always use leverage = 1 (leverage feature removed)
      let leverage = 1;
      let stopLossPercent = parseFloat(String(parameters.stopLossPercent)) || parseFloat(String(parameters.stopLoss)) || 5;
      let takeProfitPercent = parseFloat(String(parameters.takeProfitPercent)) || parseFloat(String(parameters.takeProfit)) || 10;
      
      console.log('Using Bollinger Bands parameters:', { period, deviation, investment, positionSize, stopLossPercent, takeProfitPercent });
      
      // Extract bandwidth filter parameters (optional)
      const useBandwidthFilter = parameters.useMeanReversion !== undefined ? parameters.useMeanReversion : (parameters.bollinger?.useBandwidthFilter || false);
      const minBandwidth = parameters.minBandwidth || parameters.bollinger?.minBandwidth || 0.01;
      const maxBandwidth = parameters.maxBandwidth || parameters.bollinger?.maxBandwidth || 0.1;
      
      // Extract entry/exit condition parameters
      const entryThreshold = parameters.entryThreshold || parameters.bollinger?.entryThreshold || 0; // How far past the band (%)
      const exitMiddleBand = parameters.exitMiddleBand !== undefined ? parameters.exitMiddleBand : (parameters.bollinger?.exitMiddleBand || false); // Exit at middle band
      
      // Initialize variables
      const trades: BacktestTrade[] = [];
      const equity: number[] = [investment];
      const timestamps: number[] = [candles[0].timestamp];
      
      let availableFunds = investment;
      let inPosition = false;
      let entryPrice = 0;
      let positionDirection: 'buy' | 'sell' = 'buy';
      let positionSize_units = 0;
      let currentPositionId = 1;
      
      // Calculate Bollinger Bands with bandwidth
      const { sma, upperBand, lowerBand, bandwidth } = this.calculateBollingerBands(candles, period, deviation);
      
      // Loop through each candle (skipping the initial ones needed for indicators)
      for (let i = period; i < candles.length; i++) {
        const candle = candles[i];
        const prevCandle = candles[i - 1];
        
        // Check for stop-loss or take-profit on existing position
        if (inPosition) {
          // Calculate current position value
          const currentPrice = candle.close;
          const positionValue = positionSize_units * currentPrice;
          const percentChange = positionDirection === 'buy'
            ? ((currentPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - currentPrice) / entryPrice) * 100;
          
          // Check stop-loss
          if (percentChange <= -stopLossPercent) {
            // Stop loss hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += positionValue;
            inPosition = false;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
          }
          // Check take-profit
          else if (percentChange >= takeProfitPercent) {
            // Take profit hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += positionValue;
            inPosition = false;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
          }
        }
        
        // Strategy logic
        if (!inPosition) {
          // Apply bandwidth filter if enabled
          const isBandwidthValid = !useBandwidthFilter || 
            (bandwidth[i] >= minBandwidth && bandwidth[i] <= maxBandwidth);
            
          if (isBandwidthValid) {
            // Buy signal: Price crosses below lower band with threshold
            const lowerEntry = lowerBand[i] * (1 - entryThreshold / 100);
            if (prevCandle.close >= lowerBand[i - 1] && candle.close < lowerEntry) {
              // Calculate position size
              const price = candle.close;
              const positionValue = availableFunds * positionSize;
              positionSize_units = positionValue / price;
              
              // Enter long position
              entryPrice = price;
              availableFunds -= positionValue;
              inPosition = true;
              positionDirection = 'buy';
              
              // Update equity curve
              equity.push(availableFunds + positionSize_units * price);
              timestamps.push(candle.timestamp);
            }
            // Sell signal: Price crosses above upper band with threshold
            else if (prevCandle.close <= upperBand[i - 1] && candle.close > upperBand[i] * (1 + entryThreshold / 100)) {
              // Calculate position size
              const price = candle.close;
              const positionValue = availableFunds * positionSize;
              positionSize_units = positionValue / price;
              
              // Enter short position
              entryPrice = price;
              availableFunds -= positionValue;
              inPosition = true;
              positionDirection = 'sell';
              
              // Update equity curve
              equity.push(availableFunds + positionSize_units * price);
              timestamps.push(candle.timestamp);
            }
          }
        }
      }
      
      // Close any open position at the end of the backtest
      if (inPosition) {
        const lastCandle = candles[candles.length - 1];
        const currentPrice = lastCandle.close;
        const percentChange = positionDirection === 'buy'
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;
        
        const profit = positionDirection === 'buy'
          ? positionSize_units * (currentPrice - entryPrice)
          : positionSize_units * (entryPrice - currentPrice);
        
        // Record the trade
        trades.push({
          id: currentPositionId,
          timestamp: lastCandle.timestamp,
          entryPrice,
          exitPrice: currentPrice,
          amount: positionSize_units,
          profit,
          profitPercentage: percentChange,
          side: positionDirection,
          duration: lastCandle.timestamp - timestamps[timestamps.length - 1]
        });
        
        // Update funds
        availableFunds += positionSize_units * currentPrice;
        
        // Update equity curve
        equity.push(availableFunds);
        timestamps.push(lastCandle.timestamp);
      }
      
      // Calculate backtest metrics
      const metrics = this.calculateMetrics(trades, investment, equity);
      
      return {
        tradingPair: '',  // Will be set by the caller
        profit: availableFunds - investment,
        profitPercentage: ((availableFunds - investment) / investment) * 100,
        trades,
        metrics,
        equity,
        timestamps
      };
    } catch (error) {
      console.error('Error running Bollinger Bands strategy:', error);
      throw error;
    }
  }
  
  /**
   * Implementation of MACD strategy
   * @param candles Historical OHLCV data
   * @param parameters Strategy parameters
   * @returns Backtest result
   */
  private async runMacdStrategy(
    candles: Candle[],
    parameters: any
  ): Promise<BacktestResult> {
    try {
      // Extract parameters with defaults - support both new and old parameter format
      const fastPeriod = parameters.fastPeriod || parameters.macd?.fast || 12;
      const slowPeriod = parameters.slowPeriod || parameters.macd?.slow || 26;
      const signalPeriod = parameters.signalPeriod || parameters.macd?.signal || 9;
      
      console.log('Using MACD parameters:', { fastPeriod, slowPeriod, signalPeriod });
      const investment = parseFloat(String(parameters.investment)) || 1000;
      
      // Extract risk management parameters with proper frontend names first, then fallbacks
      const positionSize = parseFloat(String(parameters.positionSize)) || parseFloat(String(parameters.tradeSize)) || 0.1;
      // Always use leverage = 1 (leverage feature removed)
      const leverage = 1;
      const stopLossPercent = parseFloat(String(parameters.stopLossPercent)) || parseFloat(String(parameters.stopLoss)) || 5;
      const takeProfitPercent = parseFloat(String(parameters.takeProfitPercent)) || parseFloat(String(parameters.takeProfit)) || 10;
      
      console.log('MACD risk parameters:', { positionSize, stopLossPercent, takeProfitPercent });
      
      // Initialize variables
      const trades: BacktestTrade[] = [];
      const equity: number[] = [investment];
      const timestamps: number[] = [candles[0].timestamp];
      
      let availableFunds = investment;
      let inPosition = false;
      let entryPrice = 0;
      let positionDirection: 'buy' | 'sell' = 'buy';
      let positionSize_units = 0;
      let currentPositionId = 1;
      
      // Calculate MACD
      const { macd, signal, histogram } = this.calculateMacd(candles, fastPeriod, slowPeriod, signalPeriod);
      
      // Loop through each candle (skipping the initial ones needed for indicators)
      for (let i = Math.max(slowPeriod, signalPeriod + slowPeriod - fastPeriod); i < candles.length; i++) {
        const candle = candles[i];
        const prevCandle = candles[i - 1];
        
        // Check for stop-loss or take-profit on existing position
        if (inPosition) {
          // Calculate current position value
          const currentPrice = candle.close;
          const positionValue = positionSize_units * currentPrice;
          const percentChange = positionDirection === 'buy'
            ? ((currentPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - currentPrice) / entryPrice) * 100;
          
          // Check stop-loss
          if (percentChange <= -stopLossPercent) {
            // Stop loss hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += positionValue;
            inPosition = false;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
          }
          // Check take-profit
          else if (percentChange >= takeProfitPercent) {
            // Take profit hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += positionValue;
            inPosition = false;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
          }
        }
        
        // Strategy logic
        if (!inPosition) {
          // Buy signal: MACD line crosses above signal line
          if (histogram[i - 1] <= 0 && histogram[i] > 0) {
            // Calculate position size
            const price = candle.close;
            const positionValue = availableFunds * positionSize;
            positionSize_units = positionValue / price;
            
            // Enter long position
            entryPrice = price;
            availableFunds -= positionValue;
            inPosition = true;
            positionDirection = 'buy';
            
            // Update equity curve
            equity.push(availableFunds + positionSize_units * price);
            timestamps.push(candle.timestamp);
          }
          // Sell signal: MACD line crosses below signal line
          else if (histogram[i - 1] >= 0 && histogram[i] < 0) {
            // Calculate position size
            const price = candle.close;
            const positionValue = availableFunds * positionSize;
            positionSize_units = positionValue / price;
            
            // Enter short position
            entryPrice = price;
            availableFunds -= positionValue;
            inPosition = true;
            positionDirection = 'sell';
            
            // Update equity curve
            equity.push(availableFunds + positionSize_units * price);
            timestamps.push(candle.timestamp);
          }
        }
      }
      
      // Close any open position at the end of the backtest
      if (inPosition) {
        const lastCandle = candles[candles.length - 1];
        const currentPrice = lastCandle.close;
        const percentChange = positionDirection === 'buy'
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;
        
        const profit = positionDirection === 'buy'
          ? positionSize_units * (currentPrice - entryPrice)
          : positionSize_units * (entryPrice - currentPrice);
        
        // Record the trade
        trades.push({
          id: currentPositionId,
          timestamp: lastCandle.timestamp,
          entryPrice,
          exitPrice: currentPrice,
          amount: positionSize_units,
          profit,
          profitPercentage: percentChange,
          side: positionDirection,
          duration: lastCandle.timestamp - timestamps[timestamps.length - 1]
        });
        
        // Update funds
        availableFunds += positionSize_units * currentPrice;
        
        // Update equity curve
        equity.push(availableFunds);
        timestamps.push(lastCandle.timestamp);
      }
      
      // Calculate backtest metrics
      const metrics = this.calculateMetrics(trades, investment, equity);
      
      return {
        tradingPair: '',  // Will be set by the caller
        profit: availableFunds - investment,
        profitPercentage: ((availableFunds - investment) / investment) * 100,
        trades,
        metrics,
        equity,
        timestamps
      };
    } catch (error) {
      console.error('Error running MACD strategy:', error);
      throw error;
    }
  }
  
  /**
   * Implementation of RSI strategy
   */
  private async runRsiStrategy(
    candles: Candle[],
    parameters: any
  ): Promise<BacktestResult> {
    try {
      // Extract parameters with defaults - support both new and old parameter format
      // Properly convert parameters to the right type and handle both flat and nested formats
      const period = parseInt(parameters.period) || parseInt(parameters.rsi?.period) || 14;
      const oversold = parseFloat(parameters.oversold) || parseFloat(parameters.rsi?.oversold) || 30;
      const overbought = parseFloat(parameters.overbought) || parseFloat(parameters.rsi?.overbought) || 70;
      const useReversal = parameters.useReversal !== undefined ? Boolean(parameters.useReversal) : 
                          (parameters.rsi?.useReversal !== undefined ? Boolean(parameters.rsi?.useReversal) : true);
      
      console.log('Using RSI parameters:', { period, oversold, overbought, useReversal });
      const investment = parseFloat(String(parameters.investment)) || 1000;
      
      // Extract risk management parameters with proper frontend names first, then fallbacks
      const positionSize = parseFloat(String(parameters.positionSize)) || parseFloat(String(parameters.tradeSize)) || 0.1;
      // Always use leverage = 1 (leverage feature removed)
      const leverage = 1;
      const stopLossPercent = parseFloat(String(parameters.stopLossPercent)) || parseFloat(String(parameters.stopLoss)) || 5;
      const takeProfitPercent = parseFloat(String(parameters.takeProfitPercent)) || parseFloat(String(parameters.takeProfit)) || 10;
      
      console.log('RSI risk parameters:', { positionSize, stopLossPercent, takeProfitPercent });
      
      // Initialize variables
      const trades: BacktestTrade[] = [];
      const equity: number[] = [investment];
      const timestamps: number[] = [candles[0].timestamp];
      
      let availableFunds = investment;
      let inPosition = false;
      let entryPrice = 0;
      let positionDirection: 'buy' | 'sell' = 'buy';
      let positionSize_units = 0;
      let currentPositionId = 1;
      
      // Calculate RSI
      const rsi = this.calculateRsi(candles, period);
      
      // Loop through each candle (skipping the initial ones needed for indicators)
      for (let i = period + 1; i < candles.length; i++) {
        const candle = candles[i];
        const prevCandle = candles[i - 1];
        
        // Check for stop-loss or take-profit on existing position
        if (inPosition) {
          // Calculate current position value
          const currentPrice = candle.close;
          const positionValue = positionSize_units * currentPrice;
          const percentChange = positionDirection === 'buy'
            ? ((currentPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - currentPrice) / entryPrice) * 100;
          
          // Check stop-loss
          if (percentChange <= -stopLossPercent) {
            // Stop loss hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += positionValue;
            inPosition = false;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
          }
          // Check take-profit
          else if (percentChange >= takeProfitPercent) {
            // Take profit hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += positionValue;
            inPosition = false;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
          }
        }
        
        // Strategy logic
        if (!inPosition) {
          // Buy signal: RSI crosses above oversold level
          if (rsi[i - 1] <= oversold && rsi[i] > oversold) {
            // Calculate position size
            const price = candle.close;
            const positionValue = availableFunds * positionSize;
            positionSize_units = positionValue / price;
            
            // Enter long position
            entryPrice = price;
            availableFunds -= positionValue;
            inPosition = true;
            positionDirection = 'buy';
            
            // Update equity curve
            equity.push(availableFunds + positionSize_units * price);
            timestamps.push(candle.timestamp);
          }
          // Sell signal: RSI crosses below overbought level
          else if (rsi[i - 1] >= overbought && rsi[i] < overbought) {
            // Calculate position size
            const price = candle.close;
            const positionValue = availableFunds * positionSize;
            positionSize_units = positionValue / price;
            
            // Enter short position
            entryPrice = price;
            availableFunds -= positionValue;
            inPosition = true;
            positionDirection = 'sell';
            
            // Update equity curve
            equity.push(availableFunds + positionSize_units * price);
            timestamps.push(candle.timestamp);
          }
        }
      }
      
      // Close any open position at the end of the backtest
      if (inPosition) {
        const lastCandle = candles[candles.length - 1];
        const currentPrice = lastCandle.close;
        const percentChange = positionDirection === 'buy'
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;
        
        const profit = positionDirection === 'buy'
          ? positionSize_units * (currentPrice - entryPrice)
          : positionSize_units * (entryPrice - currentPrice);
        
        // Record the trade
        trades.push({
          id: currentPositionId,
          timestamp: lastCandle.timestamp,
          entryPrice,
          exitPrice: currentPrice,
          amount: positionSize_units,
          profit,
          profitPercentage: percentChange,
          side: positionDirection,
          duration: lastCandle.timestamp - timestamps[timestamps.length - 1]
        });
        
        // Update funds
        availableFunds += positionSize_units * currentPrice;
        
        // Update equity curve
        equity.push(availableFunds);
        timestamps.push(lastCandle.timestamp);
      }
      
      // Calculate backtest metrics
      const metrics = this.calculateMetrics(trades, investment, equity);
      
      return {
        tradingPair: '',  // Will be set by the caller
        profit: availableFunds - investment,
        profitPercentage: ((availableFunds - investment) / investment) * 100,
        trades,
        metrics,
        equity,
        timestamps
      };
    } catch (error) {
      console.error('Error running RSI strategy:', error);
      throw error;
    }
  }
  
  /**
   * Implementation of Grid Trading strategy
   */
  private async runGridStrategy(
    candles: Candle[],
    parameters: any
  ): Promise<BacktestResult> {
    try {
      // Extract parameters with defaults - support both new and old parameter format
      const gridLevels = parseInt(String(parameters.gridLevels)) || parseInt(String(parameters.grid?.levels)) || 5;
      const gridSpacing = parseFloat(String(parameters.gridSpacing)) || parseFloat(String(parameters.grid?.spacing)) || 2; // % between grid levels
      const investment = parseFloat(String(parameters.investment)) || 1000;
      
      // Extract risk management parameters with proper frontend names first, then fallbacks
      const positionSize = parseFloat(String(parameters.positionSize)) || parseFloat(String(parameters.tradeSize)) || 0.1;
      // Always use leverage = 1 (leverage feature removed)
      const leverage = 1;
      // Grid trading can use stop loss and take profit
      const stopLossPercent = parseFloat(String(parameters.stopLossPercent)) || 0.03;
      const takeProfitPercent = parseFloat(String(parameters.takeProfitPercent)) || 0.05;
      
      // Get upper and lower price limits (0 means auto-calculate)
      const upperPriceParam = parseFloat(String(parameters.upperPrice)) || 0;
      const lowerPriceParam = parseFloat(String(parameters.lowerPrice)) || 0;
      
      // Calculate price range for grid
      const startCandle = candles[0];
      const startPrice = startCandle.close;
      
      // Get the price range for the last 30 days (or all available data if less)
      const priceHistory = candles.slice(0, Math.min(candles.length, 30 * 24)); // Assuming hourly candles
      const highestPrice = Math.max(...priceHistory.map(c => c.high));
      const lowestPrice = Math.min(...priceHistory.map(c => c.low));
      const priceRange = highestPrice - lowestPrice;
      
      // Calculate dynamic upper and lower prices if not specified
      const upperPrice = upperPriceParam > 0 ? upperPriceParam : startPrice + (priceRange * 0.5);
      const lowerPrice = lowerPriceParam > 0 ? lowerPriceParam : startPrice - (priceRange * 0.5);
      
      console.log('Grid strategy parameters:', { 
        gridLevels, 
        gridSpacing, 
        investment, 
        positionSize,
        upperPrice,
        lowerPrice,
        stopLossPercent,
        takeProfitPercent
      });
      
      // Initialize variables
      const trades: BacktestTrade[] = [];
      const equity: number[] = [investment];
      const timestamps: number[] = [candles[0].timestamp];
      
      let availableFunds = investment;
      let currentPositionId = 1;
      
      // Calculate grid levels evenly distributed between lower and upper price
      const levels: { price: number, active: boolean, stopLoss: number, takeProfit: number }[] = [];
      const priceStep = (upperPrice - lowerPrice) / (gridLevels - 1);
      
      // Create grid levels
      for (let i = 0; i < gridLevels; i++) {
        const levelPrice = lowerPrice + (i * priceStep);
        levels.push({
          price: levelPrice,
          active: false,
          stopLoss: levelPrice * (1 - stopLossPercent),
          takeProfit: levelPrice * (1 + takeProfitPercent)
        });
      }
      
      // Calculate amount per grid level - apply position size
      const fundsPerGrid = investment * positionSize / gridLevels;
      const unitsPerGrid = fundsPerGrid / startPrice;
      
      // Loop through each candle
      for (let i = 1; i < candles.length; i++) {
        const candle = candles[i];
        const currentPrice = candle.close;
        
        // Check each grid level for potential trades
        for (let j = 0; j < levels.length - 1; j++) {
          const lowerLevel = levels[j];
          const upperLevel = levels[j + 1];
          
          // Buy at lower level if price crosses below it
          if (candle.low <= lowerLevel.price && !lowerLevel.active) {
            // Buy at this level
            lowerLevel.active = true;
            
            // Calculate trade details
            const entryPrice = lowerLevel.price;
            const amount = unitsPerGrid;
            
            // Update funds
            availableFunds -= fundsPerGrid;
            
            // Record entry in equity curve
            equity.push(equity[equity.length - 1]);
            timestamps.push(candle.timestamp);
          }
          
          // Check for stop loss hits for active positions
          if (lowerLevel.active && candle.low <= lowerLevel.stopLoss) {
            // Execute stop loss
            lowerLevel.active = false;
            
            // Calculate trade details
            const entryPrice = lowerLevel.price;
            const exitPrice = lowerLevel.stopLoss; // Use stop loss price
            const amount = unitsPerGrid;
            const profit = amount * (exitPrice - entryPrice);
            const profitPercentage = ((exitPrice - entryPrice) / entryPrice) * 100;
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice,
              amount,
              profit,
              profitPercentage,
              side: 'buy',
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += fundsPerGrid + profit;
            
            // Update equity curve
            equity.push(availableFunds + levels.reduce((sum, level) => 
              level.active ? sum + unitsPerGrid * currentPrice : sum, 0
            ));
            timestamps.push(candle.timestamp);
            
            // Skip to next level since this one is no longer active
            continue;
          }
          
          // Check for take profit hits for active positions
          if (lowerLevel.active && candle.high >= lowerLevel.takeProfit) {
            // Execute take profit
            lowerLevel.active = false;
            
            // Calculate trade details
            const entryPrice = lowerLevel.price;
            const exitPrice = lowerLevel.takeProfit; // Use take profit price
            const amount = unitsPerGrid;
            const profit = amount * (exitPrice - entryPrice);
            const profitPercentage = ((exitPrice - entryPrice) / entryPrice) * 100;
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice,
              amount,
              profit,
              profitPercentage,
              side: 'buy',
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += fundsPerGrid + profit;
            
            // Update equity curve
            equity.push(availableFunds + levels.reduce((sum, level) => 
              level.active ? sum + unitsPerGrid * currentPrice : sum, 0
            ));
            timestamps.push(candle.timestamp);
            
            // Skip to next level since this one is no longer active
            continue;
          }
          
          // Regular grid strategy sell at upper level if price crosses above it and we have an active lower level
          if (candle.high >= upperLevel.price && lowerLevel.active) {
            // Sell at this level
            lowerLevel.active = false;
            
            // Calculate trade details
            const entryPrice = lowerLevel.price;
            const exitPrice = upperLevel.price;
            const amount = unitsPerGrid;
            const profit = amount * (exitPrice - entryPrice);
            const profitPercentage = ((exitPrice - entryPrice) / entryPrice) * 100;
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice,
              amount,
              profit,
              profitPercentage,
              side: 'buy',
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += fundsPerGrid + profit;
            
            // Update equity curve
            equity.push(availableFunds + levels.reduce((sum, level) => 
              level.active ? sum + unitsPerGrid * currentPrice : sum, 0
            ));
            timestamps.push(candle.timestamp);
          }
        }
      }
      
      // Close any open positions at the end of the backtest
      const lastCandle = candles[candles.length - 1];
      const finalPrice = lastCandle.close;
      
      for (let j = 0; j < levels.length; j++) {
        const level = levels[j];
        
        if (level.active) {
          // Calculate trade details
          const entryPrice = level.price;
          const exitPrice = finalPrice;
          const amount = unitsPerGrid;
          const profit = amount * (exitPrice - entryPrice);
          const profitPercentage = ((exitPrice - entryPrice) / entryPrice) * 100;
          
          // Record the trade
          trades.push({
            id: currentPositionId++,
            timestamp: lastCandle.timestamp,
            entryPrice,
            exitPrice,
            amount,
            profit,
            profitPercentage,
            side: 'buy',
            duration: lastCandle.timestamp - timestamps[timestamps.length - 1]
          });
          
          // Update funds
          availableFunds += fundsPerGrid + profit;
          
          // Reset level
          level.active = false;
        }
      }
      
      // Update final equity
      equity.push(availableFunds);
      timestamps.push(lastCandle.timestamp);
      
      // Calculate backtest metrics
      const metrics = this.calculateMetrics(trades, investment, equity);
      
      return {
        tradingPair: '',  // Will be set by the caller
        profit: availableFunds - investment,
        profitPercentage: ((availableFunds - investment) / investment) * 100,
        trades,
        metrics,
        equity,
        timestamps
      };
    } catch (error) {
      console.error('Error running Grid strategy:', error);
      throw error;
    }
  }
  
  /**
   * Implementation of DCA (Dollar Cost Averaging) strategy
   */
  private async runDcaStrategy(
    candles: Candle[],
    parameters: any
  ): Promise<BacktestResult> {
    try {
      // Extract parameters with defaults - support both new and old parameter format
      const interval = parseInt(String(parameters.interval)) || parseInt(String(parameters.dca?.interval)) || 7; // Days between purchases
      const targetPercent = parseFloat(String(parameters.targetPercent)) || parseFloat(String(parameters.dca?.target)) || 10; // Target profit percentage
      const investment = parseFloat(String(parameters.investment)) || 1000;
      const initialBuyAmount = parseFloat(String(parameters.initialBuyAmount)) || parseFloat(String(parameters.dca?.initialBuy)) || 0.25; // Initial buy as % of total investment
      const dcaAmount = parseFloat(String(parameters.dcaAmount)) || parseFloat(String(parameters.dca?.amount)) || 0.1; // DCA amount as % of total investment
      const maxDcaCount = parseInt(String(parameters.maxDcaCount)) || parseInt(String(parameters.dca?.maxPurchases)) || 5; // Maximum number of DCA purchases

      // Extract risk management parameters with proper frontend names first, then fallbacks
      const stopLossPercent = parseFloat(String(parameters.stopLossPercent)) || parseFloat(String(parameters.stopLoss)) || 15; // Stop loss percentage
      const takeProfitPercent = parseFloat(String(parameters.takeProfitPercent)) || parseFloat(String(parameters.takeProfit)) || targetPercent; // Use target percent as default take profit if not set
      const positionSize = parseFloat(String(parameters.positionSize)) || parseFloat(String(parameters.tradeSize)) || 1.0; // In DCA, usually 100% of funds are used
      
      console.log('DCA strategy parameters:', { interval, targetPercent, stopLossPercent, takeProfitPercent, investment, initialBuyAmount, dcaAmount, maxDcaCount, positionSize });
      
      // New DCA multiplier level parameters
      const useMultiplierLevels = parameters.dca?.useMultiplierLevels || false;
      const multiplier = parameters.dca?.multiplier || 1.5;
      
      // Trend analysis parameters
      const useTrendFilter = parameters.dca?.useTrendFilter || false;
      const trendIndicator = parameters.dca?.trendIndicator || 'ema';
      const trendPeriod = parameters.dca?.trendPeriod || 20;
      const trendDirection = parameters.dca?.trendDirection || 'up';
      
      // Advanced dynamic DCA options
      const usePriceDropMethod = parameters.dca?.usePriceDropMethod || false;
      const priceDropThresholds = parameters.dca?.priceDropThresholds || [5, 10, 15, 20];
      const priceDropMultipliers = parameters.dca?.priceDropMultipliers || [1, 1.5, 2, 2.5, 3];
      
      const useMovingAverageMethod = parameters.dca?.useMovingAverageMethod || false;
      const maMethod = parameters.dca?.maMethod || 'ema';
      const maPeriod = parameters.dca?.maPeriod || 20;
      const maDeviationThresholds = parameters.dca?.maDeviationThresholds || [2, 5, 10];
      const maDeviationMultipliers = parameters.dca?.maDeviationMultipliers || [0.5, 1, 2, 3];
      
      const useVolatilityMethod = parameters.dca?.useVolatilityMethod || false;
      const atrPeriod = parameters.dca?.atrPeriod || 14;
      const atrMultiplier = parameters.dca?.atrMultiplier || 1.5;
      
      // Initialize variables
      const trades: BacktestTrade[] = [];
      const equity: number[] = [investment];
      const timestamps: number[] = [candles[0].timestamp];
      
      let availableFunds = investment;
      let inPosition = false;
      let averageEntryPrice = 0;
      let totalInvested = 0;
      let totalUnits = 0;
      let lastDcaCandle = -1;
      let dcaCount = 0;
      let currentPositionId = 1;
      
      console.log(`Running DCA strategy with interval: ${interval} days, target: ${targetPercent}%, stop loss: ${stopLossPercent}%`);
      console.log(`Multiplier levels: ${useMultiplierLevels ? 'enabled' : 'disabled'}, multiplier: ${multiplier}`);
      console.log(`Trend filter: ${useTrendFilter ? 'enabled' : 'disabled'}, indicator: ${trendIndicator}, period: ${trendPeriod}, direction: ${trendDirection}`);
      
      // Convert interval to number of candles
      const intervalCandles = this.getDcaIntervalCandles(candles, interval);
      
      // Calculate trend indicators if needed
      let emaValues: number[] = [];
      let smaValues: number[] = [];
      let macdValues: { macd: number[], signal: number[], histogram: number[] } = { macd: [], signal: [], histogram: [] };
      
      if (useTrendFilter) {
        const prices = candles.map(c => c.close);
        
        if (trendIndicator === 'ema') {
          emaValues = this.calculateEma(prices, trendPeriod);
        } else if (trendIndicator === 'sma') {
          // Calculate SMA
          smaValues = Array(trendPeriod - 1).fill(0);
          for (let i = trendPeriod - 1; i < prices.length; i++) {
            let sum = 0;
            for (let j = 0; j < trendPeriod; j++) {
              sum += prices[i - j];
            }
            smaValues.push(sum / trendPeriod);
          }
        } else if (trendIndicator === 'macd') {
          macdValues = this.calculateMacd(candles, 12, 26, 9);
        }
      }
      
      // Function to check if the current trend matches the required direction
      const isTrendMatching = (index: number): boolean => {
        if (!useTrendFilter || index < trendPeriod) return true;
        
        if (trendIndicator === 'ema') {
          const currentPrice = candles[index].close;
          const currentEma = emaValues[index];
          
          if (trendDirection === 'up') return currentPrice > currentEma;
          if (trendDirection === 'down') return currentPrice < currentEma;
          return true; // 'any' direction
        } 
        else if (trendIndicator === 'sma') {
          const currentPrice = candles[index].close;
          const currentSma = smaValues[index];
          
          if (trendDirection === 'up') return currentPrice > currentSma;
          if (trendDirection === 'down') return currentPrice < currentSma;
          return true; // 'any' direction
        } 
        else if (trendIndicator === 'macd') {
          // MACD trend is determined by histogram direction
          if (index < 1) return true;
          const currentHistogram = macdValues.histogram[index];
          const prevHistogram = macdValues.histogram[index - 1];
          
          if (trendDirection === 'up') return currentHistogram > prevHistogram;
          if (trendDirection === 'down') return currentHistogram < prevHistogram;
          return true; // 'any' direction
        }
        
        return true;
      };
      
      // Loop through each candle
      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const currentPrice = candle.close;
        
        // Check if we should exit the position
        if (inPosition) {
          const percentChange = ((currentPrice - averageEntryPrice) / averageEntryPrice) * 100;
          
          // Take profit if target reached
          if (percentChange >= targetPercent) {
            // Calculate profit
            const exitValue = totalUnits * currentPrice;
            const profit = exitValue - totalInvested;
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice: averageEntryPrice,
              exitPrice: currentPrice,
              amount: totalUnits,
              profit,
              profitPercentage: percentChange,
              side: 'buy',
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += exitValue;
            
            // Reset position
            inPosition = false;
            totalInvested = 0;
            totalUnits = 0;
            lastDcaCandle = -1;
            dcaCount = 0;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
            
            console.log(`TAKE PROFIT at ${currentPrice}: ${percentChange.toFixed(2)}% profit, total: $${profit.toFixed(2)}`);
          }
          // Stop loss if threshold exceeded
          else if (percentChange <= -stopLossPercent) {
            // Calculate loss
            const exitValue = totalUnits * currentPrice;
            const profit = exitValue - totalInvested;
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice: averageEntryPrice,
              exitPrice: currentPrice,
              amount: totalUnits,
              profit,
              profitPercentage: percentChange,
              side: 'buy',
              duration: candle.timestamp - timestamps[timestamps.length - 1]
            });
            
            // Update funds
            availableFunds += exitValue;
            
            // Reset position
            inPosition = false;
            totalInvested = 0;
            totalUnits = 0;
            lastDcaCandle = -1;
            dcaCount = 0;
            
            // Update equity curve
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
            
            console.log(`STOP LOSS at ${currentPrice}: ${percentChange.toFixed(2)}% loss, total: $${profit.toFixed(2)}`);
          }
          // Check if it's time for another DCA and we haven't reached max DCA count
          else if (i - lastDcaCandle >= intervalCandles && dcaCount < maxDcaCount) {
            // Only DCA if trend conditions are met
            if (isTrendMatching(i)) {
              // Calculate DCA amount using selected method(s)
              let dcaMultiplier = 1;
              let methodUsed = "standard";
              
              // 1. Apply basic multiplier levels if enabled
              if (useMultiplierLevels) {
                dcaMultiplier = Math.pow(multiplier, dcaCount);
                console.log(`Using DCA level multiplier: Level ${dcaCount}, Multiplier: ${dcaMultiplier.toFixed(2)}`);
                methodUsed = "multiplier levels";
              }
              
              // 2. Price drop based method
              if (usePriceDropMethod) {
                const priceDropPercent = Math.abs(Math.min(0, percentChange));
                let priceDropMultiplier = priceDropMultipliers[0]; // Default to first level
                
                // Find which threshold we're in
                for (let i = 0; i < priceDropThresholds.length; i++) {
                  if (priceDropPercent >= priceDropThresholds[i]) {
                    priceDropMultiplier = priceDropMultipliers[i + 1];
                  }
                }
                
                dcaMultiplier = priceDropMultiplier;
                console.log(`Using price drop multiplier: ${priceDropPercent.toFixed(2)}% drop, Multiplier: ${dcaMultiplier.toFixed(2)}`);
                methodUsed = "price drop";
              }
              
              // 3. Moving average deviation method
              if (useMovingAverageMethod && i >= maPeriod) {
                const prices = candles.slice(0, i + 1).map(c => c.close);
                let maValue = 0;
                
                // Calculate MA
                if (maMethod === 'ema') {
                  const ema = this.calculateEma(prices, maPeriod);
                  maValue = ema[ema.length - 1];
                } else {
                  // SMA
                  let sum = 0;
                  for (let j = i - maPeriod + 1; j <= i; j++) {
                    sum += candles[j].close;
                  }
                  maValue = sum / maPeriod;
                }
                
                // Calculate deviation percentage
                const currentPrice = candles[i].close;
                const deviationPercent = ((maValue - currentPrice) / maValue) * 100;
                
                if (deviationPercent > 0) {
                  // Only increase multiplier when price is below MA
                  let maDeviationMultiplier = maDeviationMultipliers[0];
                  
                  // Find which threshold we're in
                  for (let i = 0; i < maDeviationThresholds.length; i++) {
                    if (deviationPercent >= maDeviationThresholds[i]) {
                      maDeviationMultiplier = maDeviationMultipliers[i + 1];
                    }
                  }
                  
                  dcaMultiplier = maDeviationMultiplier;
                  console.log(`Using MA deviation multiplier: ${deviationPercent.toFixed(2)}% below MA, Multiplier: ${dcaMultiplier.toFixed(2)}`);
                  methodUsed = "MA deviation";
                }
              }
              
              // 4. Volatility-based method (ATR)
              if (useVolatilityMethod && i >= atrPeriod) {
                // Calculate ATR
                let atr = 0;
                let trSum = 0;
                
                for (let j = i - atrPeriod + 1; j <= i; j++) {
                  const candle = candles[j];
                  const prevCandle = candles[j - 1];
                  
                  const tr1 = candle.high - candle.low;
                  const tr2 = Math.abs(candle.high - prevCandle.close);
                  const tr3 = Math.abs(candle.low - prevCandle.close);
                  
                  const tr = Math.max(tr1, tr2, tr3);
                  trSum += tr;
                }
                
                atr = trSum / atrPeriod;
                
                // Calculate ATR as percentage of price
                const atrPercent = (atr / currentPrice) * 100;
                
                // Calculate ATR multiplier based on volatility
                // More volatile = higher multiplier to buy more during volatile drops
                const volatilityMultiplier = Math.min(3, Math.max(0.5, atrPercent * atrMultiplier));
                
                dcaMultiplier = volatilityMultiplier;
                console.log(`Using volatility multiplier: ATR: ${atrPercent.toFixed(2)}%, Multiplier: ${dcaMultiplier.toFixed(2)}`);
                methodUsed = "volatility";
              }
              
              // Use basic price drop factor as fallback
              const priceDropFactor = Math.max(1, Math.abs(Math.min(0, percentChange)) / 5);
              
              // Calculate final DCA value
              const dcaValue = investment * dcaAmount * priceDropFactor * dcaMultiplier;
              console.log(`DCA calculation using ${methodUsed} method: Base: $${(investment * dcaAmount).toFixed(2)}, Final: $${dcaValue.toFixed(2)}`);
              
              
              // Only DCA if we have enough funds
              if (availableFunds >= dcaValue) {
                // Buy more at current price
                const additionalUnits = dcaValue / currentPrice;
                
                // Update average entry price and totals
                totalInvested += dcaValue;
                totalUnits += additionalUnits;
                averageEntryPrice = totalInvested / totalUnits;
                
                // Update funds
                availableFunds -= dcaValue;
                
                // Update last DCA time and count
                lastDcaCandle = i;
                dcaCount++;
                
                // Update equity curve
                equity.push(availableFunds + totalUnits * currentPrice);
                timestamps.push(candle.timestamp);
                
                console.log(`DCA #${dcaCount} at ${currentPrice}: bought ${additionalUnits.toFixed(4)} units for $${dcaValue.toFixed(2)}`);
              }
            } else {
              console.log(`Skipping DCA - trend conditions not met at price ${currentPrice}`);
            }
          }
        }
        // Check if we should enter a position - more lenient entry conditions
        else if (i >= 5) {
          // Allow entry on various conditions
          const last5Candles = candles.slice(i-5, i+1);
          const highPrice = Math.max(...last5Candles.map(c => c.high));
          const priceDropPercent = ((highPrice - currentPrice) / highPrice) * 100;
          
          // Check if trend conditions are met
          const trendConditionMet = isTrendMatching(i);
          
          // Enter on any small drop or periodically, respecting trend conditions if enabled
          if ((priceDropPercent > 1 || i % 10 === 0) && (!useTrendFilter || trendConditionMet)) {
            // Initial buy
            const initialBuyValue = investment * initialBuyAmount;
            const units = initialBuyValue / currentPrice;
            
            // Enter position
            inPosition = true;
            averageEntryPrice = currentPrice;
            totalInvested = initialBuyValue;
            totalUnits = units;
            lastDcaCandle = i;
            dcaCount = 0;
            
            // Update funds
            availableFunds -= initialBuyValue;
            
            // Update equity curve
            equity.push(availableFunds + totalUnits * currentPrice);
            timestamps.push(candle.timestamp);
            
            console.log(`ENTRY at ${currentPrice}: bought ${units.toFixed(4)} units for $${initialBuyValue.toFixed(2)}`);
          }
        }
      }
      
      // Close any open position at the end of the backtest
      if (inPosition) {
        const lastCandle = candles[candles.length - 1];
        const finalPrice = lastCandle.close;
        
        // Calculate profit
        const exitValue = totalUnits * finalPrice;
        const profit = exitValue - totalInvested;
        const percentChange = ((finalPrice - averageEntryPrice) / averageEntryPrice) * 100;
        
        console.log(`FINAL EXIT at ${finalPrice}: ${percentChange.toFixed(2)}% ${percentChange >= 0 ? 'profit' : 'loss'}, total: $${profit.toFixed(2)}`);
        
        // Record the trade
        trades.push({
          id: currentPositionId,
          timestamp: lastCandle.timestamp,
          entryPrice: averageEntryPrice,
          exitPrice: finalPrice,
          amount: totalUnits,
          profit,
          profitPercentage: percentChange,
          side: 'buy',
          duration: lastCandle.timestamp - timestamps[timestamps.length - 1]
        });
        
        // Update funds
        availableFunds += exitValue;
        
        // Update equity curve
        equity.push(availableFunds);
        timestamps.push(lastCandle.timestamp);
      }
      
      // Calculate backtest metrics
      const metrics = this.calculateMetrics(trades, investment, equity);
      
      return {
        tradingPair: '',  // Will be set by the caller
        profit: availableFunds - investment,
        profitPercentage: ((availableFunds - investment) / investment) * 100,
        trades,
        metrics,
        equity,
        timestamps
      };
    } catch (error) {
      console.error('Error running DCA strategy:', error);
      throw error;
    }
  }
  
  /**
   * Calculate number of candles for DCA interval
   */
  private getDcaIntervalCandles(candles: Candle[], intervalDays: number): number {
    if (candles.length < 2) return 1;
    
    // Calculate average time between candles
    const candleMs = candles[1].timestamp - candles[0].timestamp;
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Convert interval days to number of candles
    return Math.ceil((intervalDays * dayMs) / candleMs);
  }
  
  /**
   * Calculate backtest metrics from trade history
   * @param trades List of trades
   * @param initialInvestment Initial investment amount
   * @param equity Equity curve
   * @returns Backtest metrics
   */
  private calculateMetrics(
    trades: BacktestTrade[],
    initialInvestment: number,
    equity: number[]
  ): BacktestMetrics {
    // Initialize metrics
    const metrics: BacktestMetrics = {
      totalTrades: trades.length,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      averageProfit: 0,
      averageLoss: 0,
      largestProfit: 0,
      largestLoss: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0
    };
    
    // No trades, return empty metrics
    if (trades.length === 0) {
      return metrics;
    }
    
    // Calculate basic metrics
    let totalProfit = 0;
    let totalLoss = 0;
    let winCount = 0;
    let lossCount = 0;
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    
    // Sanitize trades to ensure no NaN values
    const sanitizedTrades = trades.map(trade => {
      // Ensure profit and profitPercentage are valid numbers
      if (isNaN(trade.profit)) trade.profit = 0;
      if (isNaN(trade.profitPercentage)) trade.profitPercentage = 0;
      return trade;
    });
    
    // Debug log all trades
    console.log('Analyzing trade profitability:');
    
    sanitizedTrades.forEach(trade => {
      // Log each trade for debugging
      console.log(`Trade: Entry=${trade.entryPrice}, Exit=${trade.exitPrice}, Side=${trade.side}, Profit=${trade.profit}, ProfitPct=${trade.profitPercentage}%`);
      
      // Check if trade is profitable (ensure comparison is valid)
      const isProfitable = trade.profitPercentage > 0;
      
      if (isProfitable) {
        // Use safe number for calculations
        const safeProfit = isNaN(trade.profit) ? 0 : trade.profit;
        totalProfit += safeProfit;
        winCount++;
        consecutiveWins++;
        consecutiveLosses = 0;
        
        if (safeProfit > metrics.largestProfit) {
          metrics.largestProfit = safeProfit;
        }
        
        if (consecutiveWins > maxConsecutiveWins) {
          maxConsecutiveWins = consecutiveWins;
        }
      } else {
        // Use safe number for calculations
        const safeProfit = isNaN(trade.profit) ? 0 : trade.profit;
        totalLoss += Math.abs(safeProfit);
        lossCount++;
        consecutiveLosses++;
        consecutiveWins = 0;
        
        if (Math.abs(safeProfit) > metrics.largestLoss) {
          metrics.largestLoss = Math.abs(safeProfit);
        }
        
        if (consecutiveLosses > maxConsecutiveLosses) {
          maxConsecutiveLosses = consecutiveLosses;
        }
      }
    });
    
    console.log(`Total Trades: ${trades.length}, Winners: ${winCount}, Losers: ${lossCount}`);
    
    // Calculate win rate (avoid division by zero)
    metrics.winningTrades = winCount;
    metrics.losingTrades = lossCount;
    metrics.winRate = trades.length > 0 ? (winCount / trades.length) * 100 : 0;
    
    // Calculate average profit/loss (avoid NaN)
    metrics.averageProfit = winCount > 0 ? totalProfit / winCount : 0;
    metrics.averageLoss = lossCount > 0 ? totalLoss / lossCount : 0;
    
    // Calculate profit factor (avoid division by zero and NaN)
    metrics.profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
    
    // Calculate max drawdown (with safeguards for NaN values)
    let peak = isNaN(equity[0]) ? 0 : equity[0];
    let maxDrawdown = 0;
    
    for (const rawValue of equity) {
      // Ensure value is a valid number
      const value = isNaN(rawValue) ? 0 : rawValue;
      
      if (value > peak) {
        peak = value;
      } else if (peak > 0) { // Avoid division by zero
        const drawdown = ((peak - value) / peak) * 100;
        if (!isNaN(drawdown) && drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }
    
    metrics.maxDrawdown = maxDrawdown;
    
    // Calculate Sharpe Ratio (simplified) with safeguards for NaN
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      // Ensure both values are valid numbers and avoid division by zero
      if (!isNaN(equity[i]) && !isNaN(equity[i-1]) && equity[i-1] !== 0) {
        returns.push((equity[i] - equity[i-1]) / equity[i-1]);
      } else {
        returns.push(0); // Default to zero return if invalid numbers
      }
    }
    
    // Avoid division by zero if returns array is empty
    const meanReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    
    // Avoid square root of negative number
    const sumSquaredDiff = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0);
    const variance = returns.length > 0 ? sumSquaredDiff / returns.length : 0;
    const stdDev = Math.sqrt(Math.max(0, variance)); // Ensure we don't try to sqrt a negative number
    
    // Final calculation with division by zero protection
    metrics.sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;
    
    // Set consecutive win/loss records
    metrics.maxConsecutiveWins = maxConsecutiveWins;
    metrics.maxConsecutiveLosses = maxConsecutiveLosses;
    
    return metrics;
  }
  
  /**
   * Calculate Bollinger Bands
   * @param candles Historical OHLCV data
   * @param period SMA period
   * @param deviation Standard deviation multiplier
   * @returns Bollinger Bands (SMA, upper band, lower band)
   */
  /**
   * Run Moving Average Crossover strategy backtest
   * @param candles Historical price data
   * @param parameters Strategy parameters
   * @returns Backtest result
   */
  private async runMovingAverageCrossoverStrategy(
    candles: Candle[],
    parameters: any
  ): Promise<BacktestResult> {
    try {
      // Support both flat parameters and nested parameters for each strategy type
      // For SMA/EMA specific strategies
      let period = parameters.period;
      if (!period && parameters.sma?.period) period = parameters.sma.period;
      if (!period && parameters.ema?.period) period = parameters.ema.period;
      if (!period && parameters.ma?.period) period = parameters.ma.period;
      
      // For MA crossover strategies
      let shortPeriod = parameters.shortPeriod || parameters.fastPeriod;
      if (!shortPeriod && parameters.ma?.shortPeriod) shortPeriod = parameters.ma.shortPeriod;
      if (!shortPeriod && parameters.ma?.fastPeriod) shortPeriod = parameters.ma.fastPeriod;
      
      let longPeriod = parameters.longPeriod || parameters.slowPeriod;
      if (!longPeriod && parameters.ma?.longPeriod) longPeriod = parameters.ma.longPeriod;
      if (!longPeriod && parameters.ma?.slowPeriod) longPeriod = parameters.ma.slowPeriod;
      
      // For a single MA strategy (SMA/EMA), use the period for shortPeriod
      // and a suitable multiple (2-3x) for longPeriod
      if (period && !shortPeriod) {
        shortPeriod = period;
        longPeriod = period * 2.5; // Default to 2.5x for the long period
      }
      
      // Convert to proper types and apply defaults
      shortPeriod = parseInt(String(shortPeriod)) || 9;
      longPeriod = parseInt(String(longPeriod)) || 21;
      
      // Determine MA type (SMA/EMA)
      let maType = parameters.maType || parameters.type || parameters.ma?.type || 'sma';
      
      // If this is a strategy-specific call, override the maType
      if (parameters.strategy === 'sma') {
        maType = 'sma';
      } else if (parameters.strategy === 'ema') {
        maType = 'ema';
      }
      
      // Debug the parameters object to see what's being passed
      console.log('Raw parameters object:', parameters);
      console.log('Parameters.investment value:', parameters.investment, 'type:', typeof parameters.investment);
      console.log('Parameters.initialInvestment value:', parameters.initialInvestment, 'type:', typeof parameters.initialInvestment);
      
      // Try to get investment from multiple possible sources with explicit logging
      let investment = 1000; // Default
      if (parameters.investment !== undefined) {
        investment = parseFloat(String(parameters.investment));
        console.log('Using parameters.investment:', investment);
      } else if (parameters.initialInvestment !== undefined) {
        investment = parseFloat(String(parameters.initialInvestment));
        console.log('Using parameters.initialInvestment:', investment);
      } else {
        console.log('Using default investment value:', investment);
      }
      
      // Use the frontend parameter names directly
      const positionSize = parseFloat(String(parameters.positionSize)) || 0.1;
      // Always use leverage = 1 (leverage feature removed)
      const leverage = 1;
      const stopLossPercent = parseFloat(String(parameters.stopLossPercent)) || 5;
      const takeProfitPercent = parseFloat(String(parameters.takeProfitPercent)) || 10;
      
      console.log(`Using Moving Average ${maType.toUpperCase()} Crossover parameters:`, {
        shortPeriod,
        longPeriod,
        maType,
        investment,
        positionSize,
        leverage,
        stopLossPercent,
        takeProfitPercent
      });
      
      // Initialize variables
      const trades: BacktestTrade[] = [];
      const equity: number[] = [investment];
      const timestamps: number[] = [candles[0].timestamp];
      
      let availableFunds = investment;
      let inPosition = false;
      let entryPrice = 0;
      let positionDirection: 'buy' | 'sell' = 'buy';
      let positionSize_units = 0;
      let currentPositionId = 1;
      
      // Calculate the moving averages
      const shortMA = maType === 'ema' 
        ? this.calculateEMA(candles, shortPeriod)
        : this.calculateSMA(candles, shortPeriod);
        
      const longMA = maType === 'ema'
        ? this.calculateEMA(candles, longPeriod)
        : this.calculateSMA(candles, longPeriod);
      
      // Get the maximum period to ensure we have both MAs
      const maxPeriod = Math.max(shortPeriod, longPeriod);
      
      // Loop through each candle (skipping the initial ones needed for indicators)
      for (let i = maxPeriod; i < candles.length; i++) {
        const candle = candles[i];
        const prevCandle = candles[i - 1];
        
        // Check for stop-loss or take-profit on existing position
        if (inPosition) {
          // Calculate current position value
          const currentPrice = candle.close;
          const positionValue = positionSize_units * currentPrice;
          const percentChange = positionDirection === 'buy'
            ? ((currentPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - currentPrice) / entryPrice) * 100;
          
          // Check stop-loss
          if (percentChange < -stopLossPercent) {
            // Stop loss hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Exit the position
            availableFunds += positionValue;
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - trades[trades.length - 1]?.timestamp || 0
            });
            
            // Reset position
            inPosition = false;
            
            // Record equity point
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
            
            continue;
          }
          
          // Check take-profit
          if (percentChange > takeProfitPercent) {
            // Take profit hit
            const profit = positionDirection === 'buy'
              ? positionSize_units * (currentPrice - entryPrice)
              : positionSize_units * (entryPrice - currentPrice);
            
            // Exit the position
            availableFunds += positionValue;
            
            // Record the trade
            trades.push({
              id: currentPositionId++,
              timestamp: candle.timestamp,
              entryPrice,
              exitPrice: currentPrice,
              amount: positionSize_units,
              profit,
              profitPercentage: percentChange,
              side: positionDirection,
              duration: candle.timestamp - trades[trades.length - 1]?.timestamp || 0
            });
            
            // Reset position
            inPosition = false;
            
            // Record equity point
            equity.push(availableFunds);
            timestamps.push(candle.timestamp);
            
            continue;
          }
        }
        
        // Check for crossovers if we're not already in a position
        const prevShortMA = shortMA[i - 1];
        const prevLongMA = longMA[i - 1];
        const currentShortMA = shortMA[i];
        const currentLongMA = longMA[i];
        
        // Check for bullish crossover (short MA crosses above long MA)
        const bullishCross = prevShortMA <= prevLongMA && currentShortMA > currentLongMA;
        
        // Check for bearish crossover (short MA crosses below long MA)
        const bearishCross = prevShortMA >= prevLongMA && currentShortMA < currentLongMA;
        
        if (!inPosition) {
          // Look for entry signals
          if (bullishCross) {
            // Buy signal
            const currentPrice = candle.close;
            positionSize_units = (availableFunds * positionSize) / currentPrice;
            entryPrice = currentPrice;
            positionDirection = 'buy';
            inPosition = true;
            
            // Adjust available funds
            availableFunds -= positionSize_units * currentPrice;
            
            // Record entry
            console.log(`BUY signal at ${new Date(candle.timestamp).toLocaleString()}, price: ${currentPrice}, position: ${positionSize_units} units`);
          } else if (bearishCross) {
            // Sell signal (if we're allowing short positions)
            const currentPrice = candle.close;
            positionSize_units = (availableFunds * positionSize) / currentPrice;
            entryPrice = currentPrice;
            positionDirection = 'sell';
            inPosition = true;
            
            // Adjust available funds
            availableFunds -= positionSize_units * currentPrice;
            
            // Record entry
            console.log(`SELL signal at ${new Date(candle.timestamp).toLocaleString()}, price: ${currentPrice}, position: ${positionSize_units} units`);
          }
        }
        
        // Record equity point periodically (e.g., every 24 hours) or on last candle
        if (i === candles.length - 1 || i % 24 === 0) {
          // Calculate current portfolio value
          let portfolioValue = availableFunds;
          
          // Add value of open position if any
          if (inPosition) {
            const currentPrice = candle.close;
            const positionValue = positionDirection === 'buy'
              ? positionSize_units * currentPrice
              : positionSize_units * (2 * entryPrice - currentPrice); // For short positions
            
            portfolioValue += positionValue;
          }
          
          equity.push(portfolioValue);
          timestamps.push(candle.timestamp);
        }
      }
      
      // Close any open position at the end of the backtest
      if (inPosition) {
        const lastCandle = candles[candles.length - 1];
        const currentPrice = lastCandle.close;
        const percentChange = positionDirection === 'buy'
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;
        
        const profit = positionDirection === 'buy'
          ? positionSize_units * (currentPrice - entryPrice)
          : positionSize_units * (entryPrice - currentPrice);
        
        // Exit the position
        availableFunds += positionSize_units * currentPrice;
        
        // Record the trade
        trades.push({
          id: currentPositionId++,
          timestamp: lastCandle.timestamp,
          entryPrice,
          exitPrice: currentPrice,
          amount: positionSize_units,
          profit,
          profitPercentage: percentChange,
          side: positionDirection,
          duration: lastCandle.timestamp - trades[trades.length - 1]?.timestamp || 0
        });
        
        // Reset position
        inPosition = false;
        
        // Record final equity point
        equity.push(availableFunds);
        timestamps.push(lastCandle.timestamp);
      }
      
      // Calculate total profit/loss
      const totalProfit = availableFunds - investment;
      const profitPercentage = (totalProfit / investment) * 100;
      
      // Log trade summary
      console.log('Analyzing trade profitability:');
      trades.forEach(trade => {
        console.log(`Trade: Entry=${trade.entryPrice.toFixed(2)}, Exit=${trade.exitPrice.toFixed(2)}, Side=${trade.side}, Profit=${trade.profit}, ProfitPct=${trade.profitPercentage}%`);
      });
      console.log(`Total Trades: ${trades.length}, Winners: ${trades.filter(t => t.profit > 0).length}, Losers: ${trades.filter(t => t.profit <= 0).length}`);
      
      // Calculate metrics
      const winningTrades = trades.filter(t => t.profit > 0);
      const losingTrades = trades.filter(t => t.profit <= 0);
      const winRate = trades.length > 0 ? winningTrades.length / trades.length * 100 : 0;
      
      // Calculate profit factor (sum of profits / sum of losses)
      const totalProfits = winningTrades.reduce((sum, trade) => sum + trade.profit, 0);
      const totalLosses = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.profit, 0));
      const profitFactor = totalLosses > 0 ? totalProfits / totalLosses : totalProfits > 0 ? Infinity : 0;
      
      // Calculate average metrics
      const averageProfit = winningTrades.length > 0 
        ? winningTrades.reduce((sum, trade) => sum + trade.profit, 0) / winningTrades.length
        : 0;
        
      const averageLoss = losingTrades.length > 0
        ? Math.abs(losingTrades.reduce((sum, trade) => sum + trade.profit, 0)) / losingTrades.length
        : 0;
      
      // Calculate max drawdown
      let maxDrawdown = 0;
      let peak = equity[0];
      
      for (const value of equity) {
        if (value > peak) {
          peak = value;
        }
        
        const drawdown = (peak - value) / peak;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }
      
      // Calculate Sharpe ratio (simplified)
      const dailyReturns: number[] = [];
      for (let i = 1; i < equity.length; i++) {
        const dailyReturn = (equity[i] - equity[i - 1]) / equity[i - 1];
        dailyReturns.push(dailyReturn);
      }
      
      const avgDailyReturn = dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;
      const stdDevDailyReturn = Math.sqrt(
        dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgDailyReturn, 2), 0) / dailyReturns.length
      );
      
      const sharpeRatio = stdDevDailyReturn > 0 ? (avgDailyReturn / stdDevDailyReturn) * Math.sqrt(252) : 0;
      
      // Prepare and return the backtest result
      const result: BacktestResult = {
        tradingPair: "", // Will be set by the caller
        profit: totalProfit,
        profitPercentage,
        trades,
        equity,
        timestamps,
        metrics: {
          totalTrades: trades.length,
          winningTrades: winningTrades.length,
          losingTrades: losingTrades.length,
          winRate,
          profitFactor,
          averageProfit,
          averageLoss,
          largestProfit: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profit)) : 0,
          largestLoss: losingTrades.length > 0 ? Math.max(...losingTrades.map(t => Math.abs(t.profit))) : 0,
          maxDrawdown,
          sharpeRatio,
          maxConsecutiveWins: this.calculateMaxConsecutive(trades, true),
          maxConsecutiveLosses: this.calculateMaxConsecutive(trades, false)
        }
      };
      
      return result;
    } catch (error) {
      console.error('Error in Moving Average Crossover strategy:', error);
      throw error;
    }
  }
  
  /**
   * Calculate Simple Moving Average (SMA)
   * @param candles Candle data
   * @param period Period for calculation
   * @returns Array of SMA values
   */
  private calculateSMA(candles: Candle[], period: number): number[] {
    const sma: number[] = [];
    
    // Initialize with NaN for values where we don't have enough data
    for (let i = 0; i < period - 1; i++) {
      sma.push(NaN);
    }
    
    // Calculate SMA for each period
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += candles[i - j].close;
      }
      sma.push(sum / period);
    }
    
    return sma;
  }
  
  /**
   * Calculate Exponential Moving Average (EMA)
   * @param candles Candle data
   * @param period Period for calculation
   * @returns Array of EMA values
   */
  private calculateEMA(candles: Candle[], period: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    
    // Start with SMA for the first value
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += candles[i].close;
    }
    const firstEMA = sum / period;
    
    // Initialize with NaN for values where we don't have enough data
    for (let i = 0; i < period - 1; i++) {
      ema.push(NaN);
    }
    
    // Add the first EMA
    ema.push(firstEMA);
    
    // Calculate EMA for remaining periods
    for (let i = period; i < candles.length; i++) {
      const currentPrice = candles[i].close;
      const prevEMA = ema[ema.length - 1];
      const currentEMA = (currentPrice - prevEMA) * multiplier + prevEMA;
      ema.push(currentEMA);
    }
    
    return ema;
  }
  
  /**
   * Calculate maximum consecutive winning or losing trades
   * @param trades List of trades
   * @param isWinning True to count winning trades, false for losing trades
   * @returns Maximum consecutive count
   */
  private calculateMaxConsecutive(trades: BacktestTrade[], isWinning: boolean): number {
    let maxConsecutive = 0;
    let currentConsecutive = 0;
    
    for (const trade of trades) {
      const isTradeWinning = trade.profit > 0;
      
      if (isTradeWinning === isWinning) {
        currentConsecutive++;
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
      } else {
        currentConsecutive = 0;
      }
    }
    
    return maxConsecutive;
  }
  
  private calculateBollingerBands(
    candles: Candle[],
    period: number,
    deviation: number
  ): { sma: number[], upperBand: number[], lowerBand: number[], bandwidth: number[] } {
    const sma: number[] = [];
    const upperBand: number[] = [];
    const lowerBand: number[] = [];
    const bandwidth: number[] = [];
    
    // Calculate SMA and bands for each candle
    for (let i = 0; i < candles.length; i++) {
      if (i < period - 1) {
        // Not enough data yet
        sma.push(0);
        upperBand.push(0);
        lowerBand.push(0);
        bandwidth.push(0);
        continue;
      }
      
      // Calculate SMA
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += candles[i - j].close;
      }
      const average = sum / period;
      sma.push(average);
      
      // Calculate standard deviation
      let sumSquares = 0;
      for (let j = 0; j < period; j++) {
        sumSquares += Math.pow(candles[i - j].close - average, 2);
      }
      const stdDev = Math.sqrt(sumSquares / period);
      
      // Calculate upper and lower bands
      const upper = average + (stdDev * deviation);
      const lower = average - (stdDev * deviation);
      upperBand.push(upper);
      lowerBand.push(lower);
      
      // Calculate Bollinger Bandwidth: (Upper - Lower) / SMA
      const bw = (upper - lower) / average;
      bandwidth.push(bw);
    }
    
    return { sma, upperBand, lowerBand, bandwidth };
  }
  
  /**
   * Calculate MACD
   * @param candles Historical OHLCV data
   * @param fastPeriod Fast EMA period
   * @param slowPeriod Slow EMA period
   * @param signalPeriod Signal EMA period
   * @returns MACD, signal, and histogram
   */
  private calculateMacd(
    candles: Candle[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number
  ): { macd: number[], signal: number[], histogram: number[] } {
    const fastEma = this.calculateEma(candles.map(c => c.close), fastPeriod);
    const slowEma = this.calculateEma(candles.map(c => c.close), slowPeriod);
    
    // Calculate MACD line
    const macd: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (i < slowPeriod - 1) {
        macd.push(0);
      } else {
        macd.push(fastEma[i] - slowEma[i]);
      }
    }
    
    // Calculate signal line (EMA of MACD)
    const signal = this.calculateEma(macd, signalPeriod);
    
    // Calculate histogram
    const histogram: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      histogram.push(macd[i] - signal[i]);
    }
    
    return { macd, signal, histogram };
  }
  
  /**
   * Calculate RSI
   * @param candles Historical OHLCV data
   * @param period RSI period
   * @returns RSI values
   */
  private calculateRsi(
    candles: Candle[],
    period: number
  ): number[] {
    const rsi: number[] = [];
    const closePrices = candles.map(c => c.close);
    
    let avgGain = 0;
    let avgLoss = 0;
    
    // First pass: calculate average gain and loss
    for (let i = 0; i < closePrices.length; i++) {
      if (i === 0) {
        rsi.push(0);
        continue;
      }
      
      const change = closePrices[i] - closePrices[i - 1];
      
      if (i <= period) {
        if (change >= 0) {
          avgGain += change;
        } else {
          avgLoss += Math.abs(change);
        }
        
        if (i === period) {
          avgGain /= period;
          avgLoss /= period;
          
          // Calculate first RSI
          const rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss);
          rsi.push(100 - (100 / (1 + rs)));
        } else {
          rsi.push(0);
        }
      } else {
        // Use smoothed method for subsequent values
        if (change >= 0) {
          avgGain = ((avgGain * (period - 1)) + change) / period;
          avgLoss = ((avgLoss * (period - 1)) + 0) / period;
        } else {
          avgGain = ((avgGain * (period - 1)) + 0) / period;
          avgLoss = ((avgLoss * (period - 1)) + Math.abs(change)) / period;
        }
        
        const rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss);
        rsi.push(100 - (100 / (1 + rs)));
      }
    }
    
    return rsi;
  }
  
  /**
   * Calculate Exponential Moving Average (EMA)
   * @param data Array of values
   * @param period EMA period
   * @returns EMA values
   */
  private calculateEma(
    data: number[],
    period: number
  ): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        ema.push(0);
      } else if (i === period - 1) {
        // First EMA is just SMA
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += data[i - j];
        }
        ema.push(sum / period);
      } else {
        // EMA formula: EMA = (Close - prevEMA) * multiplier + prevEMA
        ema.push((data[i] - ema[i - 1]) * multiplier + ema[i - 1]);
      }
    }
    
    return ema;
  }
  
  /**
   * Save backtest result to database
   * @param botId Bot ID
   * @param result Backtest result
   */
  async saveBacktestResult(
    botId: number,
    pair: string,
    parameters: any,
    period: string,
    result: BacktestResult
  ): Promise<void> {
    try {
      // Parse period to determine start and end dates
      const endDate = new Date();
      let startDate = new Date();
      
      const match = period.match(/(\d+)([dhm])/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
          case 'd':
            startDate.setDate(startDate.getDate() - value);
            break;
          case 'h':
            startDate.setHours(startDate.getHours() - value);
            break;
          case 'm':
            startDate.setMinutes(startDate.getMinutes() - value);
            break;
        }
      } else {
        // Default to 30 days
        startDate.setDate(startDate.getDate() - 30);
      }
      
      // Create backtest result
      const dbResult = {
        botId,
        tradingPair: pair,
        timeframe: period,
        startDate,
        endDate,
        initialCapital: parameters.investment || 1000,
        finalCapital: (parameters.investment || 1000) * (1 + result.profitPercentage / 100),
        totalProfit: result.profit,
        profitPercentage: result.profitPercentage,
        winRate: result.metrics.winRate,
        totalTrades: result.metrics.totalTrades,
        winningTrades: result.metrics.winningTrades,
        losingTrades: result.metrics.losingTrades,
        maxDrawdown: result.metrics.maxDrawdown,
        sharpeRatio: result.metrics.sharpeRatio,
        profitFactor: result.metrics.profitFactor,
        averageProfit: result.metrics.averageProfit,
        averageLoss: result.metrics.averageLoss,
        maxConsecutiveLosses: result.metrics.maxConsecutiveLosses,
        trades: JSON.stringify(result.trades),
        equityCurve: JSON.stringify(result.equity),
        parameters: JSON.stringify(parameters)
      };
      
      await storage.createBacktestResult(dbResult);
    } catch (error) {
      console.error('Error saving backtest result:', error);
      throw error;
    }
  }
}

export const backtestService = new BacktestService();

// Types for backtesting

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestTrade {
  id: number;
  timestamp: number;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  profit: number;
  profitPercentage: number;
  side: 'buy' | 'sell';
  duration: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  averageProfit: number;
  averageLoss: number;
  largestProfit: number;
  largestLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
}

export interface BacktestResult {
  tradingPair: string;
  profit: number;
  profitPercentage: number;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  equity: number[];
  timestamps: number[];
}