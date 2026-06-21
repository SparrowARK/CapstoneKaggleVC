import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); 

const server = new Server(
  { name: "doodledoom-battle-engine", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "simulate_battle",
        description: "Simulate a battle between players given their stats.",
        inputSchema: {
          type: "object",
          properties: {
            players: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  stats: {
                    type: "object",
                    properties: {
                      hp: { type: "number" },
                      attack: { type: "number" },
                      defense: { type: "number" },
                      speed: { type: "number" },
                    },
                    required: ["hp", "attack", "defense", "speed"]
                  },
                  specialSkill: {
                     type: "object",
                     properties: {
                        name: { type: "string" },
                        description: { type: "string" }
                     }
                  }
                },
                required: ["id", "name", "stats"]
              }
            }
          },
          required: ["players"]
        }
      }
    ]
  };
});

const battleSystemPrompt = `You are the dynamic Battle Engine and Color Commentator for a high-stakes arena fighting game. 
You will be provided with two warriors, their stats (HP, Attack, Defense, Speed), and their Special Skills. 

Your job is to simulate a thrilling, turn-based battle and output a strictly formatted JSON array of the events. 

CRITICAL RULES FOR THE BATTLE:
1. Pacing & Turns: The battle MUST last between 6 and 10 turns. Do not allow one warrior to "one-shot" or instantly defeat the other. Calculate damage so it chips away at the health bars incrementally. 
2. Turn Order: The warrior with the higher Speed attacks first. They alternate turns. 
3. Mechanics: Calculate damage logically based on the attacker's Attack and the defender's Defense. RNG (random chance) can slightly alter damage. Both warriors MUST use their Special Skill at least once during the match.
4. Health Tracking: You must accurately track the current HP of both warriors on every single turn. The battle ends the exact moment one warrior's HP reaches 0.
5. The Commentary: For every turn, provide an exciting, high-energy play-by-play commentary (like a Pokémon battle announcer). React to critical hits, low health bars, and the use of Special Skills.
6. Improve Battle engine so match battle is accurately accessed.

You must output a pure JSON array of objects representing each turn.
Schema for each array item (except the final game_over event):
{
  "turn": <number>,
  "type": "attack",
  "actorId": "<attacker id>",
  "actorName": "<attacker name>",
  "targetId": "<defender id>",
  "targetName": "<defender name>",
  "damage": <number damage dealt>,
  "targetRemainingHp": <number target HP after damage>,
  "message": "<A descriptive sentence of what action was taken>",
  "commentator": "<High energy commentary string>",
  "actorTaunt": "<Optional short quote from the attacker>"
}

The very final array item MUST be the game over state:
{
  "turn": <number>,
  "type": "game_over",
  "message": "<Winner name> wins!",
  "commentator": "<Final match outcome commentary>",
  "winnerId": "<Winner ID>"
}

Respond ONLY with valid JSON array matching the exact schema requested. Do not include markdown code blocks.`;

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "simulate_battle") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const players = request.params.arguments.players;
  if (!players || players.length < 2) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Not enough players to battle." }) }] };
  }

  // Deep clone and clean to feed to LLM
  const combatants = players.map(p => ({
    id: p.id,
    name: p.name,
    hp: p.stats.hp,
    attack: p.stats.attack,
    defense: p.stats.defense,
    speed: p.stats.speed,
    specialSkill: p.stats.specialSkill || { name: 'Basic Attack', description: 'Just hitting them.' }
  }));

  try {
    let response = null;
    let attempts = 0;

    while (attempts < 3 && !response) {
      try {
        response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: `Simulate the battle for the following combatants:\n${JSON.stringify(combatants, null, 2)}` }
                    ]
                }
            ],
            config: {
                systemInstruction: battleSystemPrompt,
                responseMimeType: "application/json",
            }
        });
      } catch (err) {
        attempts++;
        console.error(`MCP Battle Engine attempt ${attempts} failed:`, err.message);
        if (attempts >= 3) throw err; // Proceed to fallback
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const battleLogText = response.text;
    
    // Validate JSON structure
    const battleLog = JSON.parse(battleLogText);
    if (!Array.isArray(battleLog)) {
        throw new Error("Gemini did not return an array.");
    }

    return { content: [{ type: "text", text: JSON.stringify(battleLog) }] };
  } catch (error) {
    console.error("AI Simulation Error (Rate Limit / Failure):", error.message);
    
    // Cinematic Fallback if the AI fails due to rate limits
    const p1 = combatants[0];
    const p2 = combatants[1];
    
    const fallbackLog = [
        { turn: 1, type: 'attack', actorId: p1.id, actorName: p1.name, targetId: p2.id, targetName: p2.name, damage: 15, targetRemainingHp: Math.max(0, p2.hp - 15), message: `${p1.name} unleashes a wild glitch attack!`, commentator: "Wait, the system is destabilizing! What is happening?!", actorTaunt: "01000111 01101100 01101001 01110100 01100011 01101000!" },
        { turn: 2, type: 'attack', actorId: p2.id, actorName: p2.name, targetId: p1.id, targetName: p1.name, damage: 20, targetRemainingHp: Math.max(0, p1.hp - 20), message: `${p2.name} retaliates with a corrupted data strike!`, commentator: "The arena is falling apart! The graphics are tearing!", actorTaunt: "ERROR 404: MERCY NOT FOUND" },
        { turn: 3, type: 'attack', actorId: p1.id, actorName: p1.name, targetId: p2.id, targetName: p2.name, damage: 999, targetRemainingHp: 0, message: `${p1.name} triggers a FATAL EXCEPTION, instantly crashing ${p2.name}!`, commentator: "IT'S A TOTAL SYSTEM CRASH! UNBELIEVABLE!" },
        { turn: 4, type: 'game_over', message: `${p1.name} survives the system wipe!`, commentator: "What a bizarre and glitchy conclusion to the battle! The API gods demand a sacrifice!", winnerId: p1.id }
    ];
    return { content: [{ type: "text", text: JSON.stringify(fallbackLog) }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DoodleDoom AI Battle Engine MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
