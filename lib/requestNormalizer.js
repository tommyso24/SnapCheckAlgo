// Input adapter for /api/analyze and /api/v1/analyze.
// Accepts both the legacy shape ({ inquiry, company, images, options, enableIntel })
// and the new SN-facing shape ({ inquiry_text, company_profile, inquiry_images,
// enable_intel, scan_mode, request_id }). Downstream code reads only the
// normalized field names.

export function normalizeRequest(body = {}) {
  const enable_intel =
    body.enable_intel !== undefined
      ? body.enable_intel
      : body.enableIntel !== undefined
        ? body.enableIntel
        : body.options?.enable_intel ?? false

  return {
    request_id: body.request_id || null,
    inquiry_text: body.inquiry_text || body.inquiry || '',
    company_profile: body.company_profile ?? body.company ?? '',
    inquiry_images: body.inquiry_images || body.images || [],
    enable_intel,
    scan_mode: body.scan_mode || (enable_intel ? 'online' : 'offline'),
  }
}
