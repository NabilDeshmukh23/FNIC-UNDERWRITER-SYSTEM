import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { createRequire } from 'module';
import Groq from 'groq-sdk';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

process.on('uncaughtException', (err) => console.error('CRITICAL UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('CRITICAL UNHANDLED REJECTION:', reason));

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function chatJson(systemPrompt, userPrompt, model = 'openai/gpt-oss-120b') {
  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${userPrompt}\n\nRespond strictly in valid JSON format.` }
    ],
    response_format: { type: 'json_object' },
  });

  const content = (response.choices[0]?.message?.content ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  return JSON.parse(content);
}
// ------------------------------ Google GenAI Helpers ------------------------------



async function embed(input) {
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: input.slice(0, 20000),
    config: { outputDimensionality: 768 },
  });
  
  const vector = response.embeddings?.[0]?.values;
  if (!vector) throw new Error('Embedding response contained no vector');
  return vector;
}

// ------------------------------ Gmail setup ------------------------------

const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

// ------------------------------ Constants ------------------------------

const BUCKET = 'quote-documents';

const REQUIRED_DOCUMENT_TYPES = [
  'proposal_form',
  'schedule_of_insurance',
  'valuation_report',
  'fire_safety_certificate',
];

const DOCUMENT_TYPE_LABELS = {
  proposal_form: 'Proposal Form',
  schedule_of_insurance: 'Schedule of Insurance',
  valuation_report: 'Valuation Report',
  fire_safety_certificate: 'Fire Safety Certificate',
  other: 'Other / Unrecognised',
};

const EXTRACTION_PROMPTS = {
  proposal_form: `Extract as JSON:
- insuredName, businessDescription, riskAddress
- occupancyType, constructionType, numberOfFloors
- fireSafetyMeasures: list of strings
- hazardousMaterialsStored: string or null
- claimsHistory: string`,
  schedule_of_insurance: `Extract as JSON:
- items: list of {name, value}
- totalSumInsured: number
- currency: string
- policyPeriod: string`,
  valuation_report: `Extract as JSON:
- valuerName, valuationDate
- reinstatementValue: number
- marketValue: number
- constructionType, propertyDescription`,
  fire_safety_certificate: `Extract as JSON:
- issuingAuthority, certificateNumber, issueDate, expiryDate
- premisesAddress
- protectionSystemsListed: list of strings
- deficienciesNoted: string or null`,
  other: `Extract as JSON any useful fields you can identify:
- summary: string
- keyFields: list of {name, value}`,
};

// ------------------------------ Text extraction ------------------------------

async function extractDocumentText(buffer, filename) {
  if (filename.toLowerCase().endsWith('.pdf')) {
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return (result.text || '').trim();
    } catch (err) {
      console.error('PDF text extraction failed', filename, err.message);
      return '';
    }
  }
  try {
    return buffer.toString('utf8').trim();
  } catch {
    return '';
  }
}

// ------------------------------ Classification ------------------------------

async function classifyDocument(documentId) {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, extracted_text')
    .eq('id', documentId)
    .single();
  if (error || !doc) throw new Error(error?.message ?? 'Document not found');

  const text = (doc.extracted_text ?? '').slice(0, 12000);
  if (!text) {
    await supabase
      .from('documents')
      .update({ document_type: 'other', classification_confidence: 'low' })
      .eq('id', documentId);
    return { documentType: 'other', confidence: 'low' };
  }

  const result = await chatJson(
    'You are an insurance document classification assistant. Respond with JSON only.',
    `Classify this insurance document into exactly one of these types:
proposal_form, schedule_of_insurance, valuation_report, fire_safety_certificate, other

Base your answer only on the document's content, not any filename.
Also state your confidence: high or low.

Document text:
"""
${text}
"""

Respond in JSON: {"documentType": "...", "confidence": "high|low"}`
  );

  const allowed = [...REQUIRED_DOCUMENT_TYPES, 'other'];
  const documentType = allowed.includes(result.documentType) ? result.documentType : 'other';
  const confidence = result.confidence === 'high' ? 'high' : 'low';

  await supabase
    .from('documents')
    .update({ document_type: documentType, classification_confidence: confidence })
    .eq('id', documentId);

  return { documentType, confidence };
}

// ------------------------------ Field extraction ------------------------------

async function extractDocumentFields(documentId) {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, extracted_text, document_type')
    .eq('id', documentId)
    .single();
  if (error || !doc) throw new Error(error?.message ?? 'Document not found');

  const text = (doc.extracted_text ?? '').slice(0, 15000);
  if (!text) return {};

  const type = doc.document_type ?? 'other';
  const fields = await chatJson(
    'You extract structured data from insurance documents. Respond with JSON only. Use null when a field is not present.',
    `${EXTRACTION_PROMPTS[type] ?? EXTRACTION_PROMPTS.other}

Document text:
"""
${text}
"""`
  );

  await supabase.from('documents').update({ extracted_fields: fields }).eq('id', documentId);
  return fields;
}

// ------------------------------ Completeness ------------------------------

async function checkCompleteness(submissionId) {
  const { data: docs, error } = await supabase
    .from('documents')
    .select('document_type')
    .eq('submission_id', submissionId);
  if (error) throw new Error(error.message);

  const found = new Set((docs ?? []).map((d) => d.document_type));
  const missing = REQUIRED_DOCUMENT_TYPES.filter((t) => !found.has(t));
  const status = missing.length === 0 ? 'ready_for_review' : 'incomplete';

  await supabase
    .from('submissions')
    .update({ status, missing_document_types: missing })
    .eq('id', submissionId);

  return { status, missing };
}

// ------------------------------ Document ingestion helper ------------------------------

async function addDocumentToSubmission({ submissionId, filename, buffer, contentType }) {
  const path = `${submissionId}/${Date.now()}-${filename.replace(/[^\w.\-]/g, '_')}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (uploadError) console.error('Storage upload failed', uploadError.message);

  const text = await extractDocumentText(buffer, filename);

  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      submission_id: submissionId,
      file_url: uploadError ? null : path,
      original_filename: filename,
      extracted_text: text,
    })
    .select('id')
    .single();
  if (error || !doc) throw new Error(error?.message ?? 'Could not save document');

  await classifyDocument(doc.id);
  await extractDocumentFields(doc.id);
  return doc.id;
}

