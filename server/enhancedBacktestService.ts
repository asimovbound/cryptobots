import { backtestService, BacktestResult, BacktestTrade, BacktestMetrics } from './backtestService';
import { storage } from './storage';
import { Bot, InsertBacktestResult } from '@shared/schema';
import { AiProvider } from './aiDiagnosticsService';

// Add error property to the types to handle error states
interface EnhancedBacktestResultWithError extends EnhancedBacktestResult {
  error?: string;
}

interface ParameterSweepResultWithError extends ParameterSweepResult {
  error?: string;
}

/**
 * Enhanced backtesting service with advanced analytics
 */
export class EnhancedBacktestService {
  /**
   * Run a backtest with advanced analytics
   */
  async runBacktest(
    pair: string, 
    parameters: any, 
    period: string = '30d', 
    botId?: number,
    aiDiagnosticsEnabled: boolean = true,
    aiProvider?: AiProvider,
    interval?: string,
    startDate?: string,
    endDate?: string
  ): Promise<EnhancedBacktestResultWithError> {
    try {
      console.log(`Running enhanced backtest for ${pair} with strategy ${parameters.strategy} over period ${period}${interval ? ` with interval ${interval}` : ''}`);
      console.log(`AI diagnostics enabled: ${aiDiagnosticsEnabled}, provider: ${aiProvider || 'default'}`);
      
      // Log the parameters object to debug investment passing
      console.log('Enhanced backtest parameters:', JSON.stringify(parameters));
      console.log('Investment value in enhanced parameters:', parameters.investment);
      console.log('InitialInvestment value in enhanced parameters:', parameters.initialInvestment);
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for backtest: from ${startDate} to ${endDate}`);
      }
      
      // Run standard backtest
      const basicResult = await backtestService.runBacktest(pair, parameters, period, undefined, interval, startDate, endDate);
      if (!basicResult) {
        console.error('Basic backtest returned null or undefined result');
        throw new Error('Basic backtest failed to return results');
      }
      
      // Ensure the basic result has all the required properties
      const validatedBasicResult = this.ensureValidBacktestResult(basicResult);
      
      // Enhance with additional metrics
      const enhancedResult = this.enhanceBacktestResult(validatedBasicResult);
      
      // Add flag to the result to indicate if AI diagnostics are enabled
      enhancedResult.aiDiagnosticsEnabled = aiDiagnosticsEnabled;
      
      // Save result to database if botId is provided
      if (botId) {
        await this.saveBacktestResult(botId, pair, parameters, period, enhancedResult);
      }
      
      return enhancedResult;
    } catch (error: any) {
      console.error('Enhanced backtest error:', error);
      // Return a minimal valid result with error information
      return this.createErrorResult(pair, error?.message || 'Unknown error');
    }
  }
  
  /**
   * Ensure backtest result has all required properties with valid values
   */
  private ensureValidBacktestResult(result: BacktestResult): BacktestResult {
    // Create a validated copy of the result with fallbacks for missing properties
    return {
      tradingPair: result.tradingPair || 'Unknown',
      profit: result.profit || 0,
      profitPercentage: result.profitPercentage || 0,
      trades: Array.isArray(result.trades) ? result.trades : [],
      metrics: {
        totalTrades: result.metrics?.totalTrades || 0,
        winningTrades: result.metrics?.winningTrades || 0,
        losingTrades: result.metrics?.losingTrades || 0,
        winRate: result.metrics?.winRate || 0,
        profitFactor: result.metrics?.profitFactor || 0,
        averageProfit: result.metrics?.averageProfit || 0,
        averageLoss: result.metrics?.averageLoss || 0,
        largestProfit: result.metrics?.largestProfit || 0,
        largestLoss: result.metrics?.largestLoss || 0,
        maxDrawdown: result.metrics?.maxDrawdown || 0,
        sharpeRatio: result.metrics?.sharpeRatio || 0,
        maxConsecutiveWins: result.metrics?.maxConsecutiveWins || 0,
        maxConsecutiveLosses: result.metrics?.maxConsecutiveLosses || 0
      },
      equity: Array.isArray(result.equity) ? result.equity : [1000],
      timestamps: Array.isArray(result.timestamps) ? result.timestamps : [Date.now()]
    };
  }
  
  /**
   * Create an error result for safe display
   */
  private createErrorResult(pair: string, errorMessage: string): EnhancedBacktestResultWithError {
    console.log(`Creating error result for ${pair}: ${errorMessage}`);
    return {
      tradingPair: pair,
      profit: 0,
      profitPercentage: 0,
      error: errorMessage,
      trades: [],
      metrics: {
        totalTrades: 0,
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
      },
      enhancedMetrics: {
        expectancy: 0,
        systemQuality: 0,
        recoveryFactor: 0,
        payoffRatio: 0,
        profitFactor: 0,
        kellyPercentage: 0,
        riskOfRuin: 0,
        tradingFrequency: 0,
        annualizedReturn: 0
      },
      drawdownPeriods: [],
      tradeDistribution: {
        profitRanges: [],
        hourlyDistribution: {},
        dayOfWeekDistribution: {},
        totalTrades: 0
      },
      monthlyPerformance: [],
      dailyPerformance: [],
      profitCurve: [0],
      riskReturnRatio: 0,
      consecutiveTrades: {
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        totalStreaks: 0,
        streakAnalysis: ''
      },
      tradeAnalytics: {
        averageTradeDurationMs: 0,
        averageTradeDurationHours: 0,
        tradeFrequency: 0,
        sizingAnalysis: {
          minSize: 0,
          maxSize: 0,
          avgSize: 0,
          smallTradesCount: 0,
          mediumTradesCount: 0,
          largeTradesCount: 0,
          smallTradesWinRate: 0,
          mediumTradesWinRate: 0,
          largeTradesWinRate: 0
        },
        profitConsistency: 0
      },
      equity: [0],
      timestamps: [Date.now()]
    };
  }
  
  /**
   * Run multiple backtests with different parameter configurations
   */
  async runParameterSweep(
    pair: string,
    baseParameters: any,
    parameterRanges: ParameterRange[],
    period: string = '30d',
    startDate?: string,
    endDate?: string
  ): Promise<ParameterSweepResultWithError> {
    try {
      console.log(`Running parameter sweep for ${pair} with ${parameterRanges.length} ranges over period ${period}`);
      
      // Generate parameter combinations
      const parameterSets = this.generateParameterSets(baseParameters, parameterRanges);
      
      if (parameterSets.length === 0) {
        console.warn('No parameter sets generated');
        throw new Error('Failed to generate parameter combinations');
      }
      
      console.log(`Generated ${parameterSets.length} parameter combinations`);
      
      // Run backtests for each parameter set
      const results: BacktestParameterResult[] = [];
      
      // Helper function to add a delay between API calls to avoid rate limits
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      for (let i = 0; i < parameterSets.length; i++) {
        const params = parameterSets[i];
        try {
          console.log(`Running parameter set ${i+1}/${parameterSets.length}`);
          console.log(`Parameters: ${JSON.stringify(params)}`);
          
          // Log custom date range if provided
          if (period === 'custom' && startDate && endDate) {
            console.log(`Using custom date range for parameter set ${i+1}: from ${startDate} to ${endDate}`);
          }
          
          // Run backtest with this parameter set
          const backtest = await backtestService.runBacktest(pair, params, period, undefined, params.interval, startDate, endDate);
          
          if (!backtest) {
            console.warn(`Null result for parameter set: ${JSON.stringify(params)}`);
            continue;
          }
          
          // Add to results with null checking
          results.push({
            parameters: params,
            profitPercentage: backtest.profitPercentage || 0,
            sharpeRatio: backtest.metrics?.sharpeRatio || 0,
            maxDrawdown: backtest.metrics?.maxDrawdown || 0,
            winRate: backtest.metrics?.winRate || 0,
            totalTrades: backtest.metrics?.totalTrades || 0
          });
          
          // Add a delay between API calls to avoid rate limiting
          // Wait 2 seconds between calls
          if (i < parameterSets.length - 1) {
            console.log(`Waiting 2 seconds before next backtest to avoid rate limits...`);
            await sleep(2000);
          }
        } catch (paramSetError) {
          console.error(`Error running backtest for parameter set: ${JSON.stringify(params)}`, paramSetError);
          // If we hit a rate limit, wait longer before continuing
          if (paramSetError.toString().includes("Too many requests")) {
            console.log("Rate limit hit, waiting 10 seconds before continuing...");
            await sleep(10000);
          }
          // Continue with other parameter sets
        }
      }
      
      if (results.length === 0) {
        throw new Error('No valid backtest results generated during parameter sweep');
      }
      
      // Find optimal parameter set
      const sortedResults = [...results].sort((a, b) => {
        // Primary sorting by profit percentage
        if (b.profitPercentage !== a.profitPercentage) {
          return b.profitPercentage - a.profitPercentage;
        }
        
        // Secondary sorting by Sharpe ratio
        return b.sharpeRatio - a.sharpeRatio;
      });
      
      // Get top results
      const topResults = sortedResults.slice(0, Math.min(5, sortedResults.length));
      
      // Log final result for debugging
      console.log(`Parameter sweep completed. Found ${topResults.length} top results out of ${results.length} total`);
      if (topResults.length > 0) {
        console.log(`Best result: ${JSON.stringify({
          profitPercentage: topResults[0].profitPercentage,
          parameters: Object.keys(topResults[0].parameters)
        })}`);
      }
      
      return {
        parameterSets: parameterSets.length,
        timeframe: period,
        tradingPair: pair,
        topResults: topResults.map(result => ({
          ...result,
          // Ensure parameters are serializable
          parameters: JSON.parse(JSON.stringify(result.parameters))
        })),
        allResults: results.map(result => ({
          ...result,
          // Ensure parameters are serializable
          parameters: JSON.parse(JSON.stringify(result.parameters))
        }))
      };
    } catch (error: any) {
      console.error('Parameter sweep error:', error);
      // Return a minimal valid result with error information
      return {
        parameterSets: 0,
        timeframe: period,
        tradingPair: pair,
        error: error?.message || 'Unknown parameter sweep error',
        topResults: [],
        allResults: []
      };
    }
  }
  
  /**
   * Run multi-timeframe backtest analysis
   */
  async runMultiTimeframeBacktest(
    pair: string,
    parameters: any,
    timeframes: string[] = ['1h', '4h', '1d'],
    period: string = '30d',
    startDate?: string,
    endDate?: string
  ): Promise<MultiTimeframeResult> {
    try {
      const results = [];
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for multi-timeframe analysis: from ${startDate} to ${endDate}`);
      }
      
