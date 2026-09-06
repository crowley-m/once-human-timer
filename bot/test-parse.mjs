// Offline check of the parser against real log lines. No Discord/API needed.
//   node test-parse.mjs
import { parseMessage } from './src/parse.js';

// stand-in roster (name + interval only — that's all the parser uses)
const roster = [
  ['Furnace Lair', 'red_card', 120],
  ['Gaia Research Center Ruins', 'red_card', 120],
  ['Ricci Securement Point', 'red_card', 120],
  ['Forsaken Monolith', 'red_card', 120],
  ['Furnace Lair — Elite (Pornis)', 'elite', 60],
  ['Forsaken Monolith — Elite', 'elite', 60],
  ['Blackfell Oil Fields', 'elite', 60],
  ['Fort Eyrie', 'elite', 60],
  ['Alpha Institute', 'elite', 60],
  ['Railway Junction', 'elite', 60],
  ['Rotten Saddle', 'elite', 60],
  ['Sunbury Middle School', 'elite', 60],
  ['Evergreen Vineyard', 'blue', 120],
  ['Hearst Industries', 'blue', 120],
  ['Greywater Industrial Zone', 'blue', 120],
  ['Mirage Monolith Exclusion Zone', 'blue', 120],
  ['Blackfell Fallen Zone', 'blue', 120],
].map(([name, type, interval_minutes], id) => ({ id, name, type, interval_minutes }));

// (message text, pretend-sent-at in Manila time)
const CASES = [
  ['Sanbori elite 1:50\nRailwi 1:56', '2026-09-05T12:50+08:00'],
  ['Vineyard blue 2:09', '2026-09-05T14:09+08:00'],
  ['FURNACE ELITE 2:58\nFURNACE RED 3 :53\nvineyard 3:03', '2026-09-06T01:58+08:00'],
  ['FORSAKEN ELITE 1:00 am', '2026-09-06T01:09+08:00'],
  ['forsaken red\nopen\n4 :22 railway', '2026-09-06T03:20+08:00'],
  ['HEARTASDSACZX 5:18', '2026-09-06T04:18+08:00'],
  ['gaia 6:10', '2026-09-06T04:10+08:00'],
  ['Pornis elite 11:47', '2026-09-05T22:48+08:00'],
  ['forsaken elite red 4:50', '2026-09-06T03:51+08:00'],
  ['potato raiding kaii base', '2026-09-05T21:16+08:00'],
  ['ricci red open', '2026-09-06T00:27+08:00'],
  // --- deliberate misspellings ------------------------------------------
  ['sunbry elite 3:26', '2026-09-06T02:30+08:00'],
  ['greywatr 4:25', '2026-09-05T15:30+08:00'],
  ['forsakn elite 6:00', '2026-09-06T05:05+08:00'],
  ['railwey junction 4:22', '2026-09-06T03:20+08:00'],
  ['hearast blue 5:18', '2026-09-06T04:20+08:00'],
  ['blackfel oil 2:15', '2026-09-06T01:15+08:00'],
  ['snowbury 3:26', '2026-09-06T02:30+08:00'], // via learned.json
  ['furnace 3:53', '2026-09-06T01:58+08:00'], // ambiguous: red or elite?
];

for (const [text, at] of CASES) {
  console.log('\n' + '─'.repeat(60));
  console.log(JSON.stringify(text));
  const out = parseMessage(text, new Date(at), roster);
  if (!out.length) {
    console.log('  (nothing)');
    continue;
  }
  for (const r of out) {
    if (r.ambiguous) console.log(`  ❓ ${r.reason || 'ambiguous'}  —  "${r.line}"`);
    else {
      const mnl = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(r.resetAt));
      console.log(
        `  ✓ ${r.zone.name.padEnd(32)} reset ${mnl} MNL   [match ${r.score ?? '1'}]   from "${r.line}"`
      );
    }
  }
}
