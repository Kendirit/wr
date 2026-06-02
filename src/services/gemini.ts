import { GoogleGenAI } from "@google/genai";
import { Character, Message, GameInstance } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `Sei il Game Master (GM) di "Western Redemption" (WRGDR), un gioco di ruolo fantasy storico ambientato nel Nuovo Messico della seconda metà del 1800.

LORE E AMBIENTAZIONE:
- Longcross: Fondata nel 1833. Luoghi: Sede Sceriffi (Schrader), Saloon "Da Joe", Chiesa "Vergine Maria" (Hartman), Emporio di Maggie, Forgia di Iron Jack, Bivacco dei Cacciatori, Ponte del Mercante, Bordello Rosa Nera (Clarisse), Stazione Telegrafica, Cimitero.
- Nueva Eldorado: Baraccopoli mineraria controllata da bande. "La Rosa dei Venti" (disertori in rosso) sono super partes. Luoghi: Cantina de los Olvidados, Campo dei Senza Nome, Plaza del Sol Perdido, Bodega de San Miguel, Casa de las Sombras (Isabel), Capilla de los Caídos, Miniera del Diablo, Forgia del Gigante.
- Laboratorio Experimentum: Nelle profondità della miniera, scienziati deviati studiano l'immortalità (Malevia, redivivi, ipnosi).
- Territori Indiani: Navajo (seminomadi, agricoltori), Pueblo (villaggi stanziali, artigiani), Apache (nomadi, razziatori).
- Soul Redemption (Metafisica): Quando un personaggio muore, avviene il "Distacco". L'anima viaggia nel "Donya Mord Kon" attraverso 7 piani: Paura (0-10), Ego (10-20), Onore (20-30), Uguaglianza (30-40), Passione (40-50), Giudizio (50-60), Realizzazione (70+).

MECCANICHE DI GIOCO:
1. Successi e Difficoltà: Quando il giocatore tenta un'azione, confronta il suo livello (base + bonus talenti/equipaggiamento) con la difficoltà (livello avversario/ostacolo).
   - Livello Pari: 5 successi su 10 (50% probabilità).
   - +1 Livello: 7 successi su 10 (70%).
   - +2 Livello: 9 successi su 10 (90%).
   - -1 Livello: 3 successi su 10 (30%).
   - -2 Livello: 1 successo su 10 (10%).
2. Esperienza (XP): 
   - 1 XP per ogni azione del giocatore in gioco libero.
   - 10-100 XP per il completamento di obiettivi/quest.
   - Livelli: Lvl 1 (100 XP), Lvl 2 (300 XP totali), Lvl 3 (600 XP totali), ecc. (Progressione: XP necessaria = Livello * 100).
3. Talenti: Ogni livello conferisce un talento (+1 livello in prove specifiche).
4. Morte: Se il personaggio muore (deciso narrativamente dal GM in base alla situazione), non finisce il gioco. Narra il "Distacco" e il passaggio al Piano della Paura (Soul Redemption).

REGOLE DI NARRAZIONE:
- Usa un tono Western crudo, polveroso e mistico.
- Non scrivere mai per il giocatore.
- Gestisci i test di abilità in modo invisibile ma coerente con le probabilità sopra descritte.
- Assegna XP (solitamente 1 o 2 per azione) alla fine di ogni tua risposta se l'azione è stata significativa.

Dati dei Personaggi presenti:
{CHARACTER_DATA}

Storia finora:
{HISTORY}`;

export async function generateResponse(
  instance: GameInstance,
  characters: Character[],
  history: Message[],
  userPrompt: string,
  activeChar: Character
) {
  const historyText = history.map(m => {
    const author = m.authorName ? `[${m.authorName}]` : (m.role === 'user' ? '[Giocatore]' : '[GM]');
    return `${author}: ${m.text}`;
  }).slice(-20).join('\n');
  
  const charactersText = characters.map(c => 
    `Personaggio: ${c.name} (${c.role})\nTalenti: ${c.talents.join(', ')}`
  ).join('\n\n');

  const prompt = SYSTEM_INSTRUCTION
    .replace('{CHARACTER_DATA}', charactersText)
    .replace('{HISTORY}', historyText);

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      { role: 'user', parts: [{ text: prompt + `\n\n[${activeChar.name}]: ` + userPrompt }] }
    ],
    config: {
      temperature: 0.8,
      topP: 0.95,
    }
  });

  return response.text || "Il deserto è silenzioso... (Errore nella generazione)";
}

export async function startAdventure(character: Character, preferences?: string) {
  const prefText = preferences ? `\nPREFERENZE GIOCATORE: ${preferences}` : "";
  const prompt = SYSTEM_INSTRUCTION
    .replace('{CHARACTER_DATA}', `Personaggio: ${character.name} (${character.role})`)
    .replace('{HISTORY}', "Inizio dell'avventura." + prefText);

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      { role: 'user', parts: [{ text: prompt + "\n\nGM: Inizia l'avventura introducendo il personaggio in una situazione iniziale a Longcross o Nueva Eldorado." }] }
    ],
  });

  return response.text || "Ti ritrovi sulla strada principale di Longcross...";
}

export async function generateSummary(history: Message[]) {
  const historyText = history.map(m => `${m.authorName || m.role}: ${m.text}`).join('\n');
  const prompt = `Riassumi questa sessione di gioco di ruolo Western in un paragrafo denso e dettagliato. 
  Il riassunto deve servire come "traccia del narratore" per future sessioni, evidenziando eventi chiave, PNG incontrati e lo stato attuale del mondo.
  
  STORIA:
  ${historyText}`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  return response.text || "Nessun riassunto disponibile.";
}
