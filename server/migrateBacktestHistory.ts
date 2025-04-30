/**
 * This file handles schema migrations to create the backtest_history table
 */
import { db } from "./db";
import { log } from "./vite";

export async function migrateBacktestHistorySchema() {
  try {
    log("Starting backtest_history table schema migration");
    
    // First check if table exists
    const tableCheckResult = await db.execute(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'backtest_history'
      ) as table_exists
    `);
    
    // Check if table already exists
    const tableExists = tableCheckResult.rows[0].table_exists;
    
    if (tableExists) {
      // Check if exchange_id column exists and add it if it doesn't
      await addExchangeIdColumn();
      log("The backtest_history table already exists. Checking for column updates.");
      return true;
    }
    
    // Create the backtest_history table if it doesn't exist
    log("Creating backtest_history table");
    await db.execute(`
      CREATE TABLE backtest_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        strategy_type TEXT NOT NULL,
        trading_pair TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        exchange TEXT NOT NULL,
        exchange_id INTEGER,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        initial_capital REAL NOT NULL DEFAULT 1000,
        final_capital REAL NOT NULL DEFAULT 1000,
        total_profit REAL NOT NULL,
        profit_percentage REAL NOT NULL,
        total_trades INTEGER,
        win_rate REAL,
        winning_trades INTEGER,
        losing_trades INTEGER,
        max_drawdown REAL,
        sharpe_ratio REAL,
        profit_factor REAL,
        average_profit REAL,
        average_loss REAL,
        max_consecutive_losses INTEGER,
        parameters JSONB NOT NULL,
        trades JSONB,
        equity_curve JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    log("Created index on user_id for fast lookups");
    await db.execute(`
      CREATE INDEX idx_backtest_history_user_id ON backtest_history(user_id)
    `);
    
    log("Created index on created_at for sorting");
    await db.execute(`
      CREATE INDEX idx_backtest_history_created_at ON backtest_history(created_at)
    `);
    
    log("Backtest history schema migration completed successfully");
    return true;
  } catch (error) {
    console.error("Error during backtest_history schema migration:", error);
    throw error;
  }
}

/**
 * Add missing columns to the backtest_history table
 */
async function addExchangeIdColumn() {
  try {
    // Check if columns exist
    const columnCheckResult = await db.execute(`
      SELECT 
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'exchange_id') as exchange_id_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'exchange') as exchange_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'initial_capital') as initial_capital_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'final_capital') as final_capital_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'winning_trades') as winning_trades_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'losing_trades') as losing_trades_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'max_drawdown') as max_drawdown_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'sharpe_ratio') as sharpe_ratio_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'profit_factor') as profit_factor_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'average_profit') as average_profit_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'average_loss') as average_loss_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'max_consecutive_losses') as max_consecutive_losses_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'equity_curve') as equity_curve_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'total_profit') as total_profit_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'profit') as profit_exists,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backtest_history' AND column_name = 'metrics') as metrics_exists
    `);
    
    const columnStatus = columnCheckResult.rows[0];
    
    // Add exchange_id column if it doesn't exist
    if (!columnStatus.exchange_id_exists) {
      log("Adding exchange_id column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN exchange_id INTEGER
      `);
      log("Added exchange_id column successfully");
    } else {
      log("The exchange_id column already exists in backtest_history table");
    }
    
    // Add exchange column if it doesn't exist
    if (!columnStatus.exchange_exists) {
      log("Adding exchange column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN exchange TEXT NOT NULL DEFAULT 'Unknown'
      `);
      log("Added exchange column successfully");
    } else {
      log("The exchange column already exists in backtest_history table");
    }
    
    // Add initial_capital column if it doesn't exist
    if (!columnStatus.initial_capital_exists) {
      log("Adding initial_capital column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN initial_capital REAL NOT NULL DEFAULT 1000
      `);
      log("Added initial_capital column successfully");
    } else {
      log("The initial_capital column already exists in backtest_history table");
    }

    // Add final_capital column if it doesn't exist
    if (!columnStatus.final_capital_exists) {
      log("Adding final_capital column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN final_capital REAL NOT NULL DEFAULT 1000
      `);
      log("Added final_capital column successfully");
    }
    
    // Add winning_trades column if it doesn't exist
    if (!columnStatus.winning_trades_exists) {
      log("Adding winning_trades column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN winning_trades INTEGER
      `);
      log("Added winning_trades column successfully");
    }
    
    // Add losing_trades column if it doesn't exist
    if (!columnStatus.losing_trades_exists) {
      log("Adding losing_trades column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN losing_trades INTEGER
      `);
      log("Added losing_trades column successfully");
    }
    
    // Add max_drawdown column if it doesn't exist
    if (!columnStatus.max_drawdown_exists) {
      log("Adding max_drawdown column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN max_drawdown REAL
      `);
      log("Added max_drawdown column successfully");
    }
    
    // Add sharpe_ratio column if it doesn't exist
    if (!columnStatus.sharpe_ratio_exists) {
      log("Adding sharpe_ratio column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN sharpe_ratio REAL
      `);
      log("Added sharpe_ratio column successfully");
    }
    
    // Add profit_factor column if it doesn't exist
    if (!columnStatus.profit_factor_exists) {
      log("Adding profit_factor column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN profit_factor REAL
      `);
      log("Added profit_factor column successfully");
    }
    
    // Add average_profit column if it doesn't exist
    if (!columnStatus.average_profit_exists) {
      log("Adding average_profit column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN average_profit REAL
      `);
      log("Added average_profit column successfully");
    }
    
    // Add average_loss column if it doesn't exist
    if (!columnStatus.average_loss_exists) {
      log("Adding average_loss column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN average_loss REAL
      `);
      log("Added average_loss column successfully");
    }
    
    // Add max_consecutive_losses column if it doesn't exist
    if (!columnStatus.max_consecutive_losses_exists) {
      log("Adding max_consecutive_losses column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN max_consecutive_losses INTEGER
      `);
      log("Added max_consecutive_losses column successfully");
    }
    
    // Add equity_curve column if it doesn't exist
    if (!columnStatus.equity_curve_exists) {
      log("Adding equity_curve column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN equity_curve JSONB
      `);
      log("Added equity_curve column successfully");
    }
    
    // Handle profit vs total_profit column discrepancy
    if (columnStatus.profit_exists && !columnStatus.total_profit_exists) {
      log("Renaming profit column to total_profit");
      await db.execute(`
        ALTER TABLE backtest_history
        RENAME COLUMN profit TO total_profit
      `);
      log("Renamed profit column to total_profit successfully");
    } else if (!columnStatus.profit_exists && !columnStatus.total_profit_exists) {
      log("Adding total_profit column");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN total_profit REAL NOT NULL DEFAULT 0
      `);
      log("Added total_profit column successfully");
    }
    
    // Add metrics column if it doesn't exist
    if (!columnStatus.metrics_exists) {
      log("Adding metrics column to backtest_history table");
      await db.execute(`
        ALTER TABLE backtest_history
        ADD COLUMN metrics JSONB NOT NULL DEFAULT '{}'
      `);
      log("Added metrics column successfully");
    } else {
      log("The metrics column already exists in backtest_history table");
    }
    
    return true;
  } catch (error) {
    console.error("Error adding columns to backtest_history table:", error);
    throw error;
  }
}

// Export as default for direct execution
export default migrateBacktestHistorySchema;