// ------------------------------ 1. Check inbox ------------------------------

app.post('/api/check-inbox', async (req, res) => {
  try {
    const label = req.body?.label;
    console.log('--- Polling Gmail Inbox ---');

    const query = `${label ? `label:${label} ` : 'label:FireQuotes '}is:unread has:attachment`;
    let list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 10 });
    if (!list.data.messages?.length) {
      list = await gmail.users.messages.list({
        userId: 'me',
        q: `${label ? `label:${label} ` : 'label:FireQuotes '}is:unread`,
        maxResults: 10,
      });
    }

    const messages = list.data.messages ?? [];
    console.log(`Found ${messages.length} unread messages.`);
    const results = [];

    for (const msgSummary of messages) {
      try {
        const { data: existing } = await supabase
          .from('submissions')
          .select('id')
          .eq('gmail_message_id', msgSummary.id)
          .maybeSingle();
        if (existing) {
          results.push({ messageId: msgSummary.id, submissionId: existing.id, skipped: true });
          continue;
        }

        const msg = await gmail.users.messages.get({ userId: 'me', id: msgSummary.id });
        const headers = msg.data.payload.headers || [];
        const headerValue = (name) =>
          headers.find((h) => (h.name || '').toLowerCase() === name.toLowerCase())?.value ?? '';

        const sender = headerValue('From');
        const emailMatch = sender.match(/<([^>]+)>/);
        const brokerEmail = emailMatch ? emailMatch[1] : sender;
        const brokerName = sender.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
        const subject = headerValue('Subject');

        const { data: submission, error: subError } = await supabase
          .from('submissions')
          .insert({
            broker_email: brokerEmail,
            broker_name: brokerName || brokerEmail,
            subject: subject || '(no subject)',
            gmail_message_id: msgSummary.id,
            status: 'processing',
          })
          .select('id')
          .single();
        if (subError || !submission) throw subError ?? new Error('Could not create submission');

        const attachments = [];
        const walk = (part) => {
          if (!part) return;
          if (part.filename && part.body?.attachmentId) {
            attachments.push({
              filename: part.filename,
              mimeType: part.mimeType || 'application/octet-stream',
              attachmentId: part.body.attachmentId,
            });
          }
          (part.parts ?? []).forEach(walk);
        };
        walk(msg.data.payload);

        for (const attachment of attachments) {
          try {
            const attResp = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: msgSummary.id,
              id: attachment.attachmentId,
            });
            if (!attResp.data.data) continue;
            const b64 = attResp.data.data.replace(/-/g, '+').replace(/_/g, '/');
            await addDocumentToSubmission({
              submissionId: submission.id,
              filename: attachment.filename,
              buffer: Buffer.from(b64, 'base64'),
              contentType: attachment.mimeType,
            });
          } catch (attErr) {
            console.error('Attachment processing failed', attachment.filename, attErr.message);
          }
        }

        if (attachments.length === 0) {
          let body = '';
          const findText = (part) => {
            if (!part) return;
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body += Buffer.from(
                part.body.data.replace(/-/g, '+').replace(/_/g, '/'),
                'base64'
              ).toString('utf8');
            }
            (part.parts ?? []).forEach(findText);
          };
          findText(msg.data.payload);
          if (body.trim()) {
            await addDocumentToSubmission({
              submissionId: submission.id,
              filename: 'email-body.txt',
              buffer: Buffer.from(body, 'utf8'),
              contentType: 'text/plain',
            });
          }
        }

        await checkCompleteness(submission.id);

        try {
          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: { ids: [msgSummary.id], removeLabelIds: ['UNREAD'] },
          });
        } catch (markErr) {
          console.error('Could not mark message processed', markErr.message);
        }

        results.push({
          messageId: msgSummary.id,
          submissionId: submission.id,
          skipped: false,
          attachments: attachments.length,
        });
      } catch (msgErr) {
        results.push({ messageId: msgSummary.id, error: msgErr.message });
      }
    }

    res.json({ success: true, checked: messages.length, results });
  } catch (error) {
    console.error('=== ERROR CHECKING INBOX ===', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------ 2. Classify one document ------------------------------

app.post('/api/documents/:id/classify', async (req, res) => {
  try {
    const result = await classifyDocument(req.params.id);
    res.json({ success: true, classification: result });
  } catch (error) {
    console.error('Classification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------ 3. Extract fields ------------------------------

app.post('/api/documents/:id/extract-fields', async (req, res) => {
  try {
    const fields = await extractDocumentFields(req.params.id);
    res.json({ success: true, extractedFields: fields });
  } catch (error) {
    console.error('Field extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------ 4. Completeness check ------------------------------

app.post('/api/submissions/:id/check-completeness', async (req, res) => {
  try {
    const result = await checkCompleteness(req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Completeness check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------ 5. RAG risk assessment ------------------------------

app.post('/api/submissions/:id/generate-assessment', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('id, status, broker_name')
      .eq('id', id)
      .single();
    if (subError || !submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission.status !== 'ready_for_review' && submission.status !== 'reviewed') {
      return res.status(400).json({
        error:
          'Assessment can only run once every required document is present (status must be ready for review).',
      });
    }

    const { data: docs } = await supabase
      .from('documents')
      .select('document_type, extracted_fields, original_filename')
      .eq('submission_id', id);

    const profile = (docs ?? [])
      .map(
        (d) =>
          `## ${DOCUMENT_TYPE_LABELS[d.document_type ?? 'other'] ?? 'Other'} (${d.original_filename})\n${JSON.stringify(
            d.extracted_fields ?? {},
            null,
            2
          )}`
      )
      .join('\n\n');

    const queryVector = await embed(
      `Fire insurance risk rating for the following property profile:\n${profile}`.slice(0, 8000)
    );

    const { data: chunks, error: rpcError } = await supabase.rpc('match_underwriting_knowledge', {
      query_embedding: queryVector,
      match_count: 5,
    });
    if (rpcError) throw rpcError;

    const knowledge = (chunks ?? [])
      .map((c) => `### ${c.source_title}\n${c.chunk_text}`)
      .join('\n\n');

   const result = await chatJson(
      'You are a Fire insurance underwriting assistant. Respond with JSON only.',
      `You are assisting a Fire insurance underwriter in drafting an INDICATIVE (non-binding) premium.

Property details:
${profile}

Underwriting guidance (retrieved from knowledge base):
${knowledge}

Use this strict rating approach to draft the indicative premium:
1. Start from the base rate per mille (per 1,000 of sum insured) found in the underwriting guidance.
2. Apply mandatory risk adjustments explicitly:
   - Building Age Loading: Add +0.25‰ if the building age from the valuation report is 5 years or older.
   - Claims History Loading: Add +0.10‰ per historical claim reported in the 5-year loss history.
   - Fire Safety Discount: Subtract -0.15‰ if full active wet-pipe sprinklers and certified civil defense fire safety measures are present.
3. Multiply the final adjusted rate per mille by the total sum insured to get the indicative annual premium.
4. Always state this is INDICATIVE ONLY, subject to underwriter review and final survey approval.

Respond in JSON:
{
  "baseRate": "...",
  "adjustmentsApplied": ["...", "..."],
  "finalRatePerMille": "...",
  "indicativePremium": "...",
  "riskSummary": "...",
  "flaggedConcerns": "..."
}`,
     'openai/gpt-oss-120b'
    );

    const { data: assessment, error: insertError } = await supabase
      .from('risk_assessments')
      .insert({
        submission_id: id,
        risk_summary: result.riskSummary,
        flagged_concerns: result.flaggedConcerns,
        indicative_premium: result.indicativePremium,
        base_rate: result.baseRate,
        adjustments_applied: result.adjustmentsApplied,
        final_rate_per_mille: result.finalRatePerMille,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    await supabase.from('submissions').update({ status: 'reviewed' }).eq('id', id);
    res.json({ success: true, assessment });
  } catch (error) {
    console.error('Assessment generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------ 6. Dashboard reads ------------------------------

app.get('/api/submissions', async (req, res) => {
  const { data, error } = await supabase
    .from('submissions')
    .select('id, broker_name, broker_email, subject, status, received_at, missing_document_types')
    .order('received_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/submissions/:id', async (req, res) => {
  const { id } = req.params;
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', id)
    .single();
  if (subError) return res.status(404).json({ error: 'Submission not found' });

  const { data: documents } = await supabase
    .from('documents')
    .select('id, original_filename, document_type, classification_confidence, extracted_fields, created_at')
    .eq('submission_id', id)
    .order('created_at', { ascending: true });

  const { data: assessment } = await supabase
    .from('risk_assessments')
    .select('*')
    .eq('submission_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  res.json({ submission, documents: documents ?? [], assessment: assessment ?? null });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Fire Quote Assistant backend server running on port ${PORT}`);
});