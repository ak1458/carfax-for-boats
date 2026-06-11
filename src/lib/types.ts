export type SystemKind = "engine" | "generator" | "other";
export type DocType = "receipt" | "engine_plate" | "hour_meter" | "other";
export type ReminderRule = "calendar" | "hours";
export type ReminderStatus = "active" | "done" | "dismissed";

export interface Boat {
  id: string; owner_id: string; name: string;
  make: string | null; model: string | null; year: number | null;
  hin: string | null; hero_photo_path: string | null; created_at: string;
}

export interface System {
  id: string; boat_id: string; owner_id: string; kind: SystemKind;
  make: string | null; model: string | null; serial: string | null;
  tracks_hours: boolean; created_at: string;
}

export interface DocumentRow {
  id: string; boat_id: string; owner_id: string; storage_path: string;
  doc_type: DocType; extraction_json: unknown | null;
  extraction_model: string | null; extraction_confidence: number | null;
  created_at: string;
}

export interface Part { name: string; part_number?: string; quantity?: number; unit_cost_cents?: number; }

export interface ServiceEvent {
  id: string; boat_id: string; owner_id: string;
  system_id: string | null; document_id: string | null;
  event_date: string; vendor: string | null; description: string | null;
  cost_cents: number | null; currency: string; engine_hours: number | null;
  parts: Part[]; created_at: string;
}

export interface HourReading {
  id: string; system_id: string; owner_id: string;
  hours: number; reading_date: string; document_id: string | null; created_at: string;
}

export interface Reminder {
  id: string; boat_id: string; owner_id: string; system_id: string | null;
  title: string; rule_type: ReminderRule;
  interval_months: number | null; interval_hours: number | null;
  next_due_date: string | null; next_due_hours: number | null;
  last_done_event_id: string | null; status: ReminderStatus; created_at: string;
}

export interface ShareLink {
  id: string; boat_id: string; owner_id: string;
  token: string; revoked: boolean; created_at: string;
}
