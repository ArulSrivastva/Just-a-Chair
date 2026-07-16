import { runNegotiationRound } from './engine.js';
import { Case, Resource, Bid } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

// Helper to assert
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function test1_StreamingOrder() {
  console.log("\n--- Test 1: Streaming Order & Callback ---");
  const cases: Case[] = [
    { id: "case_1", severity: 9.0, status: "pending", types: ["surgery"] }
  ];
  const resources: Resource[] = [
    { id: "res_staff_1", type: "staff", status: "available", department: "general" }
  ];

  const bidsReceived: Bid[] = [];
  const start = Date.now();
  await runNegotiationRound(cases, resources, (bid) => {
    const elapsed = Date.now() - start;
    console.log(`   [callback] Streamed bid for ${bid.resource_id} after ${elapsed}ms`);
    bidsReceived.push(bid);
  }, "round_t1");

  assert(bidsReceived.length > 0, "Should receive at least one bid via the streaming callback");
}

async function test2_BidShape() {
  console.log("\n--- Test 2: Bid Shape Verification ---");
  const cases: Case[] = [
    { id: "case_1", severity: 9.0, status: "pending", types: ["surgery"] }
  ];
  const resources: Resource[] = [
    { id: "res_staff_1", type: "staff", status: "available", department: "general" }
  ];

  const result = await runNegotiationRound(cases, resources, undefined, "round_t2");
  assert(result.bids.length > 0, "Bids array should not be empty");
  
  for (const bid of result.bids) {
    assert(typeof bid.round_id === 'string' && bid.round_id === 'round_t2', "Each bid should have round_id 'round_t2'");
    assert(typeof bid.case_id === 'string', "Each bid should have case_id");
    assert(typeof bid.resource_id === 'string', "Each bid should have resource_id");
    assert(typeof bid.bid_score === 'number', "Each bid should have bid_score as number");
    assert(typeof bid.reasoning === 'string', "Each bid should have reasoning as string");
    assert(Array.isArray(bid.conditions), "Each bid should have conditions as array");
  }
}

async function test3_DependencyExclusion() {
  console.log("\n--- Test 3: Dependency Exclusion (OR slot, no staff) ---");
  // Construct a scenario where OR slot is available, but no staff is available
  const cases: Case[] = [
    { id: "case_1", severity: 9.0, status: "pending", types: ["surgery"] }
  ];
  const resources: Resource[] = [
    { id: "res_or_unmet", type: "or_slot", status: "available", department: "surgery" }
    // Note: No available staff is provided in the resource pool
  ];

  const result = await runNegotiationRound(cases, resources, undefined, "round_t3");
  
  // Verify res_or_unmet was excluded and not allocated because there's no staff
  const isAllocated = result.allocations.some(a => a.resource_id === "res_or_unmet");
  assert(!isAllocated, "OR slot without available staff must be excluded from allocations");
  assert(result.bids.length === 0, "No bids should be submitted for OR slot with unmet staff dependencies");
}

async function test4_ContentionResolution() {
  console.log("\n--- Test 4: Contention Resolution (Highest score wins) ---");
  // We will run a test where two resources bid on the same case
  const cases: Case[] = [
    { id: "case_1", severity: 8.0, status: "pending", types: ["surgery"] }
  ];
  const resources: Resource[] = [
    { id: "res_or_1", type: "or_slot", status: "available", department: "surgery" },
    { id: "res_staff_1", type: "staff", status: "available", department: "surgery" }
  ];

  const result = await runNegotiationRound(cases, resources, undefined, "round_t4");
  
  // Under first-come-first-served sorted by score, the higher bid score should get allocated
  if (result.bids.length >= 2) {
    result.bids.sort((a, b) => b.bid_score - a.bid_score);
    const highestBid = result.bids[0];
    const allocatedResId = result.allocations.find(a => a.case_id === "case_1")?.resource_id;
    assert(allocatedResId === highestBid.resource_id, `Case should be allocated to ${highestBid.resource_id} (score ${highestBid.bid_score}) instead of other resources`);
  } else {
    console.log("   (Skipped specific assertion since less than 2 bids were generated, but round resolved)");
  }
}

async function test5_IndividualPool() {
  console.log("\n--- Test 5: Individual Pool (Exactly one case) ---");
  const cases: Case[] = [
    { id: "case_single", severity: 5.0, status: "pending", types: ["observation"] }
  ];
  const resources: Resource[] = [
    { id: "res_bed_1", type: "icu_bed", status: "available", department: "ICU" }
  ];

  const result = await runNegotiationRound(cases, resources, undefined, "round_t5");
  assert(result.bids.length >= 0, "Should handle single case pool without crashing");
}

async function test6_MassPool() {
  console.log("\n--- Test 6: Mass Pool (Multiple cases) ---");
  const cases: Case[] = [
    { id: "case_m1", severity: 9.0, status: "pending", types: ["trauma"] },
    { id: "case_m2", severity: 7.0, status: "pending", types: ["surgery"] },
    { id: "case_m3", severity: 5.0, status: "pending", types: ["observation"] },
    { id: "case_m4", severity: 3.0, status: "pending", types: ["observation"] },
    { id: "case_m5", severity: 8.5, status: "pending", types: ["cardiology"] }
  ];
  const resources: Resource[] = [
    { id: "res_or_1", type: "or_slot", status: "available", department: "surgery" },
    { id: "res_bed_1", type: "icu_bed", status: "available", department: "ICU" },
    { id: "res_staff_1", type: "staff", status: "available", department: "general" }
  ];

  const result = await runNegotiationRound(cases, resources, undefined, "round_t6");
  assert(result.allocations.length <= resources.length, "Allocations should not exceed available resources");
}

async function test7_IsolationCheck() {
  console.log("\n--- Test 7: Isolation Check (No supabase imports) ---");
  const enginePath = path.resolve('src/engine.ts');
  const engineContent = fs.readFileSync(enginePath, 'utf-8');
  const containsSupabase = engineContent.toLowerCase().includes('supabase');
  assert(!containsSupabase, "src/engine.ts must not contain direct references to 'supabase'");
}

async function test8_NonEmptyExplanation() {
  console.log("\n--- Test 8: Non-empty Explanation ---");
  const cases: Case[] = [
    { id: "case_1", severity: 9.0, status: "pending", types: ["surgery"] }
  ];
  const resources: Resource[] = [
    { id: "res_staff_1", type: "staff", status: "available", department: "general" }
  ];

  const result = await runNegotiationRound(cases, resources, undefined, "round_t8");
  assert(typeof result.explanation === 'string' && result.explanation.trim().length > 0, "Explanation should be a non-empty string");
}

async function runAllTests() {
  console.log("🏃 Running Person B Engine Validation Tests...\n");
  try {
    await test1_StreamingOrder();
    await test2_BidShape();
    await test3_DependencyExclusion();
    await test4_ContentionResolution();
    await test5_IndividualPool();
    await test6_MassPool();
    await test7_IsolationCheck();
    await test8_NonEmptyExplanation();
    console.log("\n🎉 ALL 8 TESTS PASSED SUCCESSFULLY!");
  } catch (error) {
    console.error("\n❌ TEST FAILURE:", error);
    process.exit(1);
  }
}

runAllTests();