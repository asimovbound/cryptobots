import { db } from './db';
import { defaultStrategies, InsertDefaultStrategy } from '@shared/schema';
import { storage } from './storage';

// Default strategies data
const strategies: InsertDefaultStrategy[] = [
  // Grid Trading strategies
  {
    name: "Basic Grid",
    description: "A simple grid strategy that buys at lower grid levels and sells at higher grid levels. Designed for sideways markets with good volatility.",
    strategyType: "Grid Trading",
    category: "grid",
    parameters: {
      gridLevels: 5,
      upperPrice: 0,  // Will be set dynamically based on market price
      lowerPrice: 0,  // Will be set dynamically based on market price
      positionSize: 0.1,
      stopLoss: 0.03,
      takeProfitPct: 0.05,
      trailingStop: false,
      trailingStopDistance: 0.02,
      resetStopLoss: false
    },
    parameterDescriptions: {
      gridLevels: "Number of price levels in the grid. More levels mean smaller price movements between trades.",
      upperPrice: "The highest price in the grid. Set to 0 for automatic calculation based on current price.",
      lowerPrice: "The lowest price in the grid. Set to 0 for automatic calculation based on current price.",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per trade)",
      stopLoss: "Stop loss as a decimal (0.03 = 3% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.05 = 5% gain from entry price)",
      trailingStop: "Enable trailing stop loss to follow price movements",
      trailingStopDistance: "Distance for trailing stop as a decimal (0.02 = 2% below highest price)",
      resetStopLoss: "Reset stop loss on each new grid level entry"
    },
    riskLevel: "moderate",
    recommendedAssets: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    isActive: true,
    displayOrder: 10
  },
  {
    name: "Aggressive Grid",
    description: "A grid strategy with tighter grid spacing and more aggressive position sizing. For experienced traders in volatile markets.",
    strategyType: "Grid Trading",
    category: "grid",
    parameters: {
      gridLevels: 7,
      upperPrice: 0,
      lowerPrice: 0,
      positionSize: 0.15,
      stopLoss: 0.05,
      takeProfitPct: 0.08,
      trailingStop: true,
      trailingStopDistance: 0.03,
      resetStopLoss: true
    },
    parameterDescriptions: {
      gridLevels: "Number of price levels in the grid. More levels mean smaller price movements between trades.",
      upperPrice: "The highest price in the grid. Set to 0 for automatic calculation based on current price.",
      lowerPrice: "The lowest price in the grid. Set to 0 for automatic calculation based on current price.",
      positionSize: "Position size as a fraction of available capital (0.15 = 15% per trade)",
      stopLoss: "Stop loss as a decimal (0.05 = 5% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.08 = 8% gain from entry price)",
      trailingStop: "Enable trailing stop loss to follow price movements",
      trailingStopDistance: "Distance for trailing stop as a decimal (0.03 = 3% below highest price)",
      resetStopLoss: "Reset stop loss on each new grid level entry"
    },
    riskLevel: "high",
    recommendedAssets: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "DOGE/USDT"],
    isActive: true,
    displayOrder: 20
  },
  {
    name: "Conservative Grid",
    description: "A safer grid strategy with wider grid spacing and smaller position sizes. Ideal for beginners or conservative traders.",
    strategyType: "Grid Trading",
    category: "grid",
    parameters: {
      gridLevels: 3,
      upperPrice: 0,
      lowerPrice: 0,
      positionSize: 0.05,
      stopLoss: 0.02,
      takeProfitPct: 0.03,
      trailingStop: false,
      trailingStopDistance: 0.015,
      resetStopLoss: false
    },
    parameterDescriptions: {
      gridLevels: "Number of price levels in the grid. More levels mean smaller price movements between trades.",
      upperPrice: "The highest price in the grid. Set to 0 for automatic calculation based on current price.",
      lowerPrice: "The lowest price in the grid. Set to 0 for automatic calculation based on current price.",
      positionSize: "Position size as a fraction of available capital (0.05 = 5% per trade)",
      stopLoss: "Stop loss as a decimal (0.02 = 2% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.03 = 3% gain from entry price)",
      trailingStop: "Enable trailing stop loss to follow price movements",
      trailingStopDistance: "Distance for trailing stop as a decimal (0.015 = 1.5% below highest price)",
      resetStopLoss: "Reset stop loss on each new grid level entry"
    },
    riskLevel: "low",
    recommendedAssets: ["BTC/USDT", "ETH/USDT"],
    isActive: true,
    displayOrder: 30
  },
  
  // MACD Crossover strategies
  {
    name: "MACD Trend Follower",
    description: "Uses MACD crossovers to identify trend changes and enter/exit positions. Best for trending markets, not sideways conditions.",
    strategyType: "MACD Crossover",
    category: "trend",
    parameters: {
      fastLength: 12,
      slowLength: 26,
      signalLength: 9,
      positionSize: 0.1,
      stopLoss: 0.03,
      takeProfitPct: 0.05,
      trailingStop: true,
      trailingStopDistance: 0.02
    },
    parameterDescriptions: {
      fastLength: "Fast EMA period for MACD calculation",
      slowLength: "Slow EMA period for MACD calculation",
      signalLength: "Signal line period for MACD calculation",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per trade)",
      stopLoss: "Stop loss as a decimal (0.03 = 3% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.05 = 5% gain from entry price)",
      trailingStop: "Enable trailing stop loss to follow price movements",
      trailingStopDistance: "Distance for trailing stop as a decimal (0.02 = 2% below highest price)"
    },
    riskLevel: "moderate",
    recommendedAssets: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    isActive: true,
    displayOrder: 40
  },
  {
    name: "MACD Divergence",
    description: "Identifies MACD divergences with price to spot potential reversals. More advanced strategy for experienced traders.",
    strategyType: "MACD Crossover",
    category: "trend",
    parameters: {
      fastLength: 12,
      slowLength: 26,
      signalLength: 9,
      lookbackPeriod: 14,
      divergenceThreshold: 0.5,
      positionSize: 0.1,
      stopLoss: 0.03,
      takeProfitPct: 0.05,
      trailingStop: true,
      trailingStopDistance: 0.02
    },
    parameterDescriptions: {
      fastLength: "Fast EMA period for MACD calculation",
      slowLength: "Slow EMA period for MACD calculation",
      signalLength: "Signal line period for MACD calculation",
      lookbackPeriod: "Number of bars to look back for divergence patterns",
      divergenceThreshold: "Minimum threshold to confirm a valid divergence (0-1)",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per trade)",
      stopLoss: "Stop loss as a decimal (0.03 = 3% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.05 = 5% gain from entry price)",
      trailingStop: "Enable trailing stop loss to follow price movements",
      trailingStopDistance: "Distance for trailing stop as a decimal (0.02 = 2% below highest price)"
    },
    riskLevel: "high",
    recommendedAssets: ["BTC/USDT", "ETH/USDT"],
    isActive: true,
    displayOrder: 50
  },
  
  // Bollinger Bands strategies
  {
    name: "Bollinger Bounce",
    description: "Trades bounces off the Bollinger Bands. Buys at lower band, sells at upper band. Ideal for range-bound markets.",
    strategyType: "Bollinger Bands",
    category: "mean-reversion",
    parameters: {
      period: 20,
      stdDev: 2.0,
      maType: "SMA",
      positionSize: 0.1,
      stopLoss: 0.03,
      takeProfitPct: 0.05,
      trailingStop: false,
      oversoldThreshold: 0.05,
      overboughtThreshold: 0.05
    },
    parameterDescriptions: {
      period: "Number of periods used to calculate the Bollinger Bands",
      stdDev: "Number of standard deviations for the Bollinger Bands width",
      maType: "Moving average type: SMA or EMA",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per trade)",
      stopLoss: "Stop loss as a decimal (0.03 = 3% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.05 = 5% gain from entry price)",
      trailingStop: "Enable trailing stop loss to follow price movements",
      oversoldThreshold: "How close to lower band to consider oversold (0.05 = 5% from lower band)",
      overboughtThreshold: "How close to upper band to consider overbought (0.05 = 5% from upper band)"
    },
    riskLevel: "moderate",
    recommendedAssets: ["BTC/USDT", "ETH/USDT", "LINK/USDT"],
    isActive: true,
    displayOrder: 60
  },
  {
    name: "Bollinger Breakout",
    description: "Trades breakouts from the Bollinger Bands. Enters when price moves outside the bands, anticipating continued momentum.",
    strategyType: "Bollinger Bands",
    category: "momentum",
    parameters: {
      period: 20,
      stdDev: 2.2,
      maType: "EMA",
      positionSize: 0.1,
      stopLoss: 0.03,
      takeProfitPct: 0.07,
      trailingStop: true,
      trailingStopDistance: 0.03,
      confirmationCandles: 2
    },
    parameterDescriptions: {
      period: "Number of periods used to calculate the Bollinger Bands",
      stdDev: "Number of standard deviations for the Bollinger Bands width",
      maType: "Moving average type: SMA or EMA",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per trade)",
      stopLoss: "Stop loss as a decimal (0.03 = 3% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.07 = 7% gain from entry price)",
      trailingStop: "Enable trailing stop loss to follow price movements",
      trailingStopDistance: "Distance for trailing stop as a decimal (0.03 = 3% below highest price)",
      confirmationCandles: "Number of candles required to confirm a breakout"
    },
    riskLevel: "high",
    recommendedAssets: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "AVAX/USDT"],
    isActive: true,
    displayOrder: 70
  },
  
  // Signal Bot strategies
  {
    name: "Multi-Indicator Signal",
    description: "Combines multiple indicators to generate trading signals. Offers flexibility with AND/OR logic for signal confirmation.",
    strategyType: "Signal",
    category: "multi-strategy",
    parameters: {
      signals: [
        {
          indicator: "RSI",
          parameters: { period: 14, oversold: 30, overbought: 70 },
          condition: "crossUnder", // crossOver, crossUnder, above, below
          value: 30,
          enabled: true
        },
        {
          indicator: "MACD",
          parameters: { fast: 12, slow: 26, signal: 9 },
          condition: "crossOver",
          value: 0,
          enabled: true
        }
      ],
      logicOperator: "AND", // AND or OR
      positionSize: 0.1,
      stopLoss: 0.03,
      takeProfitPct: 0.05,
      maxSignals: 2
    },
    parameterDescriptions: {
      signals: "Array of signal configurations with indicator settings and conditions",
      logicOperator: "How to combine signals: AND (all must be true) or OR (any can be true)",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per trade)",
      stopLoss: "Stop loss as a decimal (0.03 = 3% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.05 = 5% gain from entry price)",
      maxSignals: "Maximum number of active signals to track (up to 5)"
    },
    riskLevel: "moderate",
    recommendedAssets: ["BTC/USDT", "ETH/USDT"],
    isActive: true,
    displayOrder: 80
  },
  {
    name: "Advanced Signal Mix",
    description: "A pre-configured mix of technical indicators with optimized settings based on historical performance across major cryptocurrencies.",
    strategyType: "Signal",
    category: "multi-strategy",
    parameters: {
      signals: [
        {
          indicator: "RSI",
          parameters: { period: 14, oversold: 30, overbought: 70 },
          condition: "crossUnder",
          value: 30,
          enabled: true
        },
        {
          indicator: "Bollinger Bands",
          parameters: { period: 20, stdDev: 2 },
          condition: "below",
          value: "lower",
          enabled: true
        },
        {
          indicator: "MACD",
          parameters: { fast: 12, slow: 26, signal: 9 },
          condition: "crossOver",
          value: 0,
          enabled: true
        },
        {
          indicator: "EMA",
          parameters: { period: 50 },
          condition: "above",
          value: "price",
          enabled: false
        },
        {
          indicator: "Stochastic",
          parameters: { kPeriod: 14, dPeriod: 3, smooth: 3 },
          condition: "crossOver",
          value: 20,
          enabled: false
        }
      ],
      logicOperator: "OR", // AND or OR
      positionSize: 0.1,
      stopLoss: 0.03,
      takeProfitPct: 0.06,
      maxSignals: 5
    },
    parameterDescriptions: {
      signals: "Array of signal configurations with indicator settings and conditions",
      logicOperator: "How to combine signals: AND (all must be true) or OR (any can be true)",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per trade)",
      stopLoss: "Stop loss as a decimal (0.03 = 3% loss from entry price)",
      takeProfitPct: "Take profit as a decimal (0.06 = 6% gain from entry price)",
      maxSignals: "Maximum number of active signals to track (up to 5)"
    },
    riskLevel: "high",
    recommendedAssets: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ADA/USDT"],
    isActive: true,
    displayOrder: 90
  },
  
  // DCA strategies
  {
    name: "Basic DCA",
    description: "A simple Dollar Cost Averaging strategy that buys at regular intervals regardless of price. Good for long-term accumulation.",
    strategyType: "DCA",
    category: "accumulation",
    parameters: {
      interval: "1d", // 1h, 4h, 1d, 1w
      positionSize: 0.1,
      maxPositions: 10,
      takeProfitPct: 0.05
    },
    parameterDescriptions: {
      interval: "Time interval between purchases (1h, 4h, 1d, 1w)",
      positionSize: "Position size as a fraction of available capital (0.1 = 10% per purchase)",
      maxPositions: "Maximum number of positions to open",
      takeProfitPct: "Take profit as a decimal (0.05 = 5% gain from average entry price)"
    },
    riskLevel: "low",
    recommendedAssets: ["BTC/USDT", "ETH/USDT"],
    isActive: true,
    displayOrder: 100
  },
  {
    name: "Value-Averaged DCA",
    description: "Modified DCA that adjusts purchase amounts based on current price relative to moving average. Buys more when price is below average.",
    strategyType: "DCA",
    category: "accumulation",
    parameters: {
      interval: "1d",
      basePositionSize: 0.1,
      maxAdjustmentFactor: 2.0,
      referencePeriod: 30,
      takeProfitPct: 0.05,
      maxPositions: 15
    },
    parameterDescriptions: {
      interval: "Time interval between purchases (1h, 4h, 1d, 1w)",
      basePositionSize: "Base position size as a fraction of available capital (0.1 = 10%)",
      maxAdjustmentFactor: "Maximum multiplier for position size based on value (2.0 = up to 2x the base size)",
      referencePeriod: "Period for calculating the reference average price",
      takeProfitPct: "Take profit as a decimal (0.05 = 5% gain from average entry price)",
      maxPositions: "Maximum number of positions to open"
    },
    riskLevel: "moderate",
    recommendedAssets: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    isActive: true,
    displayOrder: 110
  }
];

export async function populateDefaultStrategies() {
  console.log("[express] Starting default strategies population");
  
  try {
    // Check if any strategies already exist
    const existingStrategies = await storage.getAllDefaultStrategies();
    
    if (existingStrategies.length > 0) {
      console.log(`[express] ${existingStrategies.length} default strategies already exist, skipping population`);
      return;
    }
    
    // Insert all strategies
    for (const strategy of strategies) {
      await storage.createDefaultStrategy(strategy);
      console.log(`[express] Created default strategy: ${strategy.name}`);
    }
    
    console.log(`[express] Successfully populated ${strategies.length} default strategies`);
    return true;
  } catch (error) {
    console.error("[express] Error populating default strategies:", error);
    return false;
  }
}

// Only run if this file is executed directly
import { fileURLToPath } from 'url';
import path from 'path';

// ES Modules equivalent of __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if this file is being run directly
if (process.argv[1] === __filename) {
  populateDefaultStrategies()
    .then(() => {
      console.log("Default strategies population completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Error during default strategies population:", error);
      process.exit(1);
    });
}