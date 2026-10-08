type HealthBody = {
  ok: true;
};

export function GET(): Response {
  const body: HealthBody = { ok: true };
  return Response.json(body);
}
