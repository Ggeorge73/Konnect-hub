import { NextResponse } from 'next/server';
import { receive } from '@/lib/integration/service';
import { SIGNATURE_HEADER } from '@/lib/integration/signing';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/crm/events — the Konnector CRM's events (opportunity.won,
 * project.extended, client_item.published, client_item.withdrawn). The CRM posts to
 * `{KONNECT_HUB_BASE_URL}/events`, so set KONNECT_HUB_BASE_URL to `<hub>/api/integrations/crm`.
 * No session: the HMAC `X-Konnector-Signature` (shared secret, 5-minute window) is the
 * authentication. 401 bad signature · 422 outside the contract · 200 with the result.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const r = await receive(body, req.headers.get(SIGNATURE_HEADER));
  return NextResponse.json(r.body, { status: r.status });
}
