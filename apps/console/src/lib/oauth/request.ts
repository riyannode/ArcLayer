export async function readOAuthBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return await req.json() as Record<string, unknown>;
  const form = await req.formData(); return Object.fromEntries(form.entries());
}
