import { execFileSync } from 'node:child_process';
import { privateKeyToAccount } from 'viem/accounts';

const zip = '/root/arclayer-private-keys-20260518-173230.zip';
const target = '0x51a6e681f5a74A65dD853Dc21d9ffF4A5341514e'.toLowerCase();
const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
  .split('\n')
  .map(s => s.trim())
  .filter(s => s.endsWith('.pk'));

for (const name of listing) {
  const raw = execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8' }).trim();
  const pk = raw.startsWith('0x') ? raw : `0x${raw}`;
  const address = privateKeyToAccount(pk).address;
  const mark = address.toLowerCase() === target ? 'MATCH' : '     ';
  console.log(`${mark} ${name} -> ${address}`);
}
