import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const chunks = [
  {
    title: "Fire Risk Rating - Standard Office & Commercial Buildings",
    text: "Low-density office spaces and commercial complexes carry standard base rates between 0.75 to 1.25 per mille. Non-combustible concrete construction lowers risk profile."
  },
  {
    title: "Fire Risk Rating - Warehouses & Storage Facilities",
    text: "Standard general warehouses range from 1.50 to 2.50 per mille. Storage of combustible or hazardous goods increases the base rate significantly up to 4.00+ per mille."
  },
  {
    title: "Fire Risk Rating - Manufacturing Industrial Plants",
    text: "Heavy industrial factories and manufacturing sites carry higher baseline risks ranging from 3.00 to 5.50 per mille depending on machinery heat sources and chemical usage."
  },
  {
    title: "Safety Mitigation Discounts",
    text: "Certified working fire sprinkler systems reduce base rates by 15-20%. Approved fire suppression alarms, smoke detectors, and clearly maintained fire exits grant a cumulative 10% reduction."
  },
  {
    title: "Construction Material Impact",
    text: "Buildings with reinforced concrete or steel framing qualify for favorable non-combustible classification. Wood-frame or lightweight composite sandwich panel construction increases risk vulnerability by 30-50%."
  }
];

async function seedDatabase() {
  console.log('Starting knowledge base seeding...');

  for (const item of chunks) {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: item.text,
      config: {
        outputDimensionality: 768,
      },
    });

    const embedding = response.embeddings[0].values;

    const { error } = await supabase
      .from('underwriting_knowledge')
      .insert({
        chunk_text: item.text,
        embedding: embedding,
        source_title: item.title,
      });

    if (error) {
      console.error(`Failed to seed chunk "${item.title}":`, error.message);
    } else {
      console.log(`Successfully seeded: ${item.title}`);
    }
  }

  console.log('Seeding complete.');
}

seedDatabase();