      // Run backtest for each timeframe
      for (const timeframe of timeframes) {
        // If using custom period, use the provided dates
        // Otherwise calculate appropriate period for this timeframe
        const tfPeriod = period === 'custom' ? 'custom' : this.calculatePeriodForTimeframe(timeframe);
        
        console.log(`Running backtest for timeframe ${timeframe} with period ${tfPeriod}`);
        
        // Run backtest with date parameters if custom period
        const backtest = await backtestService.runBacktest(
          pair, 
          parameters, 
          tfPeriod, 
          undefined, 
          timeframe,
          period === 'custom' ? startDate : undefined,
          period === 'custom' ? endDate : undefined
        );
        
        // Convert to simplified result
        results.push({
          timeframe,
          profitPercentage: backtest.profitPercentage,
          totalTrades: backtest.metrics.totalTrades,
          winRate: backtest.metrics.winRate,
          sharpeRatio: backtest.metrics.sharpeRatio,
          maxDrawdown: backtest.metrics.maxDrawdown
        });
      }
      
      // Determine timeframe consistency
      const consistency = this.calculateTimeframeConsistency(results);
      
      return {
        tradingPair: pair,
        timeframes,
        results,
        timeframeConsistency: consistency,
        consistencyScore: this.calculateConsistencyScore(results)
      };
    } catch (error) {
      console.error('Multi-timeframe backtest error:', error);
      throw error;
    }
  }
  
  /**
   * Compare backtest performance across different strategies
   */
  async compareStrategies(
    pair: string,
    strategiesConfig: StrategyConfig[],
    period: string = '30d',
    startDate?: string,
    endDate?: string
  ): Promise<StrategyComparisonResult> {
    try {
      const results = [];
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for strategy comparison: from ${startDate} to ${endDate}`);
      }
      
      // Run backtest for each strategy
      for (const config of strategiesConfig) {
        // Run backtest with date parameters if custom period
        const backtest = await backtestService.runBacktest(
          pair, 
          config.parameters, 
          period, 
          undefined, 
          config.parameters.interval,
          period === 'custom' ? startDate : undefined,
          period === 'custom' ? endDate : undefined
        );
        
        // Add to results
        results.push({
          strategyName: config.name,
          strategyType: config.type,
          profitPercentage: backtest.profitPercentage,
          sharpeRatio: backtest.metrics.sharpeRatio,
          maxDrawdown: backtest.metrics.maxDrawdown,
          winRate: backtest.metrics.winRate,
          totalTrades: backtest.metrics.totalTrades,
          averageProfit: backtest.metrics.averageProfit,
          averageLoss: backtest.metrics.averageLoss,
          profitFactor: backtest.metrics.profitFactor
        });
      }
      
      // Sort by profit percentage
      const sortedResults = [...results].sort((a, b) => b.profitPercentage - a.profitPercentage);
      
      return {
        tradingPair: pair,
        period,
        bestStrategy: sortedResults[0].strategyName,
        results: sortedResults
      };
    } catch (error) {
      console.error('Strategy comparison error:', error);
      throw error;
    }
  }
  
  /**
   * Analyze market conditions and backtest performance correlation
   */
  async analyzeMarketConditionImpact(
    pair: string,
    parameters: any,
    period: string = '90d',
    startDate?: string,
    endDate?: string
  ): Promise<MarketConditionAnalysis> {
    try {
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for market condition analysis: from ${startDate} to ${endDate}`);
      }
      
      // Run backtest with date parameters if custom period
      const backtest = await backtestService.runBacktest(
        pair, 
        parameters, 
        period, 
        undefined, 
        parameters.interval,
        period === 'custom' ? startDate : undefined,
        period === 'custom' ? endDate : undefined
      );
      
      // Get trades
      const trades = backtest.trades;
      
      // Define different market conditions
      const conditions = this.identifyMarketConditions(backtest);
      
      // Group trades by market condition
      const groupedTrades = this.groupTradesByCondition(trades, conditions);
      
      // Calculate performance metrics for each condition
      const performanceByCondition = this.calculateConditionPerformance(groupedTrades);
      
      return {
        tradingPair: pair,
        period,
        overallProfit: backtest.profitPercentage,
        marketConditions: conditions,
        performanceByCondition,
        bestCondition: this.findBestCondition(performanceByCondition),
        worstCondition: this.findWorstCondition(performanceByCondition)
      };
    } catch (error) {
      console.error('Market condition analysis error:', error);
      throw error;
    }
  }
  
  /**
   * Walk-forward analysis
   * Splitting data into in-sample and out-of-sample periods for validation
   */
  async runWalkForwardAnalysis(
    pair: string,
    parameters: any,
    totalPeriod: string = '180d',
    folds: number = 3,
    startDate?: string,
    endDate?: string
  ): Promise<WalkForwardResult> {
    try {
      // Log custom date range if provided
      if (totalPeriod === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for walk-forward analysis: from ${startDate} to ${endDate}`);
      }
      
      // Get total backtest data with date parameters if custom period
      const fullBacktest = await backtestService.runBacktest(
        pair, 
        parameters, 
        totalPeriod, 
        undefined, 
        parameters.interval,
        totalPeriod === 'custom' ? startDate : undefined,
        totalPeriod === 'custom' ? endDate : undefined
      );
      
      // Check if there are enough trades for walk-forward analysis
      if (fullBacktest.trades.length < 10) {
        throw new Error(`Not enough trades for walk-forward analysis. Need at least 10, but got ${fullBacktest.trades.length}.`);
      }
      
      // Adjust folds if we don't have enough trades
      const minTradesPerFold = 3; // Minimum trades required per fold
      const recommendedMaxFolds = Math.floor(fullBacktest.trades.length / (minTradesPerFold * 2)); // Each fold needs in-sample and out-sample
      
      if (recommendedMaxFolds < folds) {
        console.warn(`Reducing folds from ${folds} to ${recommendedMaxFolds} due to limited trade data`);
        folds = Math.max(2, recommendedMaxFolds); // Minimum 2 folds
      }
      
      // Split data into periods
      const periods = this.splitIntoFolds(fullBacktest, folds);
      
      // Validate we have enough periods
      if (periods.length === 0) {
        throw new Error(`Could not create any valid folds for walk-forward analysis with ${fullBacktest.trades.length} trades.`);
      }
      
      const results = [];
      
      // Run walk-forward analysis on each valid fold
      for (let i = 0; i < periods.length; i++) {
        // Use in-sample for optimization (would normally optimize parameters here)
        const inSample = periods[i].inSample;
        
        // Use out-of-sample for validation
        const outSample = periods[i].outSample;
        
        // Add result
        results.push({
          fold: i + 1,
          inSampleProfit: inSample.profitPercentage,
          outSampleProfit: outSample.profitPercentage,
          inSampleTrades: inSample.trades.length,
          outSampleTrades: outSample.trades.length,
          robustnessScore: this.calculateRobustnessScore(inSample, outSample)
        });
      }
      
      // Calculate overall robustness
      const overallRobustness = results.length > 0 
        ? results.reduce((sum, r) => sum + r.robustnessScore, 0) / results.length
        : 0;
      
      return {
        tradingPair: pair,
        totalPeriod,
        actualFolds: periods.length, // Return the actual number of folds used
        requestedFolds: folds, // Also return the originally requested number
        folds: periods.length, // For backward compatibility
        results,
        overallRobustness,
        robust: overallRobustness > 0.7, // 70% threshold for considering it robust
        totalTrades: fullBacktest.trades.length
      };
    } catch (error) {
      console.error('Walk-forward analysis error:', error);
      throw error;
    }
  }
  
  /**
   * Run Monte Carlo simulation to estimate risk profiles
   */
  async runMonteCarloSimulation(
    pair: string,
    parameters: any,
    period: string = '90d',
    simulations: number = 1000,
    startDate?: string,
    endDate?: string
  ): Promise<MonteCarloResult> {
    try {
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for Monte Carlo simulation: from ${startDate} to ${endDate}`);
      }
      
      // Run backtest with date parameters if custom period
      const backtest = await backtestService.runBacktest(
        pair, 
        parameters, 
        period, 
        undefined, 
        parameters.interval,
        period === 'custom' ? startDate : undefined,
        period === 'custom' ? endDate : undefined
      );
      
      // Extract trade results
      const tradeResults = backtest.trades.map(trade => trade.profitPercentage);
      
      // Run Monte Carlo simulations
      const simulationResults = this.runMonteCarlo(tradeResults, simulations);
      
      // Calculate key risk metrics
      const riskMetrics = this.calculateRiskMetrics(simulationResults);
      
      return {
        tradingPair: pair,
        period,
        simulations,
        actualProfit: backtest.profitPercentage,
        riskMetrics,
        confidenceIntervals: this.calculateConfidenceIntervals(simulationResults),
        drawdownDistribution: this.calculateDrawdownDistribution(simulationResults),
        profitDistribution: this.calculateProfitDistribution(simulationResults)
      };
    } catch (error) {
      console.error('Monte Carlo simulation error:', error);
      throw error;
    }
  }
  
  // Private helper methods
  
  /**
   * Enhance basic backtest result with additional metrics
   */
  private enhanceBacktestResult(basicResult: BacktestResult): EnhancedBacktestResult {
    // Calculate additional metrics
    const additionalMetrics = {
      expectancy: this.calculateExpectancy(basicResult),
      systemQuality: this.calculateSystemQuality(basicResult),
      recoveryFactor: this.calculateRecoveryFactor(basicResult),
      payoffRatio: this.calculatePayoffRatio(basicResult),
      profitFactor: basicResult.metrics.profitFactor,
      kellyPercentage: this.calculateKellyPercentage(basicResult),
      riskOfRuin: this.calculateRiskOfRuin(basicResult),
      tradingFrequency: this.calculateTradingFrequency(basicResult),
      annualizedReturn: this.calculateAnnualizedReturn(basicResult),
    };
    
    // Calculate drawdown periods
    const drawdownPeriods = this.calculateDrawdownPeriods(basicResult);
    
    // Analyze trade distribution
    const tradeDistribution = this.analyzeTradeDistribution(basicResult.trades);
    
    // Build enhanced result
    return {
      ...basicResult,
      enhancedMetrics: additionalMetrics,
      drawdownPeriods,
      tradeDistribution,
      monthlyPerformance: this.calculateMonthlyPerformance(basicResult),
      dailyPerformance: this.calculateDailyPerformance(basicResult),
      profitCurve: basicResult.equity,
      riskReturnRatio: additionalMetrics.annualizedReturn / (basicResult.metrics.maxDrawdown || 1),
      consecutiveTrades: this.analyzeConsecutiveTrades(basicResult.trades),
      tradeAnalytics: this.generateTradeAnalytics(basicResult.trades)
    };
  }
  
  /**
   * Save backtest result to database
   */
  private async saveBacktestResult(
    botId: number, 
    pair: string, 
    parameters: any, 
    period: string, 
    result: EnhancedBacktestResult
  ): Promise<void> {
    // Get bot
    const bot = await storage.getBot(botId);
    if (!bot) {
      throw new Error(`Bot with ID ${botId} not found`);
    }
    
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
      timeframe: this.periodToTimeframe(period),
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
    
    // Save to database
    await storage.createBacktestResult(dbResult);
  }
  
  /**
   * Convert period string to timeframe
   */
  private periodToTimeframe(period: string): string {
    const match = period.match(/(\d+)([dhm])/);
    if (!match) return '1d';
    
    const unit = match[2];
    
    switch (unit) {
      case 'm': return '1m';
      case 'h': return '1h';
      case 'd': return '1d';
      default: return '1d';
    }
  }
  
  /**
   * Calculate expectancy (average profit/loss per trade)
   */
  private calculateExpectancy(result: BacktestResult): number {
    const winRate = result.metrics.winRate / 100;
    const avgWin = result.metrics.averageProfit;
    const avgLoss = Math.abs(result.metrics.averageLoss);
    
    return (winRate * avgWin) - ((1 - winRate) * avgLoss);
  }
  
  /**
   * Calculate system quality number
   */
  private calculateSystemQuality(result: BacktestResult): number {
    const expectancy = this.calculateExpectancy(result);
    
    // Calculate standard deviation of trade results
    const trades = result.trades;
    const profitValues = trades.map(t => t.profitPercentage);
    const avgProfit = profitValues.reduce((sum, val) => sum + val, 0) / profitValues.length;
    const variance = profitValues.reduce((sum, val) => sum + Math.pow(val - avgProfit, 2), 0) / profitValues.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Prevent division by zero
    if (standardDeviation === 0) return 0;
    
    return expectancy / standardDeviation;
  }
  
  /**
   * Calculate recovery factor
   */
  private calculateRecoveryFactor(result: BacktestResult): number {
    // Prevent division by zero
    if (result.metrics.maxDrawdown === 0) return 0;
    
    return result.profitPercentage / result.metrics.maxDrawdown;
  }
  
  /**
   * Calculate payoff ratio (average win / average loss)
   */
  private calculatePayoffRatio(result: BacktestResult): number {
    // Prevent division by zero
    if (result.metrics.averageLoss === 0) return 0;
    
    return result.metrics.averageProfit / Math.abs(result.metrics.averageLoss);
  }
  
  /**
   * Calculate Kelly percentage
   */
  private calculateKellyPercentage(result: BacktestResult): number {
    const winRate = result.metrics.winRate / 100;
    const payoffRatio = this.calculatePayoffRatio(result);
    
    return ((winRate * payoffRatio) - (1 - winRate)) / payoffRatio;
  }
  
  /**
   * Calculate risk of ruin
   */
  private calculateRiskOfRuin(result: BacktestResult): number {
    const winRate = result.metrics.winRate / 100;
    
    // If win rate is 50%, risk of ruin is 100%
    if (winRate <= 0.5) return 1.0;
    
    const payoffRatio = this.calculatePayoffRatio(result);
    const riskPerTrade = 0.02; // Assume 2% risk per trade
    
    // Calculate risk of ruin using exponential formula
    return Math.pow((1 - winRate) / winRate, result.metrics.totalTrades);
  }
  
  /**
   * Calculate trading frequency
   */
  private calculateTradingFrequency(result: BacktestResult): number {
    // Need timestamps from trades to calculate this accurately
    // Here we'll estimate based on 30 days
    const daysElapsed = 30;
    return result.metrics.totalTrades / daysElapsed;
  }
  
  /**
   * Calculate annualized return
   */
  private calculateAnnualizedReturn(result: BacktestResult): number {
    // Estimate based on 30 days period
    const daysElapsed = 30;
    const yearsElapsed = daysElapsed / 365;
    
    // Calculate annualized return
    return Math.pow(1 + result.profitPercentage / 100, 1 / yearsElapsed) - 1;
  }
  
  /**
   * Calculate drawdown periods
   */
  private calculateDrawdownPeriods(result: BacktestResult): DrawdownPeriod[] {
    const equity = result.equity;
    const timestamps = result.timestamps || [];
    
    const drawdownPeriods: DrawdownPeriod[] = [];
    let inDrawdown = false;
    let drawdownStart = 0;
    let drawdownStartValue = 0;
    let currentMax = equity[0];
    let maxDrawdown = 0;
    let maxDrawdownValue = 0;
    
    for (let i = 0; i < equity.length; i++) {
      // Update max equity
      if (equity[i] > currentMax) {
        currentMax = equity[i];
        
        // If we were in a drawdown and now we're at a new high, the drawdown is over
        if (inDrawdown) {
          // Calculate drawdown metrics
          const drawdownAmount = drawdownStartValue - maxDrawdownValue;
          const drawdownPercent = (drawdownAmount / drawdownStartValue) * 100;
          const duration = timestamps[i] - timestamps[drawdownStart];
          
          // Add drawdown period to array
          drawdownPeriods.push({
            startIndex: drawdownStart,
            endIndex: i,
            startTime: timestamps[drawdownStart],
            endTime: timestamps[i],
            durationMs: duration,
            durationDays: duration / (24 * 60 * 60 * 1000),
            drawdownPercent,
            drawdownAmount,
            recoveryTime: duration
          });
          
          // Reset drawdown tracking
          inDrawdown = false;
        }
      } else if (equity[i] < currentMax) {
        // We're in a drawdown
        
        // If this is the start of a new drawdown, record it
        if (!inDrawdown) {
          inDrawdown = true;
          drawdownStart = i;
          drawdownStartValue = currentMax;
          maxDrawdown = currentMax - equity[i];
          maxDrawdownValue = equity[i];
        } else {
          // We're continuing a drawdown, check if it's deepened
          const currentDrawdown = currentMax - equity[i];
          if (currentDrawdown > maxDrawdown) {
            maxDrawdown = currentDrawdown;
            maxDrawdownValue = equity[i];
          }
        }
      }
    }
    
    // If we end in a drawdown, add that period too
    if (inDrawdown && equity.length > 0) {
      const lastIndex = equity.length - 1;
      const drawdownAmount = drawdownStartValue - maxDrawdownValue;
      const drawdownPercent = (drawdownAmount / drawdownStartValue) * 100;
      const duration = timestamps[lastIndex] - timestamps[drawdownStart];
      
      drawdownPeriods.push({
        startIndex: drawdownStart,
        endIndex: lastIndex,
        startTime: timestamps[drawdownStart],
        endTime: timestamps[lastIndex],
        durationMs: duration,
        durationDays: duration / (24 * 60 * 60 * 1000),
        drawdownPercent,
        drawdownAmount,
        recoveryTime: null // Still in drawdown, no recovery
      });
    }
    
    return drawdownPeriods;
  }
  
  /**
   * Analyze trade distribution
   */
  private analyzeTradeDistribution(trades: BacktestTrade[]): TradeDistribution {
    const profitRanges = [
      { min: -100, max: -20, count: 0 },
      { min: -20, max: -10, count: 0 },
      { min: -10, max: -5, count: 0 },
      { min: -5, max: 0, count: 0 },
      { min: 0, max: 5, count: 0 },
      { min: 5, max: 10, count: 0 },
      { min: 10, max: 20, count: 0 },
      { min: 20, max: 100, count: 0 },
    ];
    
    // Count trades in each range
    trades.forEach(trade => {
      const profit = trade.profitPercentage;
      
      for (const range of profitRanges) {
        if (profit >= range.min && profit < range.max) {
          range.count++;
          break;
        }
      }
    });
    
    // Calculate time-based distribution (hourly and daily)
    const hourlyDistribution: Record<number, number> = {};
    const dayOfWeekDistribution: Record<number, number> = {};
    
    // Initialize with zeros
    for (let i = 0; i < 24; i++) hourlyDistribution[i] = 0;
    for (let i = 0; i < 7; i++) dayOfWeekDistribution[i] = 0;
    
    // Populate distributions
    trades.forEach(trade => {
      const date = new Date(trade.timestamp);
      const hour = date.getHours();
      const dayOfWeek = date.getDay();
      
      hourlyDistribution[hour]++;
      dayOfWeekDistribution[dayOfWeek]++;
    });
    
    return {
      profitRanges,
      hourlyDistribution,
      dayOfWeekDistribution,
      totalTrades: trades.length
    };
  }
  
  /**
   * Calculate monthly performance breakdown
   */
  private calculateMonthlyPerformance(result: BacktestResult): MonthlyPerformance[] {
    const trades = result.trades;
    const monthlyData: Record<string, MonthlyPerformance> = {};
    
    // Group trades by month
    trades.forEach(trade => {
      const date = new Date(trade.timestamp);
      const monthYear = `${date.getFullYear()}-${date.getMonth() + 1}`;
      
      if (!monthlyData[monthYear]) {
        monthlyData[monthYear] = {
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          profit: 0,
          profitPercentage: 0,
          trades: 0,
          winningTrades: 0,
          losingTrades: 0
        };
      }
      
      // Update month data
      monthlyData[monthYear].trades++;
      monthlyData[monthYear].profit += trade.profit;
      
      if (trade.profitPercentage > 0) {
        monthlyData[monthYear].winningTrades++;
      } else {
        monthlyData[monthYear].losingTrades++;
      }
    });
    
    // Calculate percentages and convert to array
    const monthlyPerformance = Object.values(monthlyData);
    
    // Sort by date
    monthlyPerformance.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
    
    return monthlyPerformance;
  }
  
  /**
   * Calculate daily performance breakdown
   */
  private calculateDailyPerformance(result: BacktestResult): DailyPerformance[] {
    const trades = result.trades;
    const dailyData: Record<string, DailyPerformance> = {};
    
    // Group trades by day
    trades.forEach(trade => {
      const date = new Date(trade.timestamp);
      const dayKey = date.toISOString().split('T')[0];
      
      if (!dailyData[dayKey]) {
        dailyData[dayKey] = {
          date: dayKey,
          profit: 0,
          profitPercentage: 0,
          trades: 0,
          winningTrades: 0,
          losingTrades: 0
        };
      }
      
      // Update day data
      dailyData[dayKey].trades++;
      dailyData[dayKey].profit += trade.profit;
      
      if (trade.profitPercentage > 0) {
        dailyData[dayKey].winningTrades++;
      } else {
        dailyData[dayKey].losingTrades++;
      }
    });
    
    // Convert to array and sort by date
    const dailyPerformance = Object.values(dailyData).sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    
    return dailyPerformance;
  }
  
  /**
   * Analyze consecutive winning and losing trades
   */
  private analyzeConsecutiveTrades(trades: BacktestTrade[]): ConsecutiveTradeAnalysis {
    let currentWinStreak = 0;
    let currentLoseStreak = 0;
    let maxWinStreak = 0;
    let maxLoseStreak = 0;
    let totalStreaks = 0;
    
    // Track current streak
    let inWinStreak = false;
    let inLoseStreak = false;
    
    // Analyze trades
    trades.forEach(trade => {
      const isWin = trade.profitPercentage > 0;
      
      if (isWin) {
        if (inWinStreak) {
          // Continue win streak
          currentWinStreak++;
        } else {
          // Start new win streak
          if (inLoseStreak) {
            // End previous lose streak
            maxLoseStreak = Math.max(maxLoseStreak, currentLoseStreak);
            totalStreaks++;
          }
          inWinStreak = true;
          inLoseStreak = false;
          currentWinStreak = 1;
        }
      } else {
        if (inLoseStreak) {
          // Continue lose streak
          currentLoseStreak++;
        } else {
          // Start new lose streak
          if (inWinStreak) {
            // End previous win streak
            maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
            totalStreaks++;
          }
          inLoseStreak = true;
          inWinStreak = false;
          currentLoseStreak = 1;
        }
      }
    });
    
    // Handle final streak
    if (inWinStreak) {
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      totalStreaks++;
    } else if (inLoseStreak) {
      maxLoseStreak = Math.max(maxLoseStreak, currentLoseStreak);
      totalStreaks++;
    }
    
    return {
      maxConsecutiveWins: maxWinStreak,
      maxConsecutiveLosses: maxLoseStreak,
      totalStreaks,
      streakAnalysis: `Max ${maxWinStreak} consecutive wins, Max ${maxLoseStreak} consecutive losses`
    };
  }
  
  /**
   * Generate detailed trade analytics
   */
  private generateTradeAnalytics(trades: BacktestTrade[]): TradeAnalytics {
    // Calculate average trade duration
    let totalDuration = 0;
    let tradesWithDuration = 0;
    
    trades.forEach(trade => {
      if (trade.entryPrice && trade.exitPrice) {
        const entryTime = trade.timestamp;
        const exitTime = trade.closedAt || 0; // Might not be available
        
        if (exitTime > 0) {
          totalDuration += exitTime - entryTime;
          tradesWithDuration++;
        }
      }
    });
    
    const averageDurationMs = tradesWithDuration > 0 ? totalDuration / tradesWithDuration : 0;
    
    // Calculate trade size distribution
    const tradeSizes = trades.map(trade => trade.amount);
    const minSize = Math.min(...tradeSizes);
    const maxSize = Math.max(...tradeSizes);
    const avgSize = tradeSizes.reduce((sum, size) => sum + size, 0) / tradeSizes.length;
    
    // Calculate performance by trade size
    const smallTrades = trades.filter(t => t.amount < avgSize * 0.8);
    const mediumTrades = trades.filter(t => t.amount >= avgSize * 0.8 && t.amount <= avgSize * 1.2);
    const largeTrades = trades.filter(t => t.amount > avgSize * 1.2);
    
    const calculateWinRate = (tradeSet: BacktestTrade[]) => {
      if (tradeSet.length === 0) return 0;
      const wins = tradeSet.filter(t => t.profitPercentage > 0).length;
      return (wins / tradeSet.length) * 100;
    };
    
    return {
      averageTradeDurationMs: averageDurationMs,
      averageTradeDurationHours: averageDurationMs / (1000 * 60 * 60),
      tradeFrequency: trades.length / 30, // Trades per day assuming 30 day period
      sizingAnalysis: {
        minSize,
        maxSize,
        avgSize,
        smallTradesCount: smallTrades.length,
        mediumTradesCount: mediumTrades.length,
        largeTradesCount: largeTrades.length,
        smallTradesWinRate: calculateWinRate(smallTrades),
        mediumTradesWinRate: calculateWinRate(mediumTrades),
        largeTradesWinRate: calculateWinRate(largeTrades)
      },
      profitConsistency: this.calculateProfitConsistency(trades)
    };
  }
  
  /**
   * Calculate profit consistency metrics
   */
  private calculateProfitConsistency(trades: BacktestTrade[]): number {
    const profits = trades.map(t => t.profitPercentage);
    const mean = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    
    // Calculate standard deviation
    const variance = profits.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / profits.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation (lower means more consistent)
    return Math.abs(mean) > 0.0001 ? stdDev / Math.abs(mean) : 999;
  }
  
  /**
   * Generate parameter sets based on parameter ranges
   */
  private generateParameterSets(baseParameters: any, parameterRanges: ParameterRange[]): any[] {
    // Start with base parameters
    const result = [JSON.parse(JSON.stringify(baseParameters))]; // Deep clone to avoid reference issues
    
    // Generate parameter combinations
    for (const range of parameterRanges) {
      const { parameter, start, end, step } = range;
      const newResults = [];
      
      // Check if parameter is nested (contains dots)
      const isNested = parameter.includes('.');
      
      // Loop through existing results
      for (const params of result) {
        // Loop through parameter range
        for (let value = start; value <= end; value += step) {
          // Create a deep copy of params to avoid reference issues
          const newParams = JSON.parse(JSON.stringify(params));
          
          if (isNested) {
            // Handle nested parameters (e.g., "bollinger.period")
            const parts = parameter.split('.');
            let current = newParams;
            
            // Navigate to the nested object
            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i];
              // Create nested object if it doesn't exist
              if (!current[part]) {
                current[part] = {};
              }
              current = current[part];
            }
            
            // Set the value in the nested object
            current[parts[parts.length - 1]] = value;
          } else {
            // Simple case: direct parameter assignment
            newParams[parameter] = value;
          }
          
          newResults.push(newParams);
        }
      }
      
      // Replace result with new combinations
      if (newResults.length > 0) {
        result.length = 0;
        result.push(...newResults);
      }
    }

    // Log the generated parameter sets
    console.log(`Generated ${result.length} unique parameter sets`);
    
    return result;
  }
  
  /**
   * Calculate appropriate period for timeframe
   */
  private calculatePeriodForTimeframe(timeframe: string): string {
    if (timeframe.includes('m')) {
      // For minute timeframes, use hours or days
      const minutes = parseInt(timeframe);
      if (minutes < 5) return '12h';
      if (minutes < 15) return '1d';
      return '3d';
    } else if (timeframe.includes('h')) {
      // For hour timeframes, use days
      const hours = parseInt(timeframe);
      if (hours < 4) return '7d';
      return '14d';
    } else if (timeframe.includes('d')) {
      // For day timeframes, use longer periods
      return '90d';
    }
    
    // Default
    return '30d';
  }
  
  /**
   * Calculate timeframe consistency
   */
  private calculateTimeframeConsistency(results: TimeframeResult[]): string {
    // Check if all results are profitable
    const allProfitable = results.every(r => r.profitPercentage > 0);
    
    // Check if all results have similar win rates
    const winRates = results.map(r => r.winRate);
    const avgWinRate = winRates.reduce((sum, wr) => sum + wr, 0) / winRates.length;
    const winRateConsistent = winRates.every(wr => Math.abs(wr - avgWinRate) < 15);
    
    if (allProfitable && winRateConsistent) {
      return 'High consistency across timeframes';
    } else if (allProfitable) {
      return 'Profitable across timeframes but inconsistent win rates';
    } else {
      return 'Inconsistent performance across timeframes';
    }
  }
  
  /**
   * Calculate consistency score
   */
  private calculateConsistencyScore(results: TimeframeResult[]): number {
    // Calculate profit correlation
    const profits = results.map(r => r.profitPercentage);
    const meanProfit = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    
    // Calculate variance
    const variance = profits.reduce((sum, p) => sum + Math.pow(p - meanProfit, 2), 0) / profits.length;
    
    // Lower variance means higher consistency
    return Math.max(0, 1 - (Math.sqrt(variance) / Math.abs(meanProfit)));
  }
  
  /**
   * Identify market conditions
   */
  private identifyMarketConditions(backtest: BacktestResult): MarketCondition[] {
    // We need price data for proper analysis
    // Here we're estimating based on trade information
    const result: MarketCondition[] = [];
    const trades = backtest.trades;
    
    // Group trades in chunks
    const tradeChunks: BacktestTrade[][] = [];
    const chunkSize = Math.max(5, Math.floor(trades.length / 5));
    
    for (let i = 0; i < trades.length; i += chunkSize) {
      tradeChunks.push(trades.slice(i, i + chunkSize));
    }
    
    // Analyze each chunk
    tradeChunks.forEach((chunk, i) => {
      // Determine start and end of period
      const startTime = chunk[0].timestamp;
      const endTime = chunk[chunk.length - 1].timestamp;
      
      // Determine trend and volatility
      const prices = chunk.map(t => t.entryPrice);
      const startPrice = prices[0];
      const endPrice = prices[prices.length - 1];
      const priceChange = ((endPrice - startPrice) / startPrice) * 100;
      
      // Calculate volatility
      let sumDelta = 0;
      for (let j = 1; j < prices.length; j++) {
        sumDelta += Math.abs((prices[j] - prices[j-1]) / prices[j-1]) * 100;
      }
      const avgVolatility = sumDelta / (prices.length - 1);
      
      // Determine market condition
      let trend: 'uptrend' | 'downtrend' | 'sideways' = 'sideways';
      if (priceChange > 5) trend = 'uptrend';
      else if (priceChange < -5) trend = 'downtrend';
      
      let volatility: 'high' | 'medium' | 'low' = 'medium';
      if (avgVolatility > 2) volatility = 'high';
      else if (avgVolatility < 0.5) volatility = 'low';
      
      result.push({
        startTime,
        endTime,
        trend,
        volatility,
        priceChange,
        avgVolatility
      });
    });
    
    return result;
  }
  
  /**
   * Group trades by market condition
   */
  private groupTradesByCondition(
    trades: BacktestTrade[], 
    conditions: MarketCondition[]
  ): Record<string, BacktestTrade[]> {
    const result: Record<string, BacktestTrade[]> = {};
    
    // Initialize result
    conditions.forEach((condition, i) => {
      const key = `${condition.trend}_${condition.volatility}_${i}`;
      result[key] = [];
    });
    
    // Sort trades into conditions
    trades.forEach(trade => {
      // Find the condition this trade belongs to
      for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];
        
        if (trade.timestamp >= condition.startTime && 
            trade.timestamp <= condition.endTime) {
          // Trade belongs to this condition
          const key = `${condition.trend}_${condition.volatility}_${i}`;
          result[key].push(trade);
          break;
        }
      }
    });
    
    return result;
  }
  
  /**
   * Calculate performance by market condition
   */
  private calculateConditionPerformance(
    groupedTrades: Record<string, BacktestTrade[]>
  ): Record<string, ConditionPerformance> {
    const result: Record<string, ConditionPerformance> = {};
    
    // Calculate performance for each condition
    for (const [key, trades] of Object.entries(groupedTrades)) {
      if (trades.length === 0) continue;
      
      const [trend, volatility] = key.split('_');
      
      // Calculate metrics
      const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
      const winningTrades = trades.filter(t => t.profitPercentage > 0);
      const losingTrades = trades.filter(t => t.profitPercentage <= 0);
      
      result[key] = {
        marketCondition: `${trend} with ${volatility} volatility`,
        trades: trades.length,
        totalProfit,
        profitPercentage: (totalProfit / trades.length) * 100,
        winRate: (winningTrades.length / trades.length) * 100,
        averageProfit: winningTrades.length > 0 
          ? winningTrades.reduce((sum, t) => sum + t.profit, 0) / winningTrades.length 
          : 0,
        averageLoss: losingTrades.length > 0 
          ? losingTrades.reduce((sum, t) => sum + t.profit, 0) / losingTrades.length 
          : 0
      };
    }
    
    return result;
  }
  
  /**
   * Find best market condition
   */
  private findBestCondition(
    performances: Record<string, ConditionPerformance>
  ): string {
    let bestKey = '';
    let bestProfit = -Infinity;
    
    for (const [key, perf] of Object.entries(performances)) {
      if (perf.totalProfit > bestProfit) {
        bestProfit = perf.totalProfit;
        bestKey = key;
      }
    }
    
    return performances[bestKey]?.marketCondition || 'Unknown';
  }
  
  /**
   * Find worst market condition
   */
  private findWorstCondition(
    performances: Record<string, ConditionPerformance>
  ): string {
    let worstKey = '';
    let worstProfit = Infinity;
    
    for (const [key, perf] of Object.entries(performances)) {
      if (perf.totalProfit < worstProfit) {
        worstProfit = perf.totalProfit;
        worstKey = key;
      }
    }
    
    return performances[worstKey]?.marketCondition || 'Unknown';
  }
  
  /**
   * Split backtest data into in-sample and out-of-sample periods
   */
  private splitIntoFolds(backtest: BacktestResult, folds: number): WalkForwardFold[] {
    const result: WalkForwardFold[] = [];
    const trades = [...backtest.trades];
    
    // Ensure we have trades
    if (!trades || trades.length === 0) {
      console.warn("No trades available for walk-forward analysis");
      return [];
    }
    
    // Sort trades by timestamp
    trades.sort((a, b) => a.timestamp - b.timestamp);
    
    // Calculate fold size - each fold needs enough trades for meaningful analysis
    const minTradesPerInSample = 2;
    const minTradesPerOutSample = 1;
    const minTradesPerFold = minTradesPerInSample + minTradesPerOutSample;
    
    // Check if we have enough trades for the requested number of folds
    if (trades.length < folds * minTradesPerFold) {
      console.warn(`Not enough trades (${trades.length}) for ${folds} folds. Need at least ${folds * minTradesPerFold}.`);
      // Adjust folds to max possible
      folds = Math.max(2, Math.floor(trades.length / minTradesPerFold));
      console.warn(`Adjusted to ${folds} folds.`);
    }
    
    // Calculate fold size
    const foldSize = Math.floor(trades.length / folds);
    
    // Ensure fold size is at least minTradesPerInSample
    if (foldSize < minTradesPerInSample) {
      console.warn(`Fold size too small (${foldSize}). Cannot perform walk-forward analysis.`);
      return [];
    }
    
    // Create folds
    for (let i = 0; i < folds; i++) {
      // Determine in-sample and out-of-sample ranges
      const inSampleStart = i * foldSize;
      const inSampleEnd = (i + 1) * foldSize - 1;
      const outSampleStart = inSampleEnd + 1;
      
      // Calculate out-sample size (usually 50% of in-sample size but adapt for last fold)
      const outSampleSize = Math.min(
        Math.floor(foldSize / 2), // Regular case: half of in-sample
        trades.length - outSampleStart // Remaining trades for last fold
      );
      
      const outSampleEnd = outSampleStart + outSampleSize - 1;
      
      // Check if we have enough data for out-of-sample
      if (outSampleStart >= trades.length || outSampleEnd < outSampleStart) {
        console.warn(`Not enough out-of-sample data for fold ${i + 1}. Skipping.`);
        continue;
      }
      
      // Check if we have minimum required trades
      if ((inSampleEnd - inSampleStart + 1) < minTradesPerInSample || 
          (outSampleEnd - outSampleStart + 1) < minTradesPerOutSample) {
        console.warn(`Fold ${i + 1} has insufficient trades. Skipping.`);
        continue;
      }
      
      // Create in-sample and out-of-sample trade sets
      const inSampleTrades = trades.slice(inSampleStart, inSampleEnd + 1);
      const outSampleTrades = trades.slice(outSampleStart, outSampleEnd + 1);
      
      if (inSampleTrades.length === 0 || outSampleTrades.length === 0) {
        console.warn(`Empty trade set in fold ${i + 1}. Skipping.`);
        continue;
      }
      
      try {
        // Create simulated backtest results
        const inSample = this.createPartialBacktestResult(inSampleTrades);
        const outSample = this.createPartialBacktestResult(outSampleTrades);
        
        // Validate the created backtest results
        if (!inSample || !outSample || 
            !Array.isArray(inSample.trades) || !Array.isArray(outSample.trades)) {
          console.warn(`Invalid backtest results for fold ${i + 1}. Skipping.`);
          continue;
        }
        
        result.push({ inSample, outSample });
      } catch (error) {
        console.error(`Error creating backtest results for fold ${i + 1}:`, error);
        continue;
      }
    }
    
    return result;
  }
  
  /**
   * Create a partial backtest result from a subset of trades
   */
  private createPartialBacktestResult(trades: BacktestTrade[]): BacktestResult {
    // Calculate basic metrics
    const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
    const initialValue = 10000; // Assume starting capital
    const profitPercentage = (totalProfit / initialValue) * 100;
    
    const winningTrades = trades.filter(t => t.profitPercentage > 0);
    const losingTrades = trades.filter(t => t.profitPercentage <= 0);
    
    // Calculate win rate
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    
    // Calculate average profit/loss
    const averageProfit = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + t.profitPercentage, 0) / winningTrades.length 
      : 0;
    
    const averageLoss = losingTrades.length > 0 
      ? losingTrades.reduce((sum, t) => sum + t.profitPercentage, 0) / losingTrades.length 
      : 0;
    
    // Calculate profit factor
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    
    // Calculate max consecutive losses
    let currentLossStreak = 0;
    let maxConsecutiveLosses = 0;
    
    for (const trade of trades) {
      if (trade.profitPercentage <= 0) {
        currentLossStreak++;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
      } else {
        currentLossStreak = 0;
      }
    }
    
    // Create simulated equity curve
    const equity = [initialValue];
    const timestamps = trades.length > 0 ? [trades[0].timestamp] : [Date.now()];
    
    for (const trade of trades) {
      const lastEquity = equity[equity.length - 1];
      equity.push(lastEquity + trade.profit);
      timestamps.push(trade.timestamp);
    }
    
    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = equity[0];
    
    for (const value of equity) {
      if (value > peak) {
        peak = value;
      } else {
        const drawdown = ((peak - value) / peak) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }
    }
    
    // Calculate Sharpe ratio (simplified)
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i] - equity[i-1]) / equity[i-1]);
    }
    
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
    );
    
    const sharpeRatio = stdDev > 0 ? meanReturn / stdDev * Math.sqrt(252) : 0; // Annualized
    
    return {
      tradingPair: 'PARTIAL',
      profit: totalProfit,
      profitPercentage,
      trades,
      metrics: {
        totalTrades: trades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        maxDrawdown,
        sharpeRatio,
        profitFactor,
        averageProfit,
        averageLoss,
        maxConsecutiveLosses,
        // Add missing properties required by the BacktestMetrics interface
        largestProfit: winningTrades.length > 0 
          ? Math.max(...winningTrades.map(t => t.profitPercentage)) 
          : 0,
        largestLoss: losingTrades.length > 0 
          ? Math.min(...losingTrades.map(t => t.profitPercentage)) 
          : 0,
        maxConsecutiveWins: this.calculateMaxConsecutiveWins(trades)
      },
      equity,
      timestamps
    };
  }
  
  /**
   * Calculate robustness score between in-sample and out-of-sample
   */
  private calculateRobustnessScore(inSample: BacktestResult, outSample: BacktestResult): number {
    // Factors to consider:
    // 1. Both periods should be profitable
    // 2. Win rates should be similar
    // 3. Average profit/loss should be similar
    
    // Check if both are profitable
    const bothProfitable = inSample.profitPercentage > 0 && outSample.profitPercentage > 0;
    
    // Compare win rates
    const winRateDiff = Math.abs(inSample.metrics.winRate - outSample.metrics.winRate);
    const winRateSimilarity = 1 - (winRateDiff / 100);
    
    // Compare profit/loss
    const profitPercentageDiff = Math.abs(inSample.profitPercentage - outSample.profitPercentage);
    const profitSimilarity = 1 - (profitPercentageDiff / Math.max(Math.abs(inSample.profitPercentage), Math.abs(outSample.profitPercentage)));
    
    // Weightings
    const weights = {
      profitable: 0.5,
      winRate: 0.25,
      profit: 0.25
    };
    
    // Calculate score
    let score = (
      (bothProfitable ? 1 : 0) * weights.profitable +
      winRateSimilarity * weights.winRate +
      profitSimilarity * weights.profit
    );
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Run Monte Carlo simulation
   */
  private runMonteCarlo(
    tradeResults: number[], 
    simulations: number
  ): number[][] {
    const result: number[][] = [];
    
    // Run simulations
    for (let i = 0; i < simulations; i++) {
      // Generate randomized trade results
      const simulatedTrades = this.shuffleArray([...tradeResults]);
      
      // Create equity curve
      const equity = [100]; // Start with 100%
      
      // Apply trades
      for (const tradeResult of simulatedTrades) {
        const lastEquity = equity[equity.length - 1];
        equity.push(lastEquity * (1 + tradeResult / 100));
      }
      
      result.push(equity);
    }
    
    return result;
  }
  
  /**
   * Calculate maximum consecutive winning trades
   */
  private calculateMaxConsecutiveWins(trades: BacktestTrade[]): number {
    let currentWinStreak = 0;
    let maxConsecutiveWins = 0;
    
    for (const trade of trades) {
      if (trade.profitPercentage > 0) {
        currentWinStreak++;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
      } else {
        currentWinStreak = 0;
      }
    }
    
    return maxConsecutiveWins;
  }
  
  /**
   * Shuffle array randomly (Fisher-Yates)
   */
  private shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    
    return result;
  }
  
  /**
   * Calculate risk metrics from Monte Carlo simulation
   */
  private calculateRiskMetrics(simulationResults: number[][]): RiskMetrics {
    // Extract final equity values
    const finalValues = simulationResults.map(sim => sim[sim.length - 1]);
    
    // Sort values
    finalValues.sort((a, b) => a - b);
    
    // Calculate percentiles
    const percentile = (p: number) => {
      const index = Math.floor(finalValues.length * p / 100);
      return finalValues[index];
    };
    
    // Calculate max drawdowns
    const maxDrawdowns = simulationResults.map(equity => {
      let maxDrawdown = 0;
      let peak = equity[0];
      
      for (const value of equity) {
        if (value > peak) {
          peak = value;
        } else {
          const drawdown = ((peak - value) / peak) * 100;
          maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
      }
      
      return maxDrawdown;
    });
    
    // Calculate drawdown statistics
    maxDrawdowns.sort((a, b) => a - b);
    
    // Calculate losing probability
    const losers = finalValues.filter(val => val < 100).length;
    const losingProbability = (losers / finalValues.length) * 100;
    
    return {
      finalValue: {
        mean: finalValues.reduce((sum, val) => sum + val, 0) / finalValues.length,
        median: percentile(50),
        min: finalValues[0],
        max: finalValues[finalValues.length - 1],
        percentile5: percentile(5),
        percentile95: percentile(95)
      },
      maxDrawdown: {
        mean: maxDrawdowns.reduce((sum, val) => sum + val, 0) / maxDrawdowns.length,
        median: maxDrawdowns[Math.floor(maxDrawdowns.length * 0.5)],
        percentile95: maxDrawdowns[Math.floor(maxDrawdowns.length * 0.95)],
        max: maxDrawdowns[maxDrawdowns.length - 1]
      },
      losingProbability,
      profitProbability: 100 - losingProbability,
      probabilityAnalysis: `${(100 - losingProbability).toFixed(1)}% chance of profit, ${losingProbability.toFixed(1)}% chance of loss`
    };
  }
  
  /**
   * Calculate confidence intervals from Monte Carlo simulation
   */
  private calculateConfidenceIntervals(simulationResults: number[][]): ConfidenceIntervals {
    // Extract final equity values
    const finalValues = simulationResults.map(sim => sim[sim.length - 1]);
    
    // Sort values
    finalValues.sort((a, b) => a - b);
    
    // Calculate percentiles
    const percentile = (p: number) => {
      const index = Math.floor(finalValues.length * p / 100);
      return finalValues[index];
    };
    
    return {
      ci50: {
        lower: percentile(25),
        upper: percentile(75)
      },
      ci80: {
        lower: percentile(10),
        upper: percentile(90)
      },
      ci95: {
        lower: percentile(2.5),
        upper: percentile(97.5)
      },
      ci99: {
        lower: percentile(0.5),
        upper: percentile(99.5)
      }
    };
  }
  
  /**
   * Calculate drawdown distribution from Monte Carlo simulation
   */
  private calculateDrawdownDistribution(simulationResults: number[][]): number[] {
    // Extract max drawdowns
    const maxDrawdowns = simulationResults.map(equity => {
      let maxDrawdown = 0;
      let peak = equity[0];
      
      for (const value of equity) {
        if (value > peak) {
          peak = value;
        } else {
          const drawdown = ((peak - value) / peak) * 100;
          maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
      }
      
      return maxDrawdown;
    });
    
    // Create histogram bins (0-5%, 5-10%, 10-15%, etc.)
    const bins = Array(20).fill(0);
    
    maxDrawdowns.forEach(dd => {
      const binIndex = Math.min(19, Math.floor(dd / 5));
      bins[binIndex]++;
    });
    
    return bins;
  }
  
  /**
   * Calculate profit distribution from Monte Carlo simulation
   */
  private calculateProfitDistribution(simulationResults: number[][]): number[] {
    // Extract final profits
    const profits = simulationResults.map(sim => {
      const initial = sim[0];
      const final = sim[sim.length - 1];
      return ((final - initial) / initial) * 100;
    });
    
    // Create histogram bins (-50-40%, -40-30%, etc. to +90-100%)
    const bins = Array(15).fill(0);
    
    profits.forEach(profit => {
      // Convert to bin index (-50% to +100% in 10% increments)
      const binIndex = Math.min(14, Math.max(0, Math.floor((profit + 50) / 10)));
      bins[binIndex]++;
    });
    
    return bins;
  }
}

export const enhancedBacktestService = new EnhancedBacktestService();

// Types for enhanced backtesting

export interface EnhancedBacktestResult extends BacktestResult {
  enhancedMetrics: EnhancedMetrics;
  drawdownPeriods: DrawdownPeriod[];
  tradeDistribution: TradeDistribution;
  monthlyPerformance: MonthlyPerformance[];
  dailyPerformance: DailyPerformance[];
  profitCurve: number[];
  riskReturnRatio: number;
  consecutiveTrades: ConsecutiveTradeAnalysis;
  tradeAnalytics: TradeAnalytics;
  aiDiagnosticsEnabled?: boolean; // Flag to indicate if AI diagnostics should be performed
}

export interface EnhancedMetrics {
  expectancy: number; // Average amount expected to win/lose per trade
  systemQuality: number; // Expectancy divided by standard deviation
  recoveryFactor: number; // Net profit divided by max drawdown
  payoffRatio: number; // Average win divided by average loss
  profitFactor: number; // Gross profit divided by gross loss
  kellyPercentage: number; // Kelly criterion for position sizing
  riskOfRuin: number; // Probability of losing entire account
  tradingFrequency: number; // Average number of trades per day
  annualizedReturn: number; // Annualized return
}

export interface DrawdownPeriod {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  durationDays: number;
  drawdownPercent: number;
  drawdownAmount: number;
  recoveryTime: number | null; // null if still in drawdown
}

export interface TradeDistribution {
  profitRanges: {
    min: number;
    max: number;
    count: number;
  }[];
  hourlyDistribution: Record<number, number>;
  dayOfWeekDistribution: Record<number, number>;
  totalTrades: number;
}

export interface MonthlyPerformance {
  year: number;
  month: number;
  profit: number;
  profitPercentage: number;
  trades: number;
  winningTrades: number;
  losingTrades: number;
}

export interface DailyPerformance {
  date: string;
  profit: number;
  profitPercentage: number;
  trades: number;
  winningTrades: number;
  losingTrades: number;
}

export interface ConsecutiveTradeAnalysis {
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  totalStreaks: number;
  streakAnalysis: string;
}

export interface TradeAnalytics {
  averageTradeDurationMs: number;
  averageTradeDurationHours: number;
  tradeFrequency: number;
  sizingAnalysis: {
    minSize: number;
    maxSize: number;
    avgSize: number;
    smallTradesCount: number;
    mediumTradesCount: number;
    largeTradesCount: number;
    smallTradesWinRate: number;
    mediumTradesWinRate: number;
    largeTradesWinRate: number;
  };
  profitConsistency: number;
}

// Parameter sweep types
export interface ParameterRange {
  parameter: string;
  start: number;
  end: number;
  step: number;
}

export interface BacktestParameterResult {
  parameters: any;
  profitPercentage: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
}

export interface ParameterSweepResult {
  parameterSets: number;
  timeframe: string;
  tradingPair: string;
  topResults: BacktestParameterResult[];
  allResults: BacktestParameterResult[];
}

// Multi-timeframe types
export interface TimeframeResult {
  timeframe: string;
  profitPercentage: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface MultiTimeframeResult {
  tradingPair: string;
  timeframes: string[];
  results: TimeframeResult[];
  timeframeConsistency: string;
  consistencyScore: number;
}

// Strategy comparison types
export interface StrategyConfig {
  name: string;
  type: string;
  parameters: any;
}

export interface StrategyResult {
  strategyName: string;
  strategyType: string;
  profitPercentage: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  averageProfit: number;
  averageLoss: number;
  profitFactor: number;
}

export interface StrategyComparisonResult {
  tradingPair: string;
  period: string;
  bestStrategy: string;
  results: StrategyResult[];
}

// Market condition analysis types
export interface MarketCondition {
  startTime: number;
  endTime: number;
  trend: 'uptrend' | 'downtrend' | 'sideways';
  volatility: 'high' | 'medium' | 'low';
  priceChange: number;
  avgVolatility: number;
}

export interface ConditionPerformance {
  marketCondition: string;
  trades: number;
  totalProfit: number;
  profitPercentage: number;
  winRate: number;
  averageProfit: number;
  averageLoss: number;
}

export interface MarketConditionAnalysis {
  tradingPair: string;
  period: string;
  overallProfit: number;
  marketConditions: MarketCondition[];
  performanceByCondition: Record<string, ConditionPerformance>;
  bestCondition: string;
  worstCondition: string;
}

// Walk-forward analysis types
export interface WalkForwardFold {
  inSample: BacktestResult;
  outSample: BacktestResult;
}

export interface WalkForwardResult {
  tradingPair: string;
  totalPeriod: string;
  folds: number;
  actualFolds?: number;    // Actual number of folds used
  requestedFolds?: number; // Originally requested number of folds
  totalTrades?: number;    // Total number of trades in the analysis
  results: {
    fold: number;
    inSampleProfit: number;
    outSampleProfit: number;
    inSampleTrades: number;
    outSampleTrades: number;
    robustnessScore: number;
  }[];
  overallRobustness: number;
  robust: boolean;
}

// Monte Carlo types
export interface RiskMetrics {
  finalValue: {
    mean: number;
    median: number;
    min: number;
    max: number;
    percentile5: number;
    percentile95: number;
  };
  maxDrawdown: {
    mean: number;
    median: number;
    percentile95: number;
    max: number;
  };
  losingProbability: number;
  profitProbability: number;
  probabilityAnalysis: string;
}

export interface ConfidenceIntervals {
  ci50: { lower: number; upper: number };
  ci80: { lower: number; upper: number };
  ci95: { lower: number; upper: number };
  ci99: { lower: number; upper: number };
}

export interface MonteCarloResult {
  tradingPair: string;
  period: string;
  simulations: number;
  actualProfit: number;
  riskMetrics: RiskMetrics;
  confidenceIntervals: ConfidenceIntervals;
  drawdownDistribution: number[];
  profitDistribution: number[];
}