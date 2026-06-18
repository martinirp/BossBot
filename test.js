import fs from 'fs';

// Set test DB env
process.env.DB_FILE = 'test_bossbot.db';

// Clean old test DB
if (fs.existsSync('test_bossbot.db')) {
  fs.unlinkSync('test_bossbot.db');
}

// Dynamically import database and commands to ensure process.env.DB_FILE is set before initialization
const { initDb, addSubscription, removeSubscription, getSubscribers, getBossSubscriptionsForJid, clearSubscriptionsForJid, savePollMessage, getPollMessage, getExpiredPollMessages, markPollDeletedFromWhatsapp, setUserPushoverKey, getUserPushoverKey, removeUserPushoverKey, getPushoverKeysForSubscribers, closeDb } = await import('./database.js');
const { parseMessage, normalizeBossName, findBossMatch } = await import('./commands.js');

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

  // Test 2: Commands Parsing
  console.log('--- Test 2: Commands Parsing ---');
  
  const p1 = parseMessage('!ferumbras');
  console.log(`"!ferumbras" ->`, p1);
  if (p1?.type !== 'subscribe' || p1?.bossName !== 'ferumbras') throw new Error('Parser subscribe failed');

  const p2 = parseMessage('!man in the cave');
  console.log(`"!man in the cave" ->`, p2);
  if (p2?.type !== 'subscribe' || p2?.bossName !== 'man in the cave') throw new Error('Parser subscribe with spaces failed');

  const p3 = parseMessage('!remover Munster');
  console.log(`"!remover Munster" ->`, p3);
  if (p3?.type !== 'remove' || p3?.bossName !== 'munster') throw new Error('Parser remove failed');

  const p3_space = parseMessage('!remover man in the cave');
  console.log(`"!remover man in the cave" ->`, p3_space);
  if (p3_space?.type !== 'remove' || p3_space?.bossName !== 'man in the cave') throw new Error('Parser remove with spaces failed');

  const p4 = parseMessage('!meusbosses');
  console.log(`"!meusbosses" ->`, p4);
  if (p4?.type !== 'list') throw new Error('Parser list failed');

  const p5_confirmar = parseMessage('!confirmar ferumbras, perto do tp');
  console.log(`"!confirmar ferumbras, perto do tp" ->`, p5_confirmar);
  if (p5_confirmar?.type !== 'confirm' || p5_confirmar?.bossName !== 'ferumbras' || p5_confirmar?.extraText !== 'perto do tp') throw new Error('Parser confirmar failed');

  const p5_c = parseMessage('!c man in the cave | perto do tp');
  console.log(`"!c man in the cave | perto do tp" ->`, p5_c);
  if (p5_c?.type !== 'confirm' || p5_c?.bossName !== 'man in the cave' || p5_c?.extraText !== 'perto do tp') throw new Error('Parser !c with spaces failed');

  const p5_no_extra = parseMessage('!c ferumbras');
  console.log(`"!c ferumbras" ->`, p5_no_extra);
  if (p5_no_extra?.type !== 'confirm' || p5_no_extra?.bossName !== 'ferumbras' || p5_no_extra?.extraText !== '') throw new Error('Parser !c without extra failed');

  const p6 = parseMessage('hello !ferumbras'); // Should be ignored
  console.log(`"hello !ferumbras" ->`, p6);
  if (p6 !== null) throw new Error('Parser should ignore message not starting with !');

  const p7 = parseMessage('!bosses');
  console.log(`"!bosses" ->`, p7);
  if (p7?.type !== 'bosses_menu' || p7?.arg !== null) throw new Error('Parser !bosses failed');

  const p8_arg1 = parseMessage('!bosses 1, 2, 3');
  console.log(`"!bosses 1, 2, 3" ->`, p8_arg1);
  if (p8_arg1?.type !== 'bosses_menu' || p8_arg1?.arg !== '1, 2, 3') throw new Error('Parser !bosses 1, 2, 3 failed');

  const p8_argTodos = parseMessage('!bosses todos');
  console.log(`"!bosses todos" ->`, p8_argTodos);
  if (p8_argTodos?.type !== 'bosses_menu' || p8_argTodos?.arg !== 'todos') throw new Error('Parser !bosses todos failed');

  const p9 = parseMessage('!help');
  console.log(`"!help" ->`, p9);
  if (p9?.type !== 'help') throw new Error('Parser !help failed');

  const p10 = parseMessage('!ajuda');
  console.log(`"!ajuda" ->`, p10);
  if (p10?.type !== 'help') throw new Error('Parser !ajuda failed');

  const p11 = parseMessage('!reset');
  console.log(`"!reset" ->`, p11);
  if (p11?.type !== 'reset') throw new Error('Parser !reset failed');

  const p12 = parseMessage('!limpar');
  console.log(`"!limpar" ->`, p12);
  if (p12?.type !== 'clear_help') throw new Error('Parser !limpar failed to return clear_help');

  const p13 = parseMessage('!limparbosses');
  console.log(`"!limparbosses" ->`, p13);
  if (p13?.type !== 'clear') throw new Error('Parser !limparbosses failed to return clear');

  const p14 = parseMessage('!limpar ferumbras');
  console.log(`"!limpar ferumbras" ->`, p14);
  if (p14?.type !== 'remove' || p14?.bossName !== 'ferumbras') throw new Error('Parser !limpar <boss> failed');

  // Test !pushover parser
  const p15 = parseMessage('!pushover');
  console.log(`"!pushover" ->`, p15);
  if (p15?.type !== 'pushover_get') throw new Error('Parser !pushover failed');

  const p16 = parseMessage('!pushover u1234567890abcdef');
  console.log(`"!pushover u1234567890abcdef" ->`, p16);
  if (p16?.type !== 'pushover_set' || p16?.key !== 'u1234567890abcdef') throw new Error('Parser !pushover <key> failed');

  const p17 = parseMessage('!pushover remover');
  console.log(`"!pushover remover" ->`, p17);
  if (p17?.type !== 'pushover_remove') throw new Error('Parser !pushover remover failed');

  const p18 = parseMessage('!pushover limpar');
  console.log(`"!pushover limpar" ->`, p18);
  if (p18?.type !== 'pushover_remove') throw new Error('Parser !pushover limpar failed');

  // Test reserved words block
  const p_reserved = parseMessage('!remover');
  console.log(`"!remover" ->`, p_reserved);
  if (p_reserved !== null) throw new Error('Parser should block reserved words as subscribe command');

  const p_reserved2 = parseMessage('!confirmar');
  console.log(`"!confirmar" ->`, p_reserved2);
  if (p_reserved2 !== null) throw new Error('Parser should block reserved words as subscribe command');

  const p_reserved_c = parseMessage('!c');
  console.log(`"!c" ->`, p_reserved_c);
  if (p_reserved_c !== null) throw new Error('Parser should block reserved words as subscribe command');

  console.log('Commands parsing test passed ✅\n');

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
  if (mapping[user1] !== 'key789abc' || mapping[user2] !== 'keyxyz' || mapping['unregistered@s.whatsapp.net'] !== undefined) {
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
