// Matches Person A's 'cases' table schema
export interface Case {
  id: string;
  emergency_id?: string; // Optional depending on Person C's query
  severity: number;
  status: string; // 'pending' | 'allocated' | 'discharged'
  types: string[];
}

// Matches Person A's 'resources' table schema
export interface Resource {
  id: string;
  type: string; // 'or_slot' | 'icu_bed' | 'staff' | 'equipment' | 'er_bay'
  status: string; // 'available' | 'occupied' | 'reserved' | 'offline'
  department: string;
}

// Matches the exact Groq tool schema requirements and Person A's 'bids' table
export interface Bid {
  round_id?: string;
  case_id: string;
  resource_id: string;
  bid_score: number;
  reasoning: string;
  conditions: string[]; // <-- Crucial missing field from the original MVP plan
}

// Matches Person A's 'allocations' table payload
export interface Allocation {
  case_id: string;
  resource_id: string;
}

// Matches the exact return signature Person C is expecting
export interface NegotiationResult {
  bids: Bid[];
  allocations: Allocation[];
  explanation: string;
}