import { RAW_TROOPS_WITH_ICONS, RAW_TROOPS } from './src/util/troops.js';

const targets = ['Dragon Duke', 'Greedy Raven', 'Fire Heart', 'Flame Blower', 'Stun Blaster'];

console.log('--- Metadata Diagnostic ---');
for (const name of targets) {
  const inRaw = RAW_TROOPS.find(u => u.name === name);
  const inIcons = RAW_TROOPS_WITH_ICONS.find(u => u.name === name);
  console.log(`[${name}]`);
  console.log(`  In RAW_TROOPS: ${!!inRaw}`);
  if (inRaw) {
    console.log(`  Seasonal: ${inRaw.seasonal}`);
    console.log(`  Category: ${inRaw.category}`);
    console.log(`  Village: ${inRaw.village}`);
  }
  console.log(`  In RAW_TROOPS_WITH_ICONS: ${!!inIcons}`);
}

console.log('\n--- Troop Excerpt ---');
console.log('Total in RAW_TROOPS:', RAW_TROOPS.length);
console.log('Total in RAW_TROOPS_WITH_ICONS:', RAW_TROOPS_WITH_ICONS.length);
