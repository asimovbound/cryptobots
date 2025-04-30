/**
 * Utility functions for trading strategy calculations
 */

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculate Simple Moving Average (SMA)
 * @param values Array of values to calculate SMA for
 * @param period Length of the moving average window
 * @returns Array of SMA values
 */
export function calculateSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      // Not enough data for the period yet
      result.push(NaN);
      continue;
    }
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - j];
    }
    
    result.push(sum / period);
  }
  
  return result;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param values Array of values to calculate EMA for
 * @param period Length of the moving average window
 * @returns Array of EMA values
 */
export function calculateEMA(values: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // Start with SMA for the first EMA value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  
  result.push(sum / period);
  
  // Calculate remaining EMA values
  for (let i = period; i < values.length; i++) {
    const ema = (values[i] - result[result.length - 1]) * multiplier + result[result.length - 1];
    result.push(ema);
  }
  
  // Pad the beginning with NaN values to match input length
  const padding = Array(period - 1).fill(NaN);
  return [...padding, ...result];
}

/**
 * Calculate Bollinger Bands
 * @param values Array of values to calculate bands for (typically closing prices)
 * @param period Period for the moving average
 * @param stdDev Number of standard deviations for the bands
 * @returns Object with upper, middle (SMA), and lower bands
 */
export function calculateBollingerBands(
  values: number[], 
  period: number, 
  stdDev: number
): { 
  upper: number[], 
  middle: number[], 
  lower: number[] 
} {
  const middle = calculateSMA(values, period);
  const upper: number[] = [];
  const lower: number[] = [];
  
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }
    
    // Calculate standard deviation
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += Math.pow(values[i - j] - middle[i], 2);
    }
    
    const stdDevValue = Math.sqrt(sum / period);
    
    upper.push(middle[i] + (stdDevValue * stdDev));
    lower.push(middle[i] - (stdDevValue * stdDev));
  }
  
  return { upper, middle, lower };
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param values Array of values (typically closing prices)
 * @param period RSI period
 * @returns Array of RSI values
 */
export function calculateRSI(values: number[], period: number): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  // Calculate price changes
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Calculate average gains and losses
  const avgGains = calculateSMA(gains, period);
  const avgLosses = calculateSMA(losses, period);
  
  // Calculate RS and RSI
  for (let i = 0; i < avgGains.length; i++) {
    if (isNaN(avgGains[i]) || isNaN(avgLosses[i]) || avgLosses[i] === 0) {
      result.push(NaN);
    } else {
      const rs = avgGains[i] / avgLosses[i];
      const rsi = 100 - (100 / (1 + rs));
      result.push(rsi);
    }
  }
  
  // Pad the beginning to match the input length
  const padding = Array(1).fill(NaN);
  return [...padding, ...result];
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param values Array of values (typically closing prices)
 * @param fastPeriod Period for the fast EMA
 * @param slowPeriod Period for the slow EMA
 * @param signalPeriod Period for the signal line
 * @returns Object with MACD line, signal line, and histogram values
 */
export function calculateMACD(
  values: number[], 
  fastPeriod: number, 
  slowPeriod: number, 
  signalPeriod: number
): {
  macd: number[],
  signal: number[],
  histogram: number[]
} {
  // Calculate fast and slow EMAs
  const fastEMA = calculateEMA(values, fastPeriod);
  const slowEMA = calculateEMA(values, slowPeriod);
  
  // Calculate MACD line (fast EMA - slow EMA)
  const macdLine: number[] = [];
  
  for (let i = 0; i < values.length; i++) {
    if (isNaN(fastEMA[i]) || isNaN(slowEMA[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(fastEMA[i] - slowEMA[i]);
    }
  }
  
  // Calculate the signal line (EMA of MACD line)
  // First, remove NaN values for the EMA calculation
  const validMacdValues = macdLine.filter(v => !isNaN(v));
  const signalLine = calculateEMA(validMacdValues, signalPeriod);
  
  // Re-add NaN padding to match original length
  const nanCount = macdLine.length - validMacdValues.length;
  const paddedSignalLine = [...Array(nanCount).fill(NaN), ...signalLine];
  
  // Calculate histogram (MACD line - signal line)
  const histogram: number[] = [];
  
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i]) || isNaN(paddedSignalLine[i])) {
      histogram.push(NaN);
    } else {
      histogram.push(macdLine[i] - paddedSignalLine[i]);
    }
  }
  
  return {
    macd: macdLine,
    signal: paddedSignalLine,
    histogram
  };
}

/**
 * Calculate profit and loss for a trade
 * @param entryPrice Entry price
 * @param exitPrice Exit price
 * @param positionSize Position size as a decimal (e.g., 0.1 for 10%)
 * @param investment Initial investment amount
 * @param leverage Leverage multiplier
 * @param side Trade side: 'buy' (long) or 'sell' (short)
 * @returns Object with profit amount and percentage
 */
