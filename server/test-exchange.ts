/**
 * This is a test file to check if the exchangeService can properly handle Exchange objects and IDs
 */
import { exchangeService } from './exchangeService';
import { storage } from './storage';

async function testExchangeTypeHandling() {
  try {
    console.log('Starting exchange type handling test...');
    
    // Get an exchange from the database
    const exchanges = await storage.getAllExchanges();
    if (exchanges.length === 0) {
      console.log('No exchanges found for testing');
      return;
    }
    
    const exchange = exchanges[0];
    console.log(`Testing with exchange: ${exchange.name} (ID: ${exchange.id})`);
    
    // Test 1: Pass the exchange ID (number)
    console.log('\nTest 1: Passing numeric ID');
    try {
      console.log(`Fetching trading pairs for exchange ID: ${exchange.id}`);
      const pairsWithId = await exchangeService.fetchTradingPairs(exchange.id);
      console.log(`Successfully fetched ${pairsWithId.length} pairs using ID`);
    } catch (error) {
      console.error(`Error when passing ID: ${error.message}`);
    }
    
    // Test 2: Pass the exchange object
    console.log('\nTest 2: Passing exchange object');
    try {
      console.log(`Fetching trading pairs for exchange object with ID: ${exchange.id}`);
      const pairsWithObject = await exchangeService.fetchTradingPairs(exchange);
      console.log(`Successfully fetched ${pairsWithObject.length} pairs using object`);
    } catch (error) {
      console.error(`Error when passing object: ${error.message}`);
    }
    
    console.log('\nTest completed!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test immediately since we're using ES modules
testExchangeTypeHandling().then(() => {
  console.log('Test finished, exiting...');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});