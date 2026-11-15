// Rebuilds the dossier the way the gate does and compares it byte for byte with the one the
// entry wrote, then prints the gate's own limits against the files in the output directory.
// It is the check a submission needs before it is sent: a mismatch here is a refused entry.
import { buildDossier } from '../vendor/makefun-board.ts';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '/tmp/tr-out';
const built = buildDossier(dir, { text_max_bytes: 65_536 });
const wrote = readFileSync(join(dir, 'dossier.json'));
const same = Buffer.compare(Buffer.from(built), wrote) === 0;
console.log('dossier_matches:', same, `(${built.length} bytes built, ${wrote.length} written)`);
if (!same) {
  const a = Buffer.from(built).toString('utf8');
  const b = wrote.toString('utf8');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log('first difference at byte', i);
  console.log('built :', JSON.stringify(a.slice(Math.max(0, i - 60), i + 60)));
  console.log('written:', JSON.stringify(b.slice(Math.max(0, i - 60), i + 60)));
}

const board = JSON.parse(readFileSync(join(dir, 'board.json'), 'utf8'));
const rows = Array.isArray(board) ? board : board.rows;
const steps = rows.flatMap((r: any) => r.farm_steps ?? []);
const shotDir = join(dir, 'screenshots');
const shots = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => !f.startsWith('.')) : [];
console.log('rows:', rows.length, 'ranks 1..N:', new Set(rows.map((r: any) => r.rank)).size === rows.length);
console.log('implied whole:', rows.every((r: any) => Number.isInteger(r.implied_value_usd) && r.implied_value_usd > 0), 'max:', Math.max(...rows.map((r: any) => r.implied_value_usd)));
console.log('farm_steps per row:', [...new Set(rows.map((r: any) => (r.farm_steps ?? []).length))], 'length range:', Math.min(...steps.map((s: string) => s.trim().length)), '-', Math.max(...steps.map((s: string) => s.trim().length)));
console.log('screenshots:', shots.length, shots.map((f) => `${f} ${readFileSync(join(shotDir, f)).length}b`).join(', '));
console.log('dashboard files:', readdirSync(join(dir, 'dashboard')).join(', '));
