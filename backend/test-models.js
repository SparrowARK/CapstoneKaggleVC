import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function listModels() {
    try {
        const response = await ai.models.list();
        for await (const model of response) {
            console.log(model.name);
        }
    } catch (err) {
        console.error("Failed:", err);
    }
}

listModels();
