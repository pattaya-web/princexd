import type { NextRequest } from "next/server";
import { readSession, requireAdmin } from "../sales/access";
import type { Session } from "../types";
import { rangeFor, dayIn, type RangePreset } from "./metrics";
import type { DateRange } from "./types";

/** Le module est reserve au proprietaire et aux admins. */
export function adminSession(req: NextRequest): Session {
  return requireAdmin(readSession(req));
}

export function requireParam(req: NextRequest, name: string): string {
  const v = req.nextUrl.searchParams.get(name)?.trim();
  if (!v) throw new Error(`Paramètre ${name} manquant.`);
  return v;
}

/** Periode demandee par l'interface : preset ou dates, dans le fuseau du compte. */
export function rangeFromQuery(req: NextRequest, tz: string): DateRange {
  const q = req.nextUrl.searchParams;
  const preset = (q.get("preset") || "last7") as RangePreset;
  const today = dayIn(tz);
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  return rangeFor(preset, today, { from: valid.test(from) ? from : undefined, to: valid.test(to) ? to : undefined });
}
