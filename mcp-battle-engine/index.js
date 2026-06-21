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
    specialSkill: p.specialSkill || { name: 'Basic Attack', description: 'A standard strike.' }
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
        if (attempts >= 3) throw err;
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
    console.error("AI Simulation Error — running local fallback battle:", error.message);
    
    // ─── Deterministic Fallback Battle Simulator ───
    const p1 = { ...combatants[0], currentHp: combatants[0].hp };
    const p2 = { ...combatants[1], currentHp: combatants[1].hp };

    // Faster warrior goes first
    const [first, second] = p1.speed >= p2.speed ? [p1, p2] : [p2, p1];
    const order = [first, second];

    const taunts = [
      "You're going down!", "Is that all you've got?", "Bring it on!",
      "Feel the fury!", "Too slow!", "You can't touch me!",
      "This ends now!", "Prepare yourself!", "No mercy!"
    ];

    const commentaryIntros = [
      "What an incredible move!", "The crowd goes wild!",
      "Absolutely devastating!", "What a display of power!",
      "The arena shakes!", "Unbelievable technique!",
      "The tension is electric!", "A masterful strike!"
    ];

    const specialCommentary = [
      "They're unleashing their secret weapon!", "Here comes the signature move!",
      "The crowd holds its breath!", "This is what we've been waiting for!"
    ];

    const fallbackLog = [];
    let turn = 0;
    let usedSpecial = { [first.id]: false, [second.id]: false };
    let gameOver = false;

    while (!gameOver) {
      for (const attacker of order) {
        if (gameOver) break;
        turn++;

        const defender = attacker.id === first.id ? second : first;

        // Decide whether to use special skill
        const shouldUseSpecial = !usedSpecial[attacker.id] && (
          turn >= 3 || defender.currentHp < defender.hp * 0.5 || Math.random() > 0.6
        );

        // Calculate damage
        let baseDamage = Math.max(1, attacker.attack - defender.defense * 0.4);
        let variance = baseDamage * (0.8 + Math.random() * 0.4); // 80-120% variance
        let damage = Math.round(variance);
        let actionMessage = '';
        let commentary = '';
        let taunt = taunts[Math.floor(Math.random() * taunts.length)];

        if (shouldUseSpecial) {
          usedSpecial[attacker.id] = true;
          damage = Math.round(damage * 1.5); // Special does 50% more
          actionMessage = `${attacker.name} activates ${attacker.specialSkill.name}! ${attacker.specialSkill.description}`;
          commentary = specialCommentary[Math.floor(Math.random() * specialCommentary.length)] +
            ` ${attacker.name}'s ${attacker.specialSkill.name} deals a massive ${damage} damage!`;
        } else {
          actionMessage = `${attacker.name} strikes ${defender.name} with a powerful blow for ${damage} damage!`;
          commentary = commentaryIntros[Math.floor(Math.random() * commentaryIntros.length)] +
            ` ${attacker.name} connects for ${damage} damage!`;
        }

        defender.currentHp = Math.max(0, defender.currentHp - damage);

        // Add low-HP tension commentary
        if (defender.currentHp > 0 && defender.currentHp < defender.hp * 0.25) {
          commentary += ` ${defender.name} is hanging by a thread!`;
        }

        fallbackLog.push({
          turn, type: 'attack',
          actorId: attacker.id, actorName: attacker.name,
          targetId: defender.id, targetName: defender.name,
          damage,
          targetRemainingHp: defender.currentHp,
          message: actionMessage,
          commentator: commentary,
          actorTaunt: taunt
        });

        if (defender.currentHp <= 0) {
          fallbackLog.push({
            turn: turn + 1, type: 'game_over',
            message: `${attacker.name} wins the battle!`,
            commentator: `What an epic showdown! ${attacker.name} emerges victorious after ${turn} grueling turns of combat! The arena erupts!`,
            winnerId: attacker.id
          });
          gameOver = true;
          break;
        }

        // Safety: end after 12 turns max to prevent infinite loops
        if (turn >= 12) {
          const winner = first.currentHp >= second.currentHp ? first : second;
          fallbackLog.push({
            turn: turn + 1, type: 'game_over',
            message: `${winner.name} wins by endurance!`,
            commentator: `After an exhausting ${turn}-turn slugfest, ${winner.name} stands tall with ${winner.currentHp} HP remaining! What a battle!`,
            winnerId: winner.id
          });
          gameOver = true;
          break;
        }
      }
    }

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
