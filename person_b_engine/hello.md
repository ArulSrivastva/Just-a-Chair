# Master Execution Plan: Multi-Agent Emergency Resource Negotiation

**Event:** 4-Hour Hackathon Sprint
**Platform:** Health Tech Multi-Agent Resource Allocator

## 1. Project Overview & Tech Stack
A real-time, AI-driven platform that allows hospital resources (ICU beds, ORs, staff) to act as autonomous agents and bid on incoming emergencies. The platform resolves constraints and broadcasts the live negotiation feed to the frontend.

* **Frontend:** Next.js, React, Tailwind (Vercel)
* **Backend:** Express (Node.js/TypeScript) (Render/Fly.io)
* **Database:** Supabase (PostgreSQL)
* **Real-time:** Server-Sent Events (SSE) (Native one-directional server push)
* **Cache / Orchestration:** Upstash Redis
* **AI / Agents:** Groq (Llama 3.1 8B/70B for fast bidding), Mistral (for explainability)

---

## 2. Division of Labor (Backend)
The backend is split by **function**, not by tool, to ensure no one blocks anyone else.

### Person A: The Plumber (Data & I/O)
* **Scope:** Owns the Supabase database, REST routes, and the SSE realtime stream.
* **Rules:** Does NOT touch AI logic or scheduling. Only exposes functions for others to call.
* **Key Deliverables:** * Supabase Schema (7 tables: emergencies, cases, resources, resource_dependencies, bids, allocations, audit_log).
  * Fake/Live toggle (`DATA_LAYER=fake|live`) for early testing.
  * REST Endpoints and the `/emergencies/:id/stream` SSE endpoint with a 30s heartbeat.

### Person B: The Brain (AI Engine)
* **Scope:** Owns the multi-agent negotiation logic using Groq and Mistral.
* **Rules:** Pure function only. Does NOT touch Supabase, Redis, or Express. Takes arrays in, returns arrays out.
* **Key Deliverables:** * Tool-calling logic for agents to submit bids.
  * Dependency and conflict resolution logic (highest valid score wins).
  * Real-time streaming via an `onBid` callback.

### Person C: The Conductor (Orchestration)
* **Scope:** Owns the timing, scheduling, and Redis debounce logic.
* **Rules:** Does NOT write DB queries or AI prompts. Just calls Person A and B's functions.
* **Key Deliverables:** * `triggerRound` function that glues A and B together.
  * Upstash Redis logic to debounce rapid case updates during mass-casualty events.

---

## 3. The Locked API Contracts (Signatures)
These function signatures are locked. Everyone builds against these exact shapes.

**Exported by Person A (`data-layer.ts`):**
```typescript
// 1. Fetch current state
export async function loadState(emergencyId: string): Promise<{ cases: Case[], resources: Resource[] }>

// 2. Save the bids (Person B's output)
export async function saveBids(roundId: string, bids: Bid[]): Promise<void>

// 3. Save the final allocation and explanation
export async function saveResult(roundId: string, allocations: Allocation[], explanation: string): Promise<void>

// 4. Send real-time SSE events to the frontend
export function broadcast(emergencyId: string, event: string, payload: object): void

// 5. Check emergency status (Used by Person C to stop loops)
export async function getEmergency(emergencyId: string): Promise<Emergency>

// 6. Mark emergency as finished
export async function resolveEmergency(emergencyId: string): Promise<void>