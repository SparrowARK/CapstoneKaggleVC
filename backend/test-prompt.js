import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure you have a GEMINI_API_KEY in your .env file
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const systemInstruction = `You are the DoodleDoom Vision Agent. Your task is to evaluate a drawing and generate balanced stats for an auto-battler game.
The drawing will be based on a specific prompt.

You MUST return a pure JSON object containing EXACTLY the following structure:
{
  "matchScore": <number between 0-100 indicating how well the drawing matches the prompt>,
  "stats": {
    "hp": <number between 50-200>,
    "attack": <number between 10-50>,
    "defense": <number between 5-40>,
    "speed": <number between 10-100>
  },
  "specialSkill": {
    "name": "<Creative skill name based on drawing>",
    "description": "<What it does in the battle context>"
  },
  "reasoning": "<A brief one-sentence explanation of why these stats were chosen based on visual features>"
}

Rules for balancing:
- Higher 'matchScore' should generally yield slightly better total stats.
- Distribute stats based on visuals: e.g., spiky/sharp elements -> higher attack; bulky/round -> higher defense/hp; streamlined/wheels -> higher speed.
- Do NOT wrap the JSON in markdown code blocks, return ONLY raw JSON.`;

async function testPrompt() {
    const sampleImagePath = path.join(__dirname, 'sample.jpg'); // Ensure you have a sample.jpg here
    const prompt = "A defensive turtle-mech with laser cannons";

    if (!fs.existsSync(sampleImagePath)) {
        console.error("Please place a 'sample.jpg' in the backend directory to test.");
        return;
    }

    const imagePart = {
        inlineData: {
            data: Buffer.from(fs.readFileSync(sampleImagePath)).toString("base64"),
            mimeType: "image/jpeg"
        }
    };

    console.log("Evaluating drawing...");

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: `Evaluate this drawing for the prompt: "${prompt}"` },
                        imagePart
                    ]
                }
            ],
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
            }
        });

        console.log("Raw Response:");
        console.log(response.text());

        // Test parsing
        const parsed = JSON.parse(response.text());
        console.log("\nParsed successfully!");
        console.log(parsed);

    } catch (err) {
        console.error("Error evaluating prompt:", err);
    }
}

testPrompt();
