const functions = require("firebase-functions");
const admin = require("firebase-admin");
const pdfParse = require("pdf-parse");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = getFirestore();
const storage = getStorage();

// --- 1. PDF Processing Function ---
// This function triggers when a new PDF is uploaded to Firebase Storage.
// It parses the PDF, chunks the text, and saves it to Firestore for embedding.
exports.processPDF = functions.storage.object().onFinalize(async (object) => {
  // Ensure we're processing a PDF file in the correct folder.
  if (!object.name.startsWith("uploads/") || !object.contentType.includes("pdf")) {
    functions.logger.log("Not a PDF file or not in uploads folder. Skipping.");
    return null;
  }

  functions.logger.log(`Processing file: ${object.name}`);

  try {
    // Download the PDF from Cloud Storage
    const fileBucket = storage.bucket(object.bucket);
    const pdfBuffer = await fileBucket.file(object.name).download();

    // Parse the PDF text content
    const data = await pdfParse(pdfBuffer[0]);
    const textContent = data.text;

    // Split the text into manageable chunks (e.g., by paragraph)
    const chunks = textContent.split(/\n\s*\n/).filter(chunk => chunk.trim().length > 50); // Only keep meaningful chunks
    
    functions.logger.log(`Extracted ${chunks.length} text chunks from ${object.name}.`);

    // Write each chunk to Firestore in the collection monitored by the Vector Search extension
    const batch = db.batch();
    const collectionRef = db.collection("manual_documents_chunks");
    
    chunks.forEach((chunk, index) => {
      const docRef = collectionRef.doc(); // Create a new document with a unique ID
      batch.set(docRef, {
        source_document: object.name,
        chunk_index: index,
        content: chunk, // This is the field the extension will embed
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();
    functions.logger.log(`Successfully saved ${chunks.length} chunks to Firestore.`);
    
  } catch (error) {
    functions.logger.error("Failed to process PDF:", error);
  }
  return null;
});


// --- 2. AI Response Function ---
// This is an HTTPS Callable function that the React app will call.
// It performs a vector search and gets a response from the Gemini AI.
exports.getAiResponse = functions.https.onCall(async (data, context) => {
  // Ensure the user is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }

  const { question, history } = data;
  if (!question) {
    throw new functions.https.HttpsError("invalid-argument", "The function must be called with a 'question'.");
  }

  try {
    // --- Vector Search ---
    // The Vector Search extension provides a way to query by similarity.
    // We first need to get the embedding for the user's question.
    const embeddingResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${functions.config().gemini.apikey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text: question }] } }),
      }
    );
    const embeddingData = await embeddingResponse.json();
    const questionEmbedding = embeddingData.embedding.values;

    // Now, query Firestore using the vector search index
    const searchResults = await db.collection("manual_documents_chunks").findNearest("embedding", questionEmbedding, {
      limit: 5, // Get the top 5 most relevant chunks
      distanceMeasure: "COSINE",
    });

    let relevantContext = "";
    searchResults.forEach(doc => {
        const docData = doc.data();
        relevantContext += `\n\n--- From document: ${docData.source_document} ---\n${docData.content}`;
    });

    if (relevantContext === "") {
        relevantContext = "No specific context found in the provided documents.";
    }

    // --- Build Prompt for Gemini ---
    const chatHistory = history.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    const prompt = `You are an expert EMD locomotive maintenance assistant. Answer the user's question based ONLY on the provided context from service manuals and the recent conversation history. If the context doesn't contain the answer, state that the information is not in your documents.

CONVERSATION HISTORY:
${chatHistory}

RELEVANT DOCUMENT CONTEXT:
${relevantContext}

USER's QUESTION:
${question}

ANSWER:`;

    // --- Call Gemini API ---
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${functions.config().gemini.apikey}`;
    
    const geminiResponse = await fetch(geminiApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    if (!geminiResponse.ok) {
        throw new Error(`Gemini API call failed with status: ${geminiResponse.status}`);
    }

    const result = await geminiResponse.json();

    if (result.candidates && result.candidates.length > 0) {
        return { response: result.candidates[0].content.parts[0].text };
    } else {
        throw new Error("The AI did not return a valid response.");
    }

  } catch (error) {
    functions.logger.error("Error in getAiResponse:", error);
    throw new functions.https.HttpsError("internal", "An error occurred while processing your request.");
  }
});

