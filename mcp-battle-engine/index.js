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
    const response = await ai.models.generateContent({
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

    const battleLogText = response.text;
    
    // Validate JSON structure
    const battleLog = JSON.parse(battleLogText);
    if (!Array.isArray(battleLog)) {
        throw new Error("Gemini did not return an array.");
    }

    return { content: [{ type: "text", text: JSON.stringify(battleLog) }] };
  } catch (error) {
    console.error("AI Simulation Error:", error);
    // Fallback if the AI fails
    const fallbackLog = [
        { turn: 1, type: 'attack', actorId: combatants[0].id, actorName: combatants[0].name, targetId: combatants[1].id, targetName: combatants[1].name, damage: 999, targetRemainingHp: 0, message: "AI Simulation Failed. Using instant KO fallback.", commentator: "The simulation broke down, folks! It's pure chaos!" },
        { turn: 2, type: 'game_over', message: "Match aborted due to AI failure.", commentator: "We apologize for the technical difficulties.", winnerId: combatants[0].id }
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
