import { getUsageDataset } from "@/lib/usage-data";

// Always live — never cache this route.
export const dynamic = "force-dynamic";

export async function GET() {
  const dataset = await getUsageDataset();
  return Response.json(dataset, {
    headers: { "Cache-Control": "no-store" },
  });
}