// The caller's real connection. Every per-connection rule reads it from here.
//
// Never use rawRequest.ip: it is the FIRST x-forwarded-for entry, which the
// caller writes. Google adds the real address as the LAST entry, measured live
// on 2026-11-01: sending "1.2.3.4" gave ip=1.2.3.4 and "1.2.3.4,<real address>".

interface RequestContext {
  rawRequest?: { ip?: string; headers?: Record<string, string | string[] | undefined> };
}

export const clientIp = (context: RequestContext | null | undefined): string | undefined => {
  const request = context?.rawRequest;
  const forwarded = request?.headers?.['x-forwarded-for'];
  const real = typeof forwarded === 'string' ? forwarded.split(',').pop()?.trim() : '';
  return real || request?.ip;
};