export function calculatePnL(
  entryPrice: number,
  exitPrice: number,
  positionSize: number,
  investment: number,
  leverage: number = 1,
  side: 'buy' | 'sell' = 'buy'
): {
  amount: number,
  percentage: number
} {
  const investmentAmount = investment * positionSize;
  
  if (side === 'buy') {
    // Long position
    const priceChange = exitPrice - entryPrice;
    const percentageChange = (priceChange / entryPrice) * 100;
    const leveragedPercentage = percentageChange * leverage;
    
    return {
      amount: investmentAmount * (leveragedPercentage / 100),
      percentage: leveragedPercentage
    };
  } else {
    // Short position
    const priceChange = entryPrice - exitPrice;
    const percentageChange = (priceChange / entryPrice) * 100;
    const leveragedPercentage = percentageChange * leverage;
    
    return {
      amount: investmentAmount * (leveragedPercentage / 100),
      percentage: leveragedPercentage
    };
  }
}

/**
 * Calculate drawdown from peak equity
 * @param equityCurve Array of equity values over time
 * @returns Object with maximum drawdown percentage and amount
 */
export function calculateDrawdown(equityCurve: number[]): {
  maxDrawdownPct: number,
  maxDrawdownAmount: number
} {
  let peak = equityCurve[0];
  let maxDrawdownPct = 0;
  let maxDrawdownAmount = 0;
  
  for (let i = 1; i < equityCurve.length; i++) {
    // Update peak if we have a new high
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      continue;
    }
    
    // Calculate drawdown from peak
    const drawdownAmount = peak - equityCurve[i];
    const drawdownPct = (drawdownAmount / peak) * 100;
    
    // Update max drawdown if this is worse
    if (drawdownPct > maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      maxDrawdownAmount = drawdownAmount;
    }
  }
  
  return {
    maxDrawdownPct,
    maxDrawdownAmount
  };
}

/**
 * Get optimal stop loss and take profit levels based on recent volatility
 * @param candles Recent price candles
 * @param atrMultiplierSl ATR multiplier for stop loss
 * @param atrMultiplierTp ATR multiplier for take profit
 * @returns Suggested stop loss and take profit percentages
 */
export function getOptimalStopLossAndTakeProfit(
  candles: Candle[],
  atrMultiplierSl: number = 1.5,
  atrMultiplierTp: number = 3.0
): {
  stopLossPct: number,
  takeProfitPct: number
} {
  // Calculate Average True Range (ATR)
  const trValues: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const trA = candles[i].high - candles[i].low; // Current high - current low
    const trB = Math.abs(candles[i].high - candles[i-1].close); // Current high - previous close
    const trC = Math.abs(candles[i].low - candles[i-1].close); // Current low - previous close
    
    const tr = Math.max(trA, trB, trC);
    trValues.push(tr);
  }
  
  // Calculate 14-period ATR
  const atrPeriod = Math.min(14, trValues.length);
  let atrSum = 0;
  for (let i = 0; i < atrPeriod; i++) {
    atrSum += trValues[trValues.length - 1 - i];
  }
  const atr = atrSum / atrPeriod;
  
  // Calculate average price from last candle
  const averagePrice = (candles[candles.length - 1].high + candles[candles.length - 1].low) / 2;
  
  // Calculate stop loss and take profit percentages
  const stopLossPct = (atr * atrMultiplierSl / averagePrice) * 100;
  const takeProfitPct = (atr * atrMultiplierTp / averagePrice) * 100;
  
  return {
    stopLossPct,
    takeProfitPct
  };
}

/**
 * Detect trading range or trend from a series of candles
 * @param candles Recent price candles
 * @returns Whether the market is ranging or trending and the strength of the pattern
 */
export function detectMarketCondition(
  candles: Candle[]
): {
  isRanging: boolean,
  isTrending: boolean,
  strength: number
} {
  // Extract closing prices
  const closes = candles.map(c => c.close);
  
  // Calculate ADX (Average Directional Index)
  // Simplified implementation for demonstration
  const period = 14;
  const rateOfChange: number[] = [];
  
  for (let i = period; i < closes.length; i++) {
    const change = Math.abs((closes[i] - closes[i - period]) / closes[i - period]);
    rateOfChange.push(change);
  }
  
  const avgChange = rateOfChange.reduce((sum, val) => sum + val, 0) / rateOfChange.length;
  const strength = Math.min(100, avgChange * 100);
  
  // Calculate if price is moving in a range or a trend
  const stdDev = calculateStandardDeviation(closes.slice(-period));
  const mean = closes.slice(-period).reduce((sum, val) => sum + val, 0) / period;
  const coefficient = stdDev / mean;
  
  // If coefficient of variation is low, it's ranging
  const isRanging = coefficient < 0.03;
  
  return {
    isRanging,
    isTrending: !isRanging,
    strength
  };
}

/**
 * Calculate standard deviation of an array of numbers
 * @param values Array of values
 * @returns Standard deviation
 */
function calculateStandardDeviation(values: number[]): number {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  return Math.sqrt(variance);
}