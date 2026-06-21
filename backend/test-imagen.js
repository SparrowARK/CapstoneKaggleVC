import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testImageGen() {
    try {
        console.log("Requesting image...");
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: 'A vibrant, high-quality cartoon-style warrior turtle mech with laser cannons.',
            config: {
                numberOfImages: 1,
                outputMimeType: "image/jpeg",
                aspectRatio: "1:1"
            }
        });
        
        console.log("Success!");
        console.log("Image bytes preview:", response.generatedImages[0].image.imageBytes.substring(0, 50));
    } catch (err) {
        console.error("Failed to generate image:", err);
    }
}

testImageGen();
