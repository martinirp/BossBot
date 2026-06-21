import fs from 'fs';

// Set test DB env
process.env.DB_FILE = 'test_bossbot.db';

// Clean old test DB
if (fs.existsSync('test_bossbot.db')) {
  fs.unlinkSync('test_bossbot.db');
}

// Dynamically import database and commands to ensure process.env.DB_FILE is set before initialization
const { initDb, addSubscription, removeSubscription, getSubscribers, getBossSubscriptionsForJid, clearSubscriptionsForJid, setUserPushoverKey, getUserPushoverKey, removeUserPushoverKey, getPushoverKeysForSubscribers, closeDb, addGroup } = await import('./database.js');
const { normalizeBossName, findBossMatch } = await import('./commands.js');
const { commandHandler } = await import('./commandHandler.js');

async function runTests() {
  console.log('Running BossBot Unit/Integration Tests...\n');

  // Test 1: Normalization
  console.log('--- Test 1: Normalization ---');
  const normalized1 = normalizeBossName('  Ferumbras  ');
  const normalized2 = normalizeBossName('Múnster');
  const normalized3 = normalizeBossName('Ghazbaran');
  console.log(`"  Ferumbras  " -> "${normalized1}" (Expected: "ferumbras")`);
  console.log(`"Múnster" -> "${normalized2}" (Expected: "munster")`);
  console.log(`"Ghazbaran" -> "${normalized3}" (Expected: "ghazbaran")`);
  
  if (normalized1 !== 'ferumbras' || normalized2 !== 'munster' || normalized3 !== 'ghazbaran') {
    throw new Error('Normalization test failed!');
  }
  console.log('Normalization test passed ✅\n');

  // Test 1.5: Fuzzy Matching
  console.log('--- Test 1.5: Fuzzy Matching ---');
  const dummyBosses = ['Ferumbras', 'Ghazbaran', 'Morgaroth', 'Orshabaal', 'Zushuka', 'Mahatheb', 'Mawhawk', 'Dreadmaw'];

  // Test exact match
  const match1 = findBossMatch('ferumbras', dummyBosses);
  console.log(`Match for "ferumbras":`, match1);
  if (match1.match !== 'Ferumbras') throw new Error('Exact match failed');

  // Test prefix match (single candidate)
  const match2 = findBossMatch('ferum', dummyBosses);
  console.log(`Match for "ferum":`, match2);
  if (match2.match !== 'Ferumbras') throw new Error('Prefix match failed');

  // Test substring match (multiple candidates)
  const match3 = findBossMatch('maw', dummyBosses);
  console.log(`Match for "maw":`, match3);
  if (match3.match !== null || match3.suggestions.length !== 2 || !match3.suggestions.includes('Mawhawk') || !match3.suggestions.includes('Dreadmaw')) {
    throw new Error('Ambiguous substring match failed');
  }

  // Test Levenshtein match (distance = 1)
  const match4 = findBossMatch('mathatheb', dummyBosses);
  console.log(`Match for "mathatheb":`, match4);
  if (match4.match !== 'Mahatheb') throw new Error('Levenshtein match failed');

  // Test unmatched
  const match5 = findBossMatch('nonexistent', dummyBosses);
  console.log(`Match for "nonexistent":`, match5);
  if (match5.match !== null || match5.suggestions.length !== 0) throw new Error('Unmatched check failed');

  console.log('Fuzzy matching test passed ✅\n');

  // Test 3: Database operations
  console.log('--- Test 3: Database Operations ---');
  await initDb();
  console.log('Database initialized.');

  const jid1 = '12345@s.whatsapp.net';
  const jid2 = '67890@s.whatsapp.net';

  // Add subscriptions
  const sub1 = await addSubscription(jid1, 'ferumbras');
  const sub2 = await addSubscription(jid1, 'munster');
  const sub3 = await addSubscription(jid2, 'ferumbras');
  const sub4 = await addSubscription(jid1, 'ferumbras'); // Duplicate

  console.log(`Add sub1 (jid1, ferumbras): ${sub1} (Expected: true)`);
  console.log(`Add sub2 (jid1, munster): ${sub2} (Expected: true)`);
  console.log(`Add sub3 (jid2, ferumbras): ${sub3} (Expected: true)`);
  console.log(`Add sub4 (jid1, ferumbras) [duplicate]: ${sub4} (Expected: false)`);

  if (!sub1 || !sub2 || !sub3 || sub4) {
    throw new Error('Database insertion failed');
  }

  // Get subscribers for ferumbras
  const subsFerumbras = await getSubscribers('ferumbras');
  console.log(`Subscribers for "ferumbras":`, subsFerumbras);
  if (subsFerumbras.length !== 2 || !subsFerumbras.includes(jid1) || !subsFerumbras.includes(jid2)) {
    throw new Error('Get subscribers failed');
  }

  // Get subscriptions for jid1
  const jid1Subs = await getBossSubscriptionsForJid(jid1);
  console.log(`Subscriptions for jid1:`, jid1Subs);
  if (jid1Subs.length !== 2 || jid1Subs[0] !== 'ferumbras' || jid1Subs[1] !== 'munster') {
    throw new Error('Get subscriptions for JID failed');
  }

  // Remove subscription
  const rem1 = await removeSubscription(jid1, 'ferumbras');
  const rem2 = await removeSubscription(jid1, 'ferumbras'); // Already removed
  console.log(`Remove sub (jid1, ferumbras): ${rem1} (Expected: true)`);
  console.log(`Remove sub (jid1, ferumbras) again: ${rem2} (Expected: false)`);

  if (!rem1 || rem2) {
    throw new Error('Remove subscription failed');
  }

  const subsFerumbrasAfter = await getSubscribers('ferumbras');
  console.log(`Subscribers for "ferumbras" after removal:`, subsFerumbrasAfter);
  if (subsFerumbrasAfter.length !== 1 || subsFerumbrasAfter[0] !== jid2) {
    throw new Error('Get subscribers after removal failed');
  }

  // Clear all subscriptions for jid2
  console.log('Testing clearSubscriptionsForJid for jid2...');
  const clearedCount = await clearSubscriptionsForJid(jid2);
  console.log(`Cleared count for jid2: ${clearedCount} (Expected: 1)`);
  if (clearedCount !== 1) throw new Error('clearSubscriptionsForJid returned incorrect count');
  
  const subsFerumbrasAfterClear = await getSubscribers('ferumbras');
  console.log(`Subscribers for "ferumbras" after clear:`, subsFerumbrasAfterClear);
  if (subsFerumbrasAfterClear.length !== 0) {
    throw new Error('Subscriptions were not fully cleared');
  }
  console.log('clearSubscriptionsForJid test passed ✅');

  // Test 3.5: Pushover Database Operations
  console.log('--- Test 3.5: Pushover Database Operations ---');
  const user1 = 'user1@s.whatsapp.net';
  const user2 = 'user2@s.whatsapp.net';

  // Initially, get key should be null
  const key1 = await getUserPushoverKey(user1);
  console.log(`getUserPushoverKey for user1: ${key1} (Expected: null)`);
  if (key1 !== null) throw new Error('Initial Pushover key is not null');

  // Set key for user1
  const set1 = await setUserPushoverKey(user1, 'key123456');
  console.log(`setUserPushoverKey for user1: ${set1} (Expected: true)`);
  if (!set1) throw new Error('Failed to set Pushover key');

  // Get key for user1
  const key1_set = await getUserPushoverKey(user1);
  console.log(`getUserPushoverKey for user1 after set: ${key1_set} (Expected: key123456)`);
  if (key1_set !== 'key123456') throw new Error('Pushover key retrieved does not match');

  // Replace key for user1
  const set2 = await setUserPushoverKey(user1, 'key789abc');
  console.log(`setUserPushoverKey for user1 update: ${set2} (Expected: true)`);
  if (!set2) throw new Error('Failed to update Pushover key');

  const key1_updated = await getUserPushoverKey(user1);
  console.log(`getUserPushoverKey for user1 after update: ${key1_updated} (Expected: key789abc)`);
  if (key1_updated !== 'key789abc') throw new Error('Pushover key update did not apply');

  // Set key for user2
  await setUserPushoverKey(user2, 'keyxyz');

  // Test getPushoverKeysForSubscribers mapping
  const mapping = await getPushoverKeysForSubscribers([user1, user2, 'unregistered@s.whatsapp.net']);
  console.log(`getPushoverKeysForSubscribers mapping:`, mapping);
  if (mapping[user1]?.key !== 'key789abc' || mapping[user2]?.key !== 'keyxyz' || mapping['unregistered@s.whatsapp.net'] !== undefined) {
    throw new Error('getPushoverKeysForSubscribers mapping matches incorrectly');
  }

  // Remove key for user1
  const remUser1 = await removeUserPushoverKey(user1);
  console.log(`removeUserPushoverKey for user1: ${remUser1} (Expected: true)`);
  if (!remUser1) throw new Error('Failed to remove Pushover key');

  const key1_after_rem = await getUserPushoverKey(user1);
  console.log(`getUserPushoverKey after removal: ${key1_after_rem} (Expected: null)`);
  if (key1_after_rem !== null) throw new Error('Pushover key was not removed');

  console.log('Pushover Database Operations test passed ✅');

  console.log('Database operations test passed ✅\n');

  // Test 4: Hive Loot Calculation
  console.log('--- Test 4: Hive Loot Calculation ---');
  let sentMessages = [];
  const mockSock = {
    sendMessage: async (jid, content, options) => {
      sentMessages.push({ jid, content, options });
    }
  };

  // Add mock allowed group
  const groupJid = 'test_group@g.us';
  await addGroup(groupJid);

  // Test 4.1: HH:MM:SS format
  const mockMsg1 = {
    key: {
      remoteJid: groupJid,
      participant: '123@s.whatsapp.net'
    }
  };
  
  await commandHandler.loadCommands(); // Make sure commands are loaded or setup is done
  await commandHandler.handleMessage(mockSock, mockMsg1, '00:50:44 Loot of a hive overseer:');
  
  console.log('Sent message text:', sentMessages[0]?.content?.text);
  const expectedText1 = `Último Hive: 00:50:44\nPróxima aparição: (16-28 min)\n20% → 01:06:44 (16m)\n40% → 01:12:44 (22m)\n40% → 01:18:44 (28m)`;
  
  if (sentMessages[0]?.content?.text !== expectedText1) {
    throw new Error(`Test 4.1 failed! Received: ${sentMessages[0]?.content?.text}`);
  }
  console.log('HH:MM:SS format test passed ✅');

  // Test 4.2: HH:MM format
  sentMessages = [];
  const mockMsg2 = {
    key: {
      remoteJid: groupJid,
      participant: '123@s.whatsapp.net'
    }
  };

  await commandHandler.handleMessage(mockSock, mockMsg2, '11:13 Loot of a spidris elite: ');
  console.log('Sent message text:', sentMessages[0]?.content?.text);
  const expectedText2 = `Último Hive: 11:13\nPróxima aparição: (16-28 min)\n20% → 11:29 (16m)\n40% → 11:35 (22m)\n40% → 11:41 (28m)`;
  if (sentMessages[0]?.content?.text !== expectedText2) {
    throw new Error(`Test 4.2 failed! Received: ${sentMessages[0]?.content?.text}`);
  }
  console.log('HH:MM format test passed ✅\n');

  // Clean up
  await closeDb();
  if (fs.existsSync('test_bossbot.db')) {
    fs.unlinkSync('test_bossbot.db');
  }
  
  console.log('All unit/integration tests completed successfully! 🎉');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
