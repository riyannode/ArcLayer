/**
 * Optional internal Oracle server.
 * IMPORTANT: this is not public paid API. Public paid access should hit Resolver only.
 */
import express from 'express';
import { generateRawOracleSignals } from './oracle-engine.js';
import type { OracleInput } from './types.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.IGNIA_ORACLE_INTERNAL_PORT ?? process.env.PYTHIA_ORACLE_INTERNAL_PORT ?? 4011);
const INTERNAL_KEY = process.env.IGNIA_ORACLE_INTERNAL_KEY ?? process.env.PYTHIA_ORACLE_INTERNAL_KEY;

app.post('/internal/oracle/:token/raw', (req, res) => {
  if (INTERNAL_KEY && req.header('x-internal-key') !== INTERNAL_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized_internal_oracle' });
  }
  const body = (req.body ?? {}) as Partial<OracleInput>;
  const signals = generateRawOracleSignals({
    token: req.params.token,
    spotPrice: Number(body.spotPrice ?? 0),
    ...body,
  } as OracleInput);
  res.json({ ok: true, token: req.params.token.toUpperCase(), signals });
});

app.get('/health', (_req, res) => res.json({ ok: true, agent: 'Ignia_Oracle', publicPaid: false }));

app.listen(PORT, () => console.log(`[Ignia Oracle] internal raw-signal server on :${PORT}`));
