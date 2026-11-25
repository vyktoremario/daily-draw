import { dripStatus, dripStatusCode, parseDripBody, runDrip } from '../../../lib/drip';
import { clientIp, dripDeps } from '../../../lib/drip-server';

/** Gas drip: a little test ETH for a new testnet wallet. See lib/drip.ts for the limits. */

const MAX_BODY_BYTES = 200;

export async function GET() {
  const status = await dripStatus(dripDeps());
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const text = await request.text();
  let body: unknown = null;
  if (text.length <= MAX_BODY_BYTES) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  const result = await runDrip(parseDripBody(body), clientIp(request.headers), dripDeps());
  const json = result.ok
    ? { ok: true, hash: result.hash, amountWei: result.amountWei.toString() }
    : { ok: false, reason: result.reason };
  return Response.json(json, {
    status: dripStatusCode(result),
    headers: { 'Cache-Control': 'no-store' },
  });
}
