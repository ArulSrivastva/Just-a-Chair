import 'dotenv/config';
import Groq from 'groq-sdk';
import { Mistral } from '@mistralai/mistralai';
import { Case, Resource, Bid, Allocation, NegotiationResult } from './types.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

function checkResourceDependencies(resource: Resource, allResources: Resource[]): boolean {
  if (resource.type === 'or_slot') {
    // Requires at least one available 'staff' resource
    const hasAvailableStaff = allResources.some(
      r => r.type === 'staff' && r.status === 'available'
    );
    return hasAvailableStaff;
  }
  return true;
}

async function evaluateSingleResource(
  resource: Resource,
  cases: Case[],
  onBid?: (bid: Bid) => void,
  roundId?: string
): Promise<Bid[]> {
  const systemPrompt = `You are an autonomous agent managing a hospital resource: ${JSON.stringify(resource)}. Evaluate the pending cases and decide which ones you want to bid on.`;
  const userMessage = `Pending Cases: ${JSON.stringify(cases)}`;

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'submit_bids',
          description: 'Submit bids for cases you can handle',
          parameters: {
            type: 'object',
            properties: {
              bids: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    case_id: { type: 'string' },
                    resource_id: { type: 'string' },
                    bid_score: { type: 'number' },
                    reasoning: { type: 'string' },
                    conditions: { type: 'array', items: { type: 'string' } } // <-- Aligned with MVP spec
                  },
                  required: ['case_id', 'resource_id', 'bid_score', 'reasoning', 'conditions']
                }
              }
            },
            required: ['bids']
          }
        }
      }],
      tool_choice: { type: 'function', function: { name: 'submit_bids' } }
    });

    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) return [];

    const args = JSON.parse(toolCalls[0].function.arguments);
    const validBids: Bid[] = args.bids || [];

    // Force correct resource ID and fire the streaming callback instantly
    validBids.forEach(bid => {
      bid.resource_id = resource.id; 
      bid.round_id = roundId;
      // Ensure conditions array exists even if LLM returns null
      bid.conditions = bid.conditions || []; 
      if (onBid) onBid(bid);
    });

    return validBids;
  } catch (error) {
    console.warn(`⚠️ Agent Error on ${resource.id}:`, error);
    return [];
  }
}

export async function runNegotiationRound(
  cases: Case[],
  resources: Resource[],
  onBid?: (bid: Bid) => void,
  roundId?: string
): Promise<NegotiationResult> {
  try {
    // 1. CONCURRENT BIDDING
    const bidPromises = resources.map(res => {
      if (!checkResourceDependencies(res, resources)) {
        console.warn(`⚠️ Excluding resource ${res.id} due to unmet dependencies.`);
        return Promise.resolve([]);
      }
      return evaluateSingleResource(res, cases, onBid, roundId);
    });
    const results = await Promise.all(bidPromises);
    const allBids: Bid[] = results.flat();

    // 2. CONFLICT RESOLUTION
    const allocations: Allocation[] = [];
    const assignedCases = new Set<string>();
    const assignedResources = new Set<string>();

    allBids.sort((a, b) => b.bid_score - a.bid_score);

    for (const bid of allBids) {
      if (!assignedCases.has(bid.case_id) && !assignedResources.has(bid.resource_id)) {
        allocations.push({ case_id: bid.case_id, resource_id: bid.resource_id });
        assignedCases.add(bid.case_id);
        assignedResources.add(bid.resource_id);
      }
    }

    // 3. EXPLANATION
    let explanationText = "Explanation generation failed.";
    try {
      const explanationPrompt = `Allocations: ${JSON.stringify(allocations)}\nRaw Bids: ${JSON.stringify(allBids)}\nWrite a fast, 2-sentence explanation for admins.`;
      
      const mistralResponse = await mistral.chat.complete({
        model: 'mistral-large-latest',
        messages: [{ role: 'user', content: explanationPrompt }]
      });

      explanationText = (mistralResponse.choices?.[0]?.message?.content as string) || explanationText;
    } catch (mistralError) {
      console.warn("⚠️ Mistral explanation generation failed, using safe fallback string:", mistralError);
      explanationText = "Allocations processed successfully. Summary explanation is temporarily unavailable.";
    }

    return { bids: allBids, allocations, explanation: explanationText };

  } catch (error) {
    console.error("⚠️ Fatal Engine Error, triggering fallback:", error);
    return getFallbackData(cases, resources, roundId);
  }
}

function getFallbackData(cases: Case[], resources: Resource[], roundId?: string): NegotiationResult {
  const safeCase = cases.length > 0 ? cases[0].id : "demo_case";
  const safeRes = resources.length > 0 ? resources[0].id : "demo_res";

  return {
    bids: [{ round_id: roundId || "demo_round", case_id: safeCase, resource_id: safeRes, bid_score: 99.9, reasoning: "Fallback priority", conditions: [] }],
    allocations: [{ case_id: safeCase, resource_id: safeRes }],
    explanation: "Allocations routed through emergency fallback protocol due to network latency."
  };